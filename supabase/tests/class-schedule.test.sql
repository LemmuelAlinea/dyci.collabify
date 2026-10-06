-- supabase/tests/class-schedule.test.sql
-- A class task's planned start. Rolls back; nothing here survives.
--
--   node scripts/db.mjs supabase/tests/class-schedule.test.sql
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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  t1 uuid;
  ts timestamptz := now() + interval '1 day';
  refused boolean;
  v_origin uuid; v_origin2 uuid; v_shift uuid;
  c1 uuid; c2 uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-schedule-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Schedule group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-schedule-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '14 days', now() - interval '1 day')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  -- A student adds a task, planned to start tomorrow and due in a week.
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by, starts_at, due_at)
  values (v_board, 'Plan the schema', 10, v_a, ts, ts + interval '6 days') returning id into t1;
  perform pg_temp.must_be('a student can set a planned start',
    (select starts_at from public.project_tasks where id = t1) = ts);

  perform pg_temp.must_be('the detail view carries the planned start',
    (select starts_at from public.task_detail_overview where id = t1) = ts);

  update public.project_tasks set starts_at = ts + interval '1 day' where id = t1;
  perform pg_temp.must_be('a to-do task can move its start',
    (select starts_at from public.project_tasks where id = t1) = ts + interval '1 day');

  refused := false;
  begin
    update public.project_tasks set starts_at = ts + interval '30 days' where id = t1;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('a start after the due date is refused', refused);

  -- Claim it and start it; then the start is frozen like the due date.
  insert into public.task_assignees (task_id, student_id) values (t1, v_a);
  update public.project_tasks set status = 'in_progress' where id = t1;
  refused := false;
  begin
    update public.project_tasks set starts_at = ts where id = t1;
  exception when others then
    refused := sqlerrm like '%already been started%';
  end;
  perform pg_temp.must_be('a started task cannot move its planned start', refused);

  -- ---------------------------------------------- professor edits and shifts

  -- A professor hands out two tasks; the group's copies are in v_board.
  perform pg_temp.act_as(v_prof);
  v_origin := (public.create_professor_task(
    v_proj, 'Set: wireframes', '', 1, ts + interval '10 days', v_board) ->> 'origin_id')::uuid;
  v_origin2 := (public.create_professor_task(
    v_proj, 'Set: prototype', '', 1, ts + interval '10 days', v_board) ->> 'origin_id')::uuid;
  perform pg_temp.must_be('the professor handed out two tasks',
    v_origin is not null and v_origin2 is not null);
  select id into c1 from public.project_tasks where origin_id = v_origin and board_id = v_board;
  select id into c2 from public.project_tasks where origin_id = v_origin2 and board_id = v_board;

  -- The group plans its copies: c1 late, c2 early.
  perform pg_temp.act_as(v_a);
  update public.project_tasks set starts_at = ts + interval '8 days' where id = c1;
  update public.project_tasks set starts_at = ts where id = c2;

  -- The professor pulls both due dates in to two days from the base.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('editing a set task whose copy starts later than the new due date succeeds',
    (public.update_professor_task(v_origin, 'Set: wireframes', '', 1, ts + interval '2 days')
      ->> 'result') = 'updated');
  perform pg_temp.must_be('the copy planned past the new due date loses its start',
    (select starts_at is null and due_at = ts + interval '2 days'
       from public.project_tasks where id = c1));
  perform public.update_professor_task(v_origin2, 'Set: prototype', '', 1, ts + interval '2 days');
  perform pg_temp.must_be('a copy planned inside the new due date keeps its start',
    (select starts_at = ts and due_at = ts + interval '2 days'
       from public.project_tasks where id = c2));
  perform public.update_professor_task(v_origin2, 'Set: prototype', '', 1, null);
  perform pg_temp.must_be('clearing the due date leaves a planned start alone',
    (select starts_at = ts and due_at is null from public.project_tasks where id = c2));
  perform public.update_professor_task(v_origin2, 'Set: prototype', '', 1, ts + interval '2 days');

  -- A shift moves a task's planned start by the same days as its due date.
  perform pg_temp.act_as_service();
  insert into public.class_week_shifts (class_id, from_week, days, reason, created_by)
  values (v_class, 1, -3, 'zz-schedule-fixture', v_prof)
  returning id into v_shift;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a shift reports the tasks it moved',
    public.apply_shift_to_deadlines(v_shift, '{}'::uuid[], array[c2, c1]) = 2);
  perform pg_temp.must_be('a negative shift moves the start with the due date',
    (select starts_at = ts - interval '3 days' and due_at = ts - interval '1 day'
       from public.project_tasks where id = c2));
  perform pg_temp.must_be('a task with no start stays without one',
    (select starts_at is null and due_at = ts - interval '1 day'
       from public.project_tasks where id = c1));

  perform pg_temp.act_as_service();
  insert into public.class_week_shifts (class_id, from_week, days, reason, created_by)
  values (v_class, 1, 5, 'zz-schedule-fixture', v_prof)
  returning id into v_shift;
  perform pg_temp.act_as(v_prof);
  perform public.apply_shift_to_deadlines(v_shift, '{}'::uuid[], array[c2]);
  perform pg_temp.must_be('a positive shift moves the start along too',
    (select starts_at = ts + interval '2 days' and due_at = ts + interval '4 days'
       from public.project_tasks where id = c2));

  perform pg_temp.act_as_service();
end $$;

rollback;
