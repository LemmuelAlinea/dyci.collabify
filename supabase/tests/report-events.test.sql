-- report_task_events — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-events.test.sql

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
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_set uuid; v_g1 uuid;
  v_proj uuid; v_solo uuid; v_b1 uuid; v_sa uuid;
  v_t uuid; v_ts uuid; v_tx uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_ex uuid;
  v_a_name text;
  r record;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') into v_a_name
    from public.profiles where id = v_a;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-ev-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-ev-g1') returning id into v_g1;
  insert into public.group_members (group_id, set_id, student_id) values (v_g1, v_set, v_a);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-ev-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_b1 from public.project_boards where project_id = v_proj and group_id = v_g1;

  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-ev-solo', 'activity', 1, 2, 'individual', null)
  returning id into v_solo;
  perform public.ensure_project_boards(v_solo);
  select id into v_sa from public.project_boards where project_id = v_solo and student_id = v_a;

  insert into public.project_tasks (board_id, title, status) values (v_b1, 'zz ev task', 'todo') returning id into v_t;
  insert into public.project_tasks (board_id, title, status) values (v_sa, 'zz solo task', 'todo') returning id into v_ts;
  insert into public.project_tasks (board_id, title, status) values (v_b1, 'zz archived task', 'todo') returning id into v_tx;

  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_t, v_a, 'claimed', '', now() - interval '2 days') returning id into v_e1;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_t, v_prof, 'commented', 'zz looks fine', now() - interval '1 day') returning id into v_e2;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_ts, v_a, 'finished', '', now() - interval '3 hours') returning id into v_e3;
  insert into public.task_events (task_id, actor_id, kind, detail, at)
  values (v_tx, v_a, 'started', '', now() - interval '1 day') returning id into v_ex;

  -- The archive columns move only inside the archive functions; this opens them for one update.
  perform set_config('collabify.task_archive_op', 'on', true);
  update public.project_tasks set archived_at = now() where id = v_tx;
  perform set_config('collabify.task_archive_op', '', true);

  perform pg_temp.act_as(v_prof);

  select * into r from public.report_task_events where id = v_e1;
  perform pg_temp.must_be('a professor reads an event with its task, group, project and actor',
    r.task_title = 'zz ev task' and r.board_name = 'zz-ev-g1' and r.project_title = 'zz-ev-proj'
    and r.project_id = v_proj and r.class_id = v_class and r.kind = 'claimed'
    and r.actor_id = v_a and r.actor_name = v_a_name and r.board_id = v_b1 and r.task_id = v_t);
  select * into r from public.report_task_events where id = v_e2;
  perform pg_temp.must_be('the detail travels with the event', r.detail = 'zz looks fine' and r.actor_id = v_prof);
  select * into r from public.report_task_events where id = v_e3;
  perform pg_temp.must_be('an individual board is named for its student',
    r.board_name = v_a_name and r.project_id = v_solo and r.kind = 'finished');
  perform pg_temp.must_be('an archived task leaves the log with its history',
    not exists (select 1 from public.report_task_events where id = v_ex));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no events',
    (select count(*) from public.report_task_events where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an archived project in an ended class keeps its events',
    (select count(*) from public.report_task_events where id in (v_e1, v_e2)) = 2
    and (select project_archived_at is not null from public.report_task_events where id = v_e1));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('anon cannot read the view',
    not has_table_privilege('anon', 'public.report_task_events', 'select'));
end $$;

rollback;
