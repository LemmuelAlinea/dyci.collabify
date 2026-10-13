-- class_note_log — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-notes.test.sql

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_set uuid; v_g uuid; v_proj uuid; v_board uuid;
  r record;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-log-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-log-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id) values (v_g, v_set, v_a);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-log-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  perform pg_temp.act_as(v_prof);
  perform public.add_class_note(v_class, v_a, null, 'meeting', 'zz-log student note', null);
  perform public.add_class_note(v_class, null, v_board, 'note', 'zz-log group note', null);

  select * into r from public.class_note_log where class_id = v_class and body = 'zz-log student note';
  perform pg_temp.must_be('the professor reads a student note with the student and author named',
    r.student_name is not null and r.author_name is not null and r.group_name is null);
  select * into r from public.class_note_log where class_id = v_class and body = 'zz-log group note';
  perform pg_temp.must_be('a group note carries the group and project',
    r.group_name = 'zz-log-group' and r.project_title = 'zz-log-proj' and r.student_name is null);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads nothing from the log, even about themselves',
    (select count(*) from public.class_note_log where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an ended class keeps its log',
    (select count(*) from public.class_note_log where class_id = v_class and body like 'zz-log%') = 2);
  perform pg_temp.act_as_service();
end $$;

rollback;
