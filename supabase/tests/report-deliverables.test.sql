-- report_deliverables and report_sprints — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-deliverables.test.sql

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

create or replace function pg_temp.manila(p_day date, p_hour int default 10) returns timestamptz
language sql as $$ select (p_day::timestamp + make_interval(hours => p_hour)) at time zone 'Asia/Manila' $$;

do $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_set uuid; v_g1 uuid; v_g2 uuid; v_g3 uuid;
  v_proj uuid; v_solo uuid; v_b1 uuid; v_b2 uuid; v_b3 uuid; v_sa uuid;
  v_edge uuid; v_e1 uuid; v_m_2330 uuid; v_m_0030 uuid;
  v_m_on uuid; v_m_late uuid; v_m_miss uuid; v_m_future uuid; v_m_empty uuid; v_sprint uuid; v_t uuid;
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
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-del-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g1') returning id into v_g1;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g2') returning id into v_g2;
  insert into public.groups (set_id, name) values (v_set, 'zz-del-g3') returning id into v_g3;
  insert into public.group_members (group_id, set_id, student_id) values (v_g1, v_set, v_a);
  insert into public.group_members (group_id, set_id, student_id) values (v_g2, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-del-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_b1 from public.project_boards where project_id = v_proj and group_id = v_g1;
  select id into v_b2 from public.project_boards where project_id = v_proj and group_id = v_g2;
  select id into v_b3 from public.project_boards where project_id = v_proj and group_id = v_g3;

  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-on', v_today - 10) returning id into v_m_on;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-late', v_today - 10) returning id into v_m_late;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-miss', v_today - 10) returning id into v_m_miss;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-future', v_today + 5) returning id into v_m_future;
  insert into public.project_milestones (project_id, name, due_on) values (v_proj, 'zz-empty', v_today - 3) returning id into v_m_empty;

  -- zz-on: every task done two days before the due day.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz on', 'done', v_m_on) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 12) where id = v_t;
  -- zz-late: every task done, the last three days after the due day.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz late', 'done', v_m_late) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 7) where id = v_t;
  -- zz-miss: one of two done, and the due day has passed.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz miss a', 'done', v_m_miss);
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz miss b', 'todo', v_m_miss);
  -- zz-future: open, not yet due.
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_b1, 'zz future', 'todo', v_m_future);
  -- zz-empty: nothing attached on b1 (ruling 2).

  -- A sprint from 20 to 14 days ago: one task finished inside it, one after.
  insert into public.board_sprints (board_id, name, starts_on, ends_on) values (v_b1, 'zz sprint', v_today - 20, v_today - 14)
  returning id into v_sprint;
  insert into public.project_tasks (board_id, title, status, sprint_id) values (v_b1, 'zz sp in', 'done', v_sprint) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 15) where id = v_t;
  insert into public.project_tasks (board_id, title, status, sprint_id) values (v_b1, 'zz sp after', 'done', v_sprint) returning id into v_t;
  update public.project_tasks set done_at = pg_temp.manila(v_today - 12) where id = v_t;

  -- Hand-ins: b1 three days ago, b2 one day ago; the deadline then moves to two days ago.
  -- b3 was returned and never handed in again.
  update public.project_boards set submitted_at = now() - interval '3 days' where id = v_b1;
  update public.project_boards set submitted_at = now() - interval '1 day' where id = v_b2;
  insert into public.board_results (board_id, verdict, feedback, decided_by, decided_at)
  values (v_b3, 'returned', 'zz fix the model', v_prof, now() - interval '4 days');
  update public.projects set due_at = now() - interval '2 days' where id = v_proj;

  -- An individual project with no due date: one student hands in, the other does not.
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-del-solo', 'activity', 1, 2, 'individual', null)
  returning id into v_solo;
  perform public.ensure_project_boards(v_solo);
  select id into v_sa from public.project_boards where project_id = v_solo and student_id = v_a;
  update public.project_boards set submitted_at = now() - interval '1 day' where id = v_sa;

  -- Edges: a second group project. Its hand-in lands 2 hours past a deadline that then moves back,
  -- and two milestones sit either side of Manila midnight on their due day.
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-del-edge', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_edge;
  perform public.ensure_project_boards(v_edge);
  select id into v_e1 from public.project_boards where project_id = v_edge and group_id = v_g1;
  insert into public.project_milestones (project_id, name, due_on) values (v_edge, 'zz-2330', v_today - 10) returning id into v_m_2330;
  insert into public.project_milestones (project_id, name, due_on) values (v_edge, 'zz-0030', v_today - 10) returning id into v_m_0030;
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_e1, 'zz at 2330', 'done', v_m_2330) returning id into v_t;
  update public.project_tasks set done_at = ((v_today - 10)::timestamp + time '23:30') at time zone 'Asia/Manila' where id = v_t;
  insert into public.project_tasks (board_id, title, status, milestone_id) values (v_e1, 'zz at 0030', 'done', v_m_0030) returning id into v_t;
  update public.project_tasks set done_at = ((v_today - 9)::timestamp + time '00:30') at time zone 'Asia/Manila' where id = v_t;
  update public.project_boards set submitted_at = now() - interval '1 hour' where id = v_e1;
  update public.projects set due_at = now() - interval '3 hours' where id = v_edge;

  perform pg_temp.act_as(v_prof);

  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_on;
  perform pg_temp.must_be('a milestone done before its day is on time', r.state = 'on_time' and r.days_late = 0 and r.tasks = 1 and r.done = 1);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_late;
  perform pg_temp.must_be('a milestone done three days after is late by 3', r.state = 'late' and r.days_late = 3);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_miss;
  perform pg_temp.must_be('a past-due milestone with open work is missing', r.state = 'missing' and r.done_at is null and r.done = 1 and r.tasks = 2);
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_future;
  perform pg_temp.must_be('a milestone due later is not due', r.state = 'not_due');
  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'milestone' and ref_id = v_m_empty;
  perform pg_temp.must_be('a past-due milestone with no tasks is missing', r.state = 'missing' and r.tasks = 0);
  select * into r from public.report_deliverables where board_id = v_b2 and kind = 'milestone' and ref_id = v_m_future;
  perform pg_temp.must_be('every board carries every milestone, named for its group', r.state = 'not_due' and r.group_name = 'zz-del-g2');

  select * into r from public.report_deliverables where board_id = v_b1 and kind = 'hand_in';
  perform pg_temp.must_be('a hand-in before the deadline is on time',
    r.state = 'on_time' and r.days_late = 0 and r.ref_id = v_proj and r.title = 'Hand-in' and r.due_day is not null);
  select * into r from public.report_deliverables where board_id = v_b2 and kind = 'hand_in';
  perform pg_temp.must_be('a hand-in a day after the deadline is late by 1', r.state = 'late' and r.days_late = 1);
  select * into r from public.report_deliverables where board_id = v_b3 and kind = 'hand_in';
  perform pg_temp.must_be('returned and not handed in again, past due, is missing', r.state = 'missing');

  select * into r from public.report_deliverables where board_id = v_sa and kind = 'hand_in';
  perform pg_temp.must_be('no deadline: handed in is on time, named for the student',
    r.state = 'on_time' and r.due_day is null and r.student_name is not null and r.group_name is null);
  perform pg_temp.must_be('no deadline: not handed in is not due',
    (select state from public.report_deliverables where project_id = v_solo and kind = 'hand_in' and board_id <> v_sa limit 1) = 'not_due');

  select * into r from public.report_deliverables where board_id = v_e1 and kind = 'hand_in';
  perform pg_temp.must_be('a hand-in 2 hours past the deadline is late by 1 day', r.state = 'late' and r.days_late = 1);
  select * into r from public.report_deliverables where board_id = v_e1 and kind = 'milestone' and ref_id = v_m_2330;
  perform pg_temp.must_be('a milestone done at 23:30 Manila on its due day is on time', r.state = 'on_time' and r.days_late = 0);
  select * into r from public.report_deliverables where board_id = v_e1 and kind = 'milestone' and ref_id = v_m_0030;
  perform pg_temp.must_be('a milestone done at 00:30 Manila the next day is late by 1', r.state = 'late' and r.days_late = 1);

  select * into r from public.report_sprints where sprint_id = v_sprint;
  perform pg_temp.must_be('a sprint counts work finished inside its dates', r.tasks = 2 and r.done = 2 and r.done_in_window = 1);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no deliverables',
    (select count(*) from public.report_deliverables where class_id = v_class) = 0);
  perform pg_temp.must_be('a student reads no sprints',
    (select count(*) from public.report_sprints where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an archived project in an ended class keeps its deliverables',
    (select count(*) from public.report_deliverables where project_id = v_proj) = 18
    and (select project_archived_at is not null from public.report_deliverables where project_id = v_proj limit 1));
  perform pg_temp.must_be('and its sprints',
    (select count(*) from public.report_sprints where sprint_id = v_sprint) = 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
