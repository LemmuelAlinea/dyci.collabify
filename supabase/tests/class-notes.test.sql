-- Intervention notes — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/class-notes.test.sql
--
-- Every refusal is paired with a control that succeeds.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ---------------------------------------------------------------- fixture

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_board uuid; v_outsider uuid; v_other_board uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 0 limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select student_id into v_d from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 2 limit 1;
  select p.id into v_outsider from public.profiles p
   where p.role = 'student'
     and not exists (select 1 from public.class_members m where m.class_id = v_class and m.student_id = p.id)
   limit 1;
  select b.id into v_other_board from public.project_boards b
    join public.projects p on p.id = b.project_id
   where p.class_id <> v_class
   limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-notes-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-notes-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-notes-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('d', v_d), ('class', v_class),
    ('set', v_set), ('group', v_g), ('proj', v_proj), ('board', v_board),
    ('outsider', v_outsider), ('other_board', v_other_board);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------ writing (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  v_board uuid := (select v from fx where k='board');
  v_outsider uuid := (select v from fx where k='outsider');
  v_other_board uuid := (select v from fx where k='other_board');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot add a note',
    format('select public.add_class_note(%L, %L, null, ''note'', ''zz-mine'', null)', v_class, v_a));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor records a meeting with a student, with a follow-up date',
    format('select public.add_class_note(%L, %L, null, ''meeting'', ''zz-talked about the late tasks'', current_date + 3)',
           v_class, v_a));
  perform pg_temp.must_allow('and a note on a group',
    format('select public.add_class_note(%L, null, %L, ''note'', ''zz-group split the work again'', null)',
           v_class, v_board));
  perform pg_temp.must_refuse('a note needs a student or a group',
    format('select public.add_class_note(%L, null, null, ''note'', ''zz-about nobody'', null)', v_class));
  perform pg_temp.must_refuse('a note needs words',
    format('select public.add_class_note(%L, %L, null, ''note'', ''   '', null)', v_class, v_a));
  perform pg_temp.must_refuse('a note stays under 2000 characters',
    format('select public.add_class_note(%L, %L, null, ''note'', %L, null)', v_class, v_a, repeat('x', 2001)));
  perform pg_temp.must_refuse('reminders are logged by sending them, not by hand',
    format('select public.add_class_note(%L, %L, null, ''nudge'', ''zz-fake'', null)', v_class, v_a));
  perform pg_temp.must_refuse('the professor cannot write the table directly',
    format('insert into public.class_notes (class_id, student_id, kind, body) values (%L, %L, ''note'', ''zz-direct'')',
           v_class, v_a));
  if v_outsider is not null then
    perform pg_temp.must_refuse('a student from another class is refused',
      format('select public.add_class_note(%L, %L, null, ''note'', ''zz-outsider'', null)', v_class, v_outsider));
  else
    raise notice 'skipped: no student outside the fixture class';
  end if;
  if v_other_board is not null then
    perform pg_temp.must_refuse('a board from another class is refused',
      format('select public.add_class_note(%L, null, %L, ''note'', ''zz-elsewhere'', null)', v_class, v_other_board));
  else
    raise notice 'skipped: no board in another class';
  end if;
end $$;

-- Deleting a project's boards would cascade into the group note above.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('changing who a project with group notes goes to is refused',
    format('select public.set_project_audience(%L, ''individual'', null)', v_proj));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the group note survives the refused change',
    exists (select 1 from public.class_notes where board_id = v_board and body = 'zz-group split the work again'));
end $$;

-- ------------------------------------------------------ reading (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no note, even one about them',
    (select count(*) from public.class_notes where class_id = v_class) = 0);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor reads both notes',
    (select count(*) from public.class_notes where class_id = v_class and body like 'zz-%') = 2);
  perform pg_temp.must_be('each note records who wrote it',
    (select bool_and(created_by = v_prof) from public.class_notes where class_id = v_class and body like 'zz-%'));
end $$;

-- ---------------------------------------------------- resolving (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  v_note uuid;
begin
  perform pg_temp.act_as_service();
  select id into v_note from public.class_notes where body = 'zz-talked about the late tasks';

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot resolve a note',
    format('select public.resolve_class_note(%L, ''zz-done'')', v_note));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an outcome stays under 1000 characters',
    format('select public.resolve_class_note(%L, %L)', v_note, repeat('x', 1001)));
  perform pg_temp.must_allow('the professor resolves it with an outcome',
    format('select public.resolve_class_note(%L, ''  zz-they caught up  '')', v_note));
  perform pg_temp.must_be('it is resolved, with the outcome trimmed',
    exists (select 1 from public.class_notes
             where id = v_note and resolved_at is not null and outcome = 'zz-they caught up'));
  perform pg_temp.must_refuse('a resolved note stays resolved',
    format('select public.resolve_class_note(%L, '''')', v_note));

  -- No delete policy: a delete runs and removes nothing.
  execute format('delete from public.class_notes where id = %L', v_note);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('nobody deletes a note', exists (select 1 from public.class_notes where id = v_note));

  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived class takes no new notes',
    format('select public.add_class_note(%L, %L, null, ''note'', ''zz-late'', null)', v_class, v_a));
  perform pg_temp.act_as_service();
  update public.classes set archived_at = null where id = v_class;
end $$;

-- ================================================= Task 2 appends below here

rollback;
