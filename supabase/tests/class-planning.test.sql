-- supabase/tests/class-planning.test.sql
-- Sprints and backlog order on a class board. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/class-planning.test.sql
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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_proj2 uuid; v_board uuid; v_board2 uuid;
  s1 uuid; s2 uuid; s_other uuid; s3 uuid; s4 uuid; s5 uuid;
  t_todo uuid; t_started uuid; t_done uuid; t_arch uuid; t_live uuid;
  n int;
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
  values (v_class, 'zz-cplan-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Plan group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture-2', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj2;
  perform public.ensure_project_boards(v_proj);
  perform public.ensure_project_boards(v_proj2);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;
  select id into v_board2 from public.project_boards where project_id = v_proj2 limit 1;

  ------------------------------------------------------------ creating
  perform pg_temp.act_as(v_a);
  insert into public.board_sprints (board_id, name, starts_on, ends_on, state)
  values (v_board, 'Sprint 1', current_date, current_date + 6, 'completed') returning id into s1;
  perform pg_temp.must_be('a new board sprint is always planned',
    (select state from public.board_sprints where id = s1) = 'planned');
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 2', current_date + 7, current_date + 13) returning id into s2;
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board2, 'Other board', current_date, current_date + 6) returning id into s_other;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor can read a group''s sprints',
    exists (select 1 from public.board_sprints where id = s1));
  perform pg_temp.must_refuse('the professor cannot plan a group''s sprints',
    format($q$insert into public.board_sprints (board_id, name, starts_on, ends_on)
              values (%L, 'Prof sprint', current_date, current_date + 1)$q$, v_board));

  ------------------------------------------------------------ tasks
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'To do', 10, v_a) returning id into t_todo;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Started', 10, v_a) returning id into t_started;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Done', 10, v_a) returning id into t_done;
  -- Filler, so the board totals 70 and A's fair share (35) covers the two tasks A claims.
  insert into public.project_tasks (board_id, title, weight, created_by)
  select v_board, 'Filler ' || g, 10, v_a from generate_series(1, 4) g;
  perform pg_temp.must_be('a new class task lands in the backlog with a rank',
    (select sprint_id is null and rank is not null from public.project_tasks where id = t_todo));
  insert into public.task_assignees (task_id, student_id) values (t_started, v_a), (t_done, v_a);
  update public.project_tasks set status = 'in_progress' where id in (t_started, t_done);
  update public.project_tasks set status = 'done' where id = t_done;

  update public.project_tasks set sprint_id = s1 where id in (t_todo, t_started, t_done);
  perform pg_temp.must_be('a member can move even a started task into a sprint',
    (select count(*) from public.project_tasks where sprint_id = s1) = 3);
  perform pg_temp.must_refuse('a task cannot join another board''s sprint',
    format('update public.project_tasks set sprint_id = %L where id = %L', s_other, t_todo));
  update public.project_tasks set rank = -5 where id = t_started;
  perform pg_temp.must_be('a member can reorder a started task',
    (select rank from public.project_tasks where id = t_started) = -5);
  perform pg_temp.must_be('the detail view carries sprint and rank',
    (select sprint_id = s1 from public.task_detail_overview where id = t_todo));

  ------------------------------------------------------------ running
  update public.board_sprints set state = 'active' where id = s1;
  perform pg_temp.must_be('starting a board sprint stamps it',
    (select started_at is not null from public.board_sprints where id = s1));
  perform pg_temp.must_refuse('only one sprint runs on a board',
    format($q$update public.board_sprints set state = 'active' where id = %L$q$, s2));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('the professor cannot finish a group''s sprint',
    format('select public.complete_board_sprint(%L, null)', s1));

  perform pg_temp.act_as(v_b);
  perform public.complete_board_sprint(s1, null);
  perform pg_temp.must_be('finishing with no target sends unfinished tasks to the backlog',
    (select count(*) from public.project_tasks where id in (t_todo, t_started) and sprint_id is null) = 2);
  perform pg_temp.must_be('a done task stays in its sprint',
    (select sprint_id from public.project_tasks where id = t_done) = s1);
  perform pg_temp.must_be('the board sprint is finished',
    (select state from public.board_sprints where id = s1) = 'completed');

  ------------------------------------------------------------ handed in
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.must_refuse('a handed-in board cannot plan a sprint',
    format($q$insert into public.board_sprints (board_id, name, starts_on, ends_on)
              values (%L, 'Late plan', current_date, current_date + 1)$q$, v_board));
  perform public.set_board_submitted(v_board, false);

  ------------------------------------------------------------ deleting
  delete from public.board_sprints where id = s2;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a member can delete a planned sprint', n = 1);

  -- Only a planned sprint can go: a finished one and a running one stay.
  delete from public.board_sprints where id = s1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a finished sprint cannot be deleted', n = 0);

  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 4', current_date, current_date + 6) returning id into s4;
  update public.board_sprints set state = 'active' where id = s4;
  delete from public.board_sprints where id = s4;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a running sprint cannot be deleted', n = 0);
  perform pg_temp.must_be('the running sprint is still there',
    exists (select 1 from public.board_sprints where id = s4 and state = 'active'));
  update public.board_sprints set state = 'completed' where id = s4;

  -- A planned sprint holding a live task and an archived one: the delete goes
  -- through, and both tasks return to the backlog. The archived one is hidden
  -- from the member, so it is read back as the service role.
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 3', current_date + 14, current_date + 20) returning id into s3;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Will be archived', 10, v_a) returning id into t_arch;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Stays live', 10, v_a) returning id into t_live;
  update public.project_tasks set sprint_id = s3 where id in (t_arch, t_live);
  perform public.archive_class_task(t_arch, true);
  perform pg_temp.must_be('the archived task is hidden from the member',
    not exists (select 1 from public.project_tasks where id = t_arch));

  delete from public.board_sprints where id = s3;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a member can delete a planned sprint that holds an archived task', n = 1);
  perform pg_temp.must_be('the live task went back to the backlog',
    (select sprint_id is null from public.project_tasks where id = t_live));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the archived task went back to the backlog and stays archived',
    (select sprint_id is null and archived_at is not null
       from public.project_tasks where id = t_arch));
  perform pg_temp.must_be('the archive flag is not left switched on',
    coalesce(current_setting('collabify.task_archive_op', true), '') <> 'on');

  -- The release trigger lifts only the archive check. A handed-in board's
  -- sprint cannot be deleted at all, so its tasks are never touched.
  perform pg_temp.act_as(v_a);
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 5', current_date + 21, current_date + 27) returning id into s5;
  update public.project_tasks set sprint_id = s5 where id = t_live;
  perform public.set_board_submitted(v_board, true);
  delete from public.board_sprints where id = s5;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a handed-in board cannot delete a sprint', n = 0);
  perform pg_temp.must_be('and its task stays in the sprint',
    (select sprint_id = s5 from public.project_tasks where id = t_live));
  perform public.set_board_submitted(v_board, false);

  perform pg_temp.act_as(v_prof);
  delete from public.board_sprints where id = s5;
  get diagnostics n = row_count;
  perform pg_temp.must_be('the professor cannot delete a group''s sprint', n = 0);

  perform pg_temp.act_as_service();
end $$;

rollback;
