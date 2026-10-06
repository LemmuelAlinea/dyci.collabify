-- supabase/tests/work-planning.test.sql
-- Sprints and backlog order on a work project. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/work-planning.test.sql
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

/** Runs a statement and asserts it is refused. */
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
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Member', 'Outsider'];
  i int;
  a uuid; b uuid; d uuid;
  p uuid; p2 uuid; v_inv uuid;
  s1 uuid; s2 uuid; s_other uuid; s_gone uuid;
  t_open uuid; t_done uuid; t_member uuid; t_gone uuid; t_new uuid;
  r1 double precision; r2 double precision;
  s_arch uuid; v_team uuid; t_arch uuid; t_rt uuid; t_prev uuid; t_rank uuid;
  t_parked uuid; s_g uuid; t_g uuid;
  n int;
begin
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-wplan-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzwplan', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  -- General accounts are approved faculty: supabase/access.sql.
  update public.profiles set status = 'active'
   where id = any (v_ids) and role = 'faculty' and status = 'pending';
  a := v_ids[1]; b := v_ids[2]; d := v_ids[3];

  perform pg_temp.act_as(a);
  p  := (public.create_general_project('Zz sprint project')).id;
  p2 := (public.create_general_project('Zz other project')).id;
  select id into v_inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(v_inv, true);

  ------------------------------------------------------------ creating
  perform pg_temp.act_as(a);
  insert into public.general_sprints (project_id, name, starts_on, ends_on, state)
  values (p, 'Sprint 1', current_date, current_date + 13, 'active') returning id into s1;
  perform pg_temp.must_be('a new sprint is always planned, whatever was sent',
    (select state from public.general_sprints where id = s1) = 'planned');
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 2', current_date + 14, current_date + 27) returning id into s2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p2, 'Elsewhere', current_date, current_date + 13) returning id into s_other;

  perform pg_temp.must_refuse('a sprint cannot end before it starts',
    format($q$insert into public.general_sprints (project_id, name, starts_on, ends_on)
              values (%L, 'Backwards', current_date, current_date - 1)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a member without manage_tasks cannot create a sprint',
    format($q$insert into public.general_sprints (project_id, name, starts_on, ends_on)
              values (%L, 'Mine', current_date, current_date + 1)$q$, p));
  perform pg_temp.must_be('a member can read the sprints',
    exists (select 1 from public.general_sprints where id = s1));

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('an outsider cannot read the sprints',
    not exists (select 1 from public.general_sprints where id = s1));

  ------------------------------------------------------------ tasks and rank
  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Member task') returning id into t_member;
  perform pg_temp.must_be('a member can add a task, and it lands in the backlog',
    (select sprint_id from public.general_tasks where id = t_member) is null);
  perform pg_temp.must_refuse('a member cannot put a task in a sprint',
    format('update public.general_tasks set sprint_id = %L where id = %L', s1, t_member));
  perform pg_temp.must_refuse('a member cannot add a task straight into a sprint',
    format($q$insert into public.general_tasks (project_id, title, sprint_id) values (%L, 'Sneaky', %L)$q$, p, s1));
  perform pg_temp.must_refuse('a member cannot reorder the backlog',
    format('update public.general_tasks set rank = -1 where id = %L', t_member));

  select rank into r1 from public.general_tasks where id = t_member;
  insert into public.general_tasks (project_id, title, rank) values (p, 'Jumper', -1e9) returning id into t_rank;
  perform pg_temp.must_be('a member cannot jump the backlog by sending a rank',
    (select rank from public.general_tasks where id = t_rank) > r1);

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Open task') returning id into t_open;
  insert into public.general_tasks (project_id, title) values (p, 'Done task') returning id into t_done;
  select rank into r1 from public.general_tasks where id = t_open;
  select rank into r2 from public.general_tasks where id = t_done;
  perform pg_temp.must_be('a later task ranks below an earlier one', r2 > r1);

  update public.general_tasks set sprint_id = s1 where id in (t_open, t_done);
  perform pg_temp.must_be('a manager can move tasks into a sprint',
    (select count(*) from public.general_tasks where sprint_id = s1) = 2);
  perform pg_temp.must_refuse('a task cannot join another project''s sprint',
    format('update public.general_tasks set sprint_id = %L where id = %L', s_other, t_open));
  update public.general_tasks set status = 'done' where id = t_done;
  -- B holds the done task, so B can reopen it later.
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t_done, p, b);
  -- Archived while unfinished, so finishing leaves it in the sprint.
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Parked', s1) returning id into t_parked;
  perform public.archive_general_task(t_parked, true);

  ------------------------------------------------------------ running
  update public.general_sprints set state = 'active' where id = s1;
  perform pg_temp.must_be('starting a sprint stamps when it started',
    (select started_at is not null and state = 'active' from public.general_sprints where id = s1));
  perform pg_temp.must_refuse('only one sprint runs at a time',
    format($q$update public.general_sprints set state = 'active' where id = %L$q$, s2));
  perform pg_temp.must_refuse('a running sprint cannot go back to planned',
    format($q$update public.general_sprints set state = 'planned' where id = %L$q$, s1));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a member cannot finish a sprint',
    format('select public.complete_general_sprint(%L, null)', s1));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('unfinished work can only move to a planned sprint',
    format('select public.complete_general_sprint(%L, %L)', s1, s_other));
  perform public.complete_general_sprint(s1, s2);
  perform pg_temp.must_be('finishing moves unfinished tasks to the chosen sprint',
    (select sprint_id from public.general_tasks where id = t_open) = s2);
  perform pg_temp.must_be('finished tasks stay in the sprint they were done in',
    (select sprint_id from public.general_tasks where id = t_done) = s1);
  perform pg_temp.must_be('the sprint is finished and stamped',
    (select state = 'completed' and completed_at is not null from public.general_sprints where id = s1));
  perform pg_temp.must_refuse('a finished sprint cannot change',
    format($q$update public.general_sprints set name = 'Renamed' where id = %L$q$, s1));
  perform pg_temp.must_refuse('a task cannot move into a finished sprint',
    format('update public.general_tasks set sprint_id = %L where id = %L', s1, t_open));
  perform pg_temp.must_refuse('a task cannot be added straight into a finished sprint',
    format($q$insert into public.general_tasks (project_id, title, sprint_id) values (%L, 'Late', %L)$q$, p, s1));

  perform pg_temp.act_as(b);
  update public.general_tasks set status = 'in_progress' where id = t_done;
  perform pg_temp.must_be('a done task reopened by its holder goes back to the backlog',
    (select sprint_id is null and status = 'in_progress' from public.general_tasks where id = t_done));

  perform pg_temp.act_as(a);
  perform pg_temp.must_be('an archived task stays in the sprint it was archived in',
    (select sprint_id = s1 from public.general_tasks where id = t_parked));
  perform public.archive_general_task(t_parked, false);
  perform pg_temp.must_be('restoring an unfinished task from a finished sprint puts it in the backlog',
    (select sprint_id is null and archived_at is null from public.general_tasks where id = t_parked));

  ------------------------------------------------------------ deleting
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Short-lived', current_date + 30, current_date + 40) returning id into s_gone;
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'In it', s_gone) returning id into t_gone;
  delete from public.general_sprints where id = s_gone;
  perform pg_temp.must_be('deleting a planned sprint puts its tasks back in the backlog',
    (select sprint_id from public.general_tasks where id = t_gone) is null);
  delete from public.general_sprints where id = s1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a finished sprint cannot be deleted', n = 0
    and exists (select 1 from public.general_sprints where id = s1));

  ------------------------------------------------------------ archived tasks
  insert into public.general_teams (project_id, name) values (p, 'Zz Ushers') returning id into v_team;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Archive sprint', current_date + 50, current_date + 60) returning id into s_arch;
  insert into public.general_tasks (project_id, team_id, title, sprint_id)
  values (p, v_team, 'Team task', s_arch) returning id into t_arch;
  insert into public.general_tasks (project_id, title, sprint_id)
  values (p, 'Round trip', s_arch) returning id into t_rt;
  perform public.archive_general_task(t_rt, true);
  perform public.archive_general_task(t_rt, false);
  perform pg_temp.must_be('an archived then restored task keeps its sprint',
    (select sprint_id from public.general_tasks where id = t_rt) = s_arch);
  perform public.archive_general_task(t_arch, true);
  delete from public.general_sprints where id = s_arch;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a planned sprint can be deleted over an archived team task', n = 1
    and not exists (select 1 from public.general_sprints where id = s_arch));
  perform pg_temp.must_be('the archived task is back in the backlog and still archived',
    (select sprint_id is null and archived_at is not null from public.general_tasks where id = t_arch));
  perform pg_temp.must_be('the active tasks of that sprint are back in the backlog too',
    (select sprint_id is null from public.general_tasks where id = t_rt));
  perform pg_temp.must_be('the archive flag is off again after the delete',
    coalesce(current_setting('collabify.general_archive_op', true), 'off') = 'off');

  ------------------------------------------------------------ a granted member deletes
  -- B is a Member holding a manage_tasks grant. The Owner archived a team task
  -- in a planned sprint, so RLS hides it from B; deleting the sprint still
  -- has to put it back in the backlog.
  perform public.grant_general_permission(p, b, 'manage_tasks');
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Granted sprint', current_date + 70, current_date + 80) returning id into s_g;
  insert into public.general_tasks (project_id, team_id, title, sprint_id)
  values (p, v_team, 'Owner team task', s_g) returning id into t_g;
  perform public.archive_general_task(t_g, true);
  perform pg_temp.act_as(b);
  perform pg_temp.must_be('the granted member cannot see the Owner''s archived task',
    not exists (select 1 from public.general_tasks where id = t_g));
  delete from public.general_sprints where id = s_g;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a granted member deletes a planned sprint over someone else''s archived task', n = 1);
  perform pg_temp.must_be('the archive flag is not left switched on after that delete',
    coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('that archived task is back in the backlog and still archived',
    (select sprint_id is null and archived_at is not null from public.general_tasks where id = t_g));
  perform pg_temp.act_as(a);

  ------------------------------------------------------------ the overview
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Visible', s2) returning id into t_new;
  perform pg_temp.must_be('the task overview carries sprint and rank',
    (select sprint_id = s2 and rank is not null from public.general_task_overview where id = t_new));

  perform pg_temp.act_as_service();
end $$;

rollback;
