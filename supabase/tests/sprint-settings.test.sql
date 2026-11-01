-- supabase/tests/sprint-settings.test.sql
-- Per-project sprint settings and who may start or finish a sprint.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/sprint-settings.test.sql
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
  v_names text[] := array['Owner', 'Coord', 'Member'];
  i int;
  a uuid; c uuid; m uuid;
  p uuid; v_inv uuid;
  s1 uuid; s2 uuid; s3 uuid;
  t uuid;
  n int;
begin
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-sprintset-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzsprintset', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set can_teach = true, can_manage_projects = true
   where id = any (v_ids) and role = 'member';
  a := v_ids[1]; c := v_ids[2]; m := v_ids[3];

  perform pg_temp.act_as(a);
  p := (public.create_general_project('Zz sprint settings project')).id;
  select id into v_inv from public.invite_to_general_project(p, c);
  perform pg_temp.act_as(c);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as(a);
  select id into v_inv from public.invite_to_general_project(p, m);
  perform pg_temp.act_as(m);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  update public.general_members set role = 'coordinator' where project_id = p and user_id = c;
  -- The member holds the manage_tasks grant: it no longer opens sprint control.
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (p, m, 'manage_tasks', a);

  perform pg_temp.act_as(a);
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 1', current_date, current_date + 13) returning id into s1;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 2', current_date + 14, current_date + 27) returning id into s2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 3', current_date + 28, current_date + 41) returning id into s3;

  ------------------------------------------------------------ the settings row
  perform pg_temp.must_be('a project has no settings row until one is saved',
    not exists (select 1 from public.general_sprint_settings where project_id = p));

  insert into public.general_sprint_settings (project_id, length_days)
  values (p, 7)
  on conflict (project_id) do update set length_days = excluded.length_days;
  perform pg_temp.must_be('the project manager can save sprint settings',
    (select length_days = 7 and updated_by = a and updated_at is not null
       from public.general_sprint_settings where project_id = p));

  perform pg_temp.act_as(c);
  update public.general_sprint_settings set length_days = 10 where project_id = p;
  perform pg_temp.must_be('a coordinator can change sprint settings',
    (select length_days = 10 and updated_by = c
       from public.general_sprint_settings where project_id = p));

  perform pg_temp.act_as(m);
  perform pg_temp.must_be('a member can read the settings',
    exists (select 1 from public.general_sprint_settings where project_id = p));
  -- Row security hides the row from a member's update: it changes nothing, and does not raise.
  with u as (update public.general_sprint_settings set length_days = 3 where project_id = p returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('a member cannot change sprint settings',
    n = 0 and (select length_days = 10 from public.general_sprint_settings where project_id = p));
  perform pg_temp.must_refuse('a member cannot upsert a settings row either',
    format('insert into public.general_sprint_settings (project_id) values (%L) on conflict (project_id) do update set auto_start = true', p));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('auto finish cannot be on while unfinished tasks ask',
    format('update public.general_sprint_settings set auto_finish = true, carry = %L where project_id = %L', 'ask', p));
  perform pg_temp.must_refuse('a sprint length of zero days is refused',
    format('update public.general_sprint_settings set length_days = 0 where project_id = %L', p));
  update public.general_sprint_settings set auto_finish = true, carry = 'next' where project_id = p;
  perform pg_temp.must_be('auto finish can be on once unfinished tasks move on',
    (select auto_finish and carry = 'next' from public.general_sprint_settings where project_id = p));
  update public.general_sprint_settings set auto_finish = false, carry = 'ask' where project_id = p;

  update public.general_sprint_settings set auto_start = true where project_id = p;
  perform pg_temp.must_be('turning auto start on stamps auto_start_since',
    (select auto_start_since is not null from public.general_sprint_settings where project_id = p));
  update public.general_sprint_settings set auto_start = false where project_id = p;
  perform pg_temp.must_be('turning it off clears it',
    (select auto_start_since is null from public.general_sprint_settings where project_id = p));
  update public.general_sprint_settings set auto_start_since = now() where project_id = p;
  perform pg_temp.must_be('a client cannot stamp auto_start_since by hand',
    (select auto_start_since is null from public.general_sprint_settings where project_id = p));

  ------------------------------------------------------------ sprint control
  perform pg_temp.act_as(m);
  perform pg_temp.must_refuse('a member with manage_tasks cannot start a sprint',
    format($q$update public.general_sprints set state = 'active' where id = %L$q$, s1));

  perform pg_temp.act_as(a);
  update public.general_sprints set state = 'active' where id = s1;
  perform pg_temp.act_as(m);
  perform pg_temp.must_refuse('a member with manage_tasks cannot finish a sprint',
    format('select public.complete_general_sprint(%L, null)', s1));
  perform pg_temp.must_refuse('a member with manage_tasks cannot finish it directly either',
    format($q$update public.general_sprints set state = 'completed' where id = %L$q$, s1));
  perform pg_temp.must_be('the refused finish leaves the sprint running',
    (select state = 'active' from public.general_sprints where id = s1));

  perform pg_temp.act_as_service();
  insert into public.general_tasks (routing_state, created_by, project_id, title)
  values ('released', a, p, 'Zz sprint task') returning id into t;
  perform pg_temp.act_as(m);
  update public.general_tasks set sprint_id = s1 where id = t;
  perform pg_temp.must_be('a member with manage_tasks can still move a task into a sprint',
    (select sprint_id = s1 from public.general_tasks where id = t));
  update public.general_sprints set goal = 'Ship it' where id = s1;
  perform pg_temp.must_be('a member with manage_tasks can still edit a sprint goal',
    (select goal = 'Ship it' from public.general_sprints where id = s1));

  perform pg_temp.act_as(c);
  perform public.complete_general_sprint(s1, s2);
  perform pg_temp.must_be('a coordinator can finish a sprint',
    (select state = 'completed' from public.general_sprints where id = s1));
  update public.general_sprints set state = 'active' where id = s2;
  perform pg_temp.must_be('a coordinator can start a sprint',
    (select state = 'active' from public.general_sprints where id = s2));
  perform pg_temp.must_be('unfinished tasks moved to the next sprint when it finished',
    (select sprint_id = s2 from public.general_tasks where id = t));

  perform pg_temp.act_as(a);
  perform public.reopen_general_sprint(s1);
  perform pg_temp.must_be('the project manager can still reopen a finished sprint',
    (select state = 'active' from public.general_sprints where id = s1));

  perform pg_temp.act_as_service();
  update public.general_sprints set state = 'completed' where id = s1;
  perform pg_temp.must_be('the service role can still move a sprint (the scheduled job)',
    (select state = 'completed' from public.general_sprints where id = s1));

  -- run_sprint_automation (a later task) sets this switch for its own transaction.
  perform pg_temp.act_as(m);
  perform set_config('collabify.sprint_automation', 'on', true);
  update public.general_sprints set state = 'active' where id = s3;
  perform set_config('collabify.sprint_automation', 'off', true);
  perform pg_temp.must_be('the automation switch lets a sprint start without the role',
    (select state = 'active' from public.general_sprints where id = s3));
  perform pg_temp.must_refuse('and it is refused again once the switch is off',
    format($q$update public.general_sprints set state = 'completed' where id = %L$q$, s3));

  ------------------------------------------------------------ an archived project
  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, true);
  with u as (update public.general_sprint_settings set length_days = 5 where project_id = p returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('settings on an archived project cannot change',
    n = 0 and (select length_days = 10 from public.general_sprint_settings where project_id = p));
end;
$$;

------------------------------------------------------------ the automation job
-- Every run passes a fixed clock and its own project, so it never touches any
-- other project. Sprint 1 of each project ends on Tuesday 2026-11-10, so it is
-- due to finish on Wednesday 2026-11-11 at 9:00 Manila time.

/** A work project with a project manager, a coordinator and a member. */
create or replace function pg_temp.team_project(a uuid, c uuid, m uuid, p_title text) returns uuid
language plpgsql as $$
declare
  p uuid; v_inv uuid;
begin
  perform pg_temp.act_as(a);
  p := (public.create_general_project(p_title)).id;
  select id into v_inv from public.invite_to_general_project(p, c);
  perform pg_temp.act_as(c);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as(a);
  select id into v_inv from public.invite_to_general_project(p, m);
  perform pg_temp.act_as(m);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  update public.general_members set role = 'coordinator' where project_id = p and user_id = c;
  return p;
end;
$$;

/** A sprint in the given state, made the way the app makes one. */
create or replace function pg_temp.sprint(p uuid, p_name text, p_starts date, p_ends date, p_state text)
returns uuid language plpgsql as $$
declare
  s uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, p_name, p_starts, p_ends) returning id into s;
  if p_state in ('active', 'completed') then
    update public.general_sprints set state = 'active' where id = s;
  end if;
  if p_state = 'completed' then
    update public.general_sprints set state = 'completed' where id = s;
  end if;
  return s;
end;
$$;

/** A released task in a sprint. */
create or replace function pg_temp.task(p uuid, a uuid, s uuid, p_status text, p_archived boolean default false)
returns uuid language plpgsql as $$
declare
  t uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_tasks (routing_state, created_by, project_id, title, sprint_id, status, archived_at)
  values ('released', a, p, 'Zz automation task', s, p_status::public.general_task_status,
          case when p_archived then now() end)
  returning id into t;
  return t;
end;
$$;

/**
 * Moves the moment auto start was turned on. Only the job's switch gets a
 * write past the settings trigger, so this borrows it.
 */
create or replace function pg_temp.auto_start_since(p uuid, p_at timestamptz) returns void
language plpgsql as $$
begin
  perform set_config('collabify.sprint_automation', 'on', true);
  update public.general_sprint_settings set auto_start_since = p_at where project_id = p;
  perform set_config('collabify.sprint_automation', 'off', true);
end;
$$;

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Coord', 'Member', 'Away'];
  i int;
  a uuid; c uuid; m uuid; c2 uuid;
  p uuid; v_inv uuid;
  s1 uuid; s2 uuid; s3 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  n int;
  v_before text; v_after text;
  v_due  constant timestamptz := '2026-11-11 09:00 Asia/Manila';
  v_soon constant timestamptz := '2026-11-11 08:59 Asia/Manila';
begin
  perform pg_temp.act_as_service();
  for i in 1..4 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-sprintauto-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzsprintauto', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set can_teach = true, can_manage_projects = true
   where id = any (v_ids) and role = 'member';
  a := v_ids[1]; c := v_ids[2]; m := v_ids[3]; c2 := v_ids[4];

  ------------------------------------------------------------ settings the job reads
  p := pg_temp.team_project(a, c, m, 'Zz auto settings');
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('a run_at of 09:10 is refused',
    format($q$insert into public.general_sprint_settings (project_id, run_at) values (%L, '09:10')$q$, p));
  insert into public.general_sprint_settings (project_id, run_at) values (p, '17:45');
  perform pg_temp.must_be('a set time on the quarter hour is kept',
    (select run_at = '17:45' from public.general_sprint_settings where project_id = p));
  update public.general_sprint_settings set auto_created_after = gen_random_uuid() where project_id = p;
  perform pg_temp.must_be('a client cannot write auto_created_after',
    (select auto_created_after is null from public.general_sprint_settings where project_id = p));
  perform pg_temp.act_as_service();

  ------------------------------------------------------------ finish
  p := pg_temp.team_project(a, c, m, 'Zz auto finish timing');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'backlog');
  perform public.run_sprint_automation(v_soon, p);
  perform pg_temp.must_be('auto finish waits for the day after the end date and the set time',
    (select state = 'active' from public.general_sprints where id = s1));
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('auto finish finishes the sprint once that time arrives',
    (select state = 'completed' from public.general_sprints where id = s1));

  p := pg_temp.team_project(a, c, m, 'Zz auto finish catch up');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-27', '2026-11-09', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'backlog');
  perform public.run_sprint_automation(v_soon, p);
  perform pg_temp.must_be('a sprint whose end date passed two days ago finishes even before the set time',
    (select state = 'completed' from public.general_sprints where id = s1));

  p := pg_temp.team_project(a, c, m, 'Zz auto finish next');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  s3 := pg_temp.sprint(p, 'Sprint 3', '2026-11-25', '2026-12-08', 'planned');
  s2 := pg_temp.sprint(p, 'Sprint 2', '2026-11-11', '2026-11-24', 'planned');
  t1 := pg_temp.task(p, a, s1, 'todo');
  t2 := pg_temp.task(p, a, s1, 'done');
  t3 := pg_temp.task(p, a, s1, 'todo', true);
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'next');
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('leftovers move to the earliest planned sprint when carry is next',
    (select state = 'completed' from public.general_sprints where id = s1)
    and (select sprint_id = s2 from public.general_tasks where id = t1)
    and (select sprint_id = s1 from public.general_tasks where id = t2)
    and (select sprint_id = s1 from public.general_tasks where id = t3)
    and (select state = 'planned' from public.general_sprints where id = s2));
  perform pg_temp.must_be('the finish notice names where one leftover went',
    exists (select 1 from public.notifications
             where general_project_id = p and user_id = a and type = 'sprint_automation'
               and title = 'Sprint 1 finished on its own'
               and preview = '1 unfinished task moved to Sprint 2.'));

  p := pg_temp.team_project(a, c, m, 'Zz auto finish backlog');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  s2 := pg_temp.sprint(p, 'Sprint 2', '2026-11-11', '2026-11-24', 'planned');
  t1 := pg_temp.task(p, a, s1, 'todo');
  t2 := pg_temp.task(p, a, s1, 'in_progress');
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'backlog');
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('leftovers return to the backlog when carry is backlog',
    (select state = 'completed' from public.general_sprints where id = s1)
    and (select count(*) = 2 from public.general_tasks where id in (t1, t2) and sprint_id is null)
    and (select state = 'planned' from public.general_sprints where id = s2));
  perform pg_temp.must_be('the finish notice counts the tasks returned to the backlog',
    exists (select 1 from public.notifications
             where general_project_id = p and user_id = c and type = 'sprint_automation'
               and preview = '2 unfinished tasks returned to the backlog.'));

  ------------------------------------------------------------ start
  p := pg_temp.team_project(a, c, m, 'Zz auto start');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-14', '2026-10-27', 'completed');
  s3 := pg_temp.sprint(p, 'Sprint 3', '2026-11-25', '2026-12-08', 'planned');
  s2 := pg_temp.sprint(p, 'Sprint 2', '2026-11-11', '2026-11-24', 'planned');
  insert into public.general_sprint_settings (project_id, auto_start) values (p, true);
  perform public.run_sprint_automation('2026-11-10 09:00 Asia/Manila', p);
  perform public.run_sprint_automation(v_soon, p);
  perform pg_temp.must_be('auto start waits for the start date and the set time',
    (select state = 'planned' from public.general_sprints where id = s2));
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('auto start starts the earliest planned sprint once its start date and time arrive',
    (select state = 'active' from public.general_sprints where id = s2)
    and (select state = 'planned' from public.general_sprints where id = s3)
    and (select count(*) = 3 from public.general_sprints where project_id = p));
  perform pg_temp.must_be('the start notice gives the date range',
    exists (select 1 from public.notifications
             where general_project_id = p and user_id = a and type = 'sprint_automation'
               and title = 'Sprint 2 started on its own'
               and preview = 'Nov 11 to Nov 24, 2026'));

  p := pg_temp.team_project(a, c, m, 'Zz auto start catch up');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-13', '2026-10-26', 'completed');
  s2 := pg_temp.sprint(p, 'Sprint 2', '2026-11-10', '2026-11-23', 'planned');
  insert into public.general_sprint_settings (project_id, auto_start) values (p, true);
  perform public.run_sprint_automation(v_soon, p);
  perform pg_temp.must_be('a sprint whose start date has passed starts even before the set time',
    (select state = 'active' from public.general_sprints where id = s2));

  ------------------------------------------------------------ create
  p := pg_temp.team_project(a, c, m, 'Zz auto create');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry, auto_start, length_days, start_weekday)
  values (p, true, 'backlog', true, 7, 5);
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('auto start creates the next sprint when none is planned',
    (select state = 'completed' from public.general_sprints where id = s1)
    and (select count(*) = 2 from public.general_sprints where project_id = p)
    and exists (select 1 from public.general_sprints
                 where project_id = p and name = 'Sprint 2' and state = 'planned'
                   and starts_on = '2026-11-13' and ends_on = '2026-11-19'
                   and goal = '' and milestone_id is null));
  perform pg_temp.must_be('an automatic finish with carry backlog sends the create notice',
    (select count(*) = 1 from public.notifications
      where general_project_id = p and user_id = a and type = 'sprint_automation'
        and title = 'Sprint 2 was created on its own'
        and preview = 'It runs Nov 13 to Nov 19, 2026.'));
  perform public.run_sprint_automation('2026-11-13 08:59 Asia/Manila', p);
  perform pg_temp.must_be('the created sprint waits for its day',
    (select state = 'planned' from public.general_sprints where project_id = p and name = 'Sprint 2'));
  perform public.run_sprint_automation('2026-11-13 09:00 Asia/Manila', p);
  perform pg_temp.must_be('then starts it when its day comes',
    (select state = 'active' from public.general_sprints where project_id = p and name = 'Sprint 2'));

  p := pg_temp.team_project(a, c, m, 'Zz auto create too early');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'completed');
  insert into public.general_sprint_settings (project_id, auto_start) values (p, true);
  -- The sprint finished a minute before auto start was turned on.
  perform pg_temp.auto_start_since(p, now() + interval '1 minute');
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('no sprint is created before auto start was turned on',
    (select count(*) = 1 from public.general_sprints where project_id = p));

  p := pg_temp.team_project(a, c, m, 'Zz auto create past due');
  update public.general_projects set ends_on = '2026-11-12' where id = p;
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  t1 := pg_temp.task(p, a, s1, 'todo');
  insert into public.general_sprint_settings (project_id, auto_finish, carry, auto_start, start_weekday)
  values (p, true, 'next', true, 5);
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('no sprint is created past the project due date',
    (select state = 'completed' from public.general_sprints where id = s1)
    and (select count(*) = 1 from public.general_sprints where project_id = p)
    and (select sprint_id is null from public.general_tasks where id = t1)
    and (select auto_created_after = s1 from public.general_sprint_settings where project_id = p));
  update public.general_projects set ends_on = '2026-11-30' where id = p;
  perform public.run_sprint_automation('2026-11-12 09:00 Asia/Manila', p);
  perform pg_temp.must_be('extending the due date afterwards still creates nothing',
    (select count(*) = 1 from public.general_sprints where project_id = p));

  p := pg_temp.team_project(a, c, m, 'Zz auto create on the due date');
  update public.general_projects set ends_on = '2026-11-13' where id = p;
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry, auto_start, start_weekday)
  values (p, true, 'backlog', true, 5);
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('a sprint that starts on the due date is still created',
    exists (select 1 from public.general_sprints
             where project_id = p and name = 'Sprint 2' and starts_on = '2026-11-13'));

  p := pg_temp.team_project(a, c, m, 'Zz auto create after manual');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_start, start_weekday) values (p, true, 5);
  perform pg_temp.act_as(a);
  perform public.complete_general_sprint(s1, null);
  perform pg_temp.act_as_service();
  perform public.run_sprint_automation(v_soon, p);
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('after a manual finish, creates the next sprint once',
    (select count(*) = 1 from public.general_sprints where project_id = p and state = 'planned')
    and (select count(*) = 2 from public.general_sprints where project_id = p));
  perform pg_temp.must_be('after a manual finish, the create notice is sent',
    (select count(*) = 1 from public.notifications
      where general_project_id = p and user_id = c and type = 'sprint_automation'
        and title = 'Sprint 2 was created on its own'
        and preview = 'It runs Nov 13 to Nov 26, 2026.'));
  delete from public.general_sprints where project_id = p and state = 'planned';
  perform public.run_sprint_automation(v_due, p);
  perform public.run_sprint_automation('2026-11-12 09:00 Asia/Manila', p);
  perform pg_temp.must_be('a created sprint that was deleted is not created again',
    (select count(*) = 1 from public.general_sprints where project_id = p));

  ------------------------------------------------------------ a whole cycle, twice
  p := pg_temp.team_project(a, c, m, 'Zz auto cycle');
  perform pg_temp.act_as(a);
  select id into v_inv from public.invite_to_general_project(p, c2);
  perform pg_temp.act_as(c2);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  update public.general_members set role = 'coordinator' where project_id = p and user_id = c2;
  update public.profiles set status = 'pending' where id = c2;
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  t1 := pg_temp.task(p, a, s1, 'todo');
  -- No start day is set: the first sprint started on a Wednesday, and so does 2026-11-11.
  insert into public.general_sprint_settings (project_id, auto_finish, carry, auto_start)
  values (p, true, 'next', true);
  perform pg_temp.must_be('a run reports the project it changed',
    public.run_sprint_automation(v_due, p) = 1);
  perform pg_temp.must_be('a created sprint that starts today starts in the same run',
    (select state = 'completed' from public.general_sprints where id = s1)
    and exists (select 1 from public.general_sprints s join public.general_tasks t on t.sprint_id = s.id
                 where s.project_id = p and s.name = 'Sprint 2' and s.state = 'active'
                   and s.starts_on = '2026-11-11' and s.ends_on = '2026-11-24' and t.id = t1));

  select string_agg(name || ':' || state || ':' || starts_on, ',' order by name)
         || '|' || (select count(*) from public.notifications where general_project_id = p)
         || '|' || (select coalesce(sprint_id::text, '-') from public.general_tasks where id = t1)
         || '|' || (select coalesce(auto_created_after::text, '-') from public.general_sprint_settings where project_id = p)
    into v_before
    from public.general_sprints where project_id = p;
  perform pg_temp.must_be('a second run reports no change',
    public.run_sprint_automation(v_due, p) = 0);
  select string_agg(name || ':' || state || ':' || starts_on, ',' order by name)
         || '|' || (select count(*) from public.notifications where general_project_id = p)
         || '|' || (select coalesce(sprint_id::text, '-') from public.general_tasks where id = t1)
         || '|' || (select coalesce(auto_created_after::text, '-') from public.general_sprint_settings where project_id = p)
    into v_after
    from public.general_sprints where project_id = p;
  perform pg_temp.must_be('a second run changes nothing', v_before = v_after);

  perform pg_temp.must_be('the project manager and coordinators are notified of each automatic action',
    (select count(*) = 3 from public.notifications
      where general_project_id = p and type = 'sprint_automation' and user_id = a)
    and (select count(*) = 3 from public.notifications
          where general_project_id = p and type = 'sprint_automation' and user_id = c)
    and (select count(*) = 1 from public.notifications
          where general_project_id = p and type = 'sprint_automation' and user_id = a
            and title = 'Sprint 1 finished on its own' and preview = '1 unfinished task moved to Sprint 2.')
    and (select count(*) = 1 from public.notifications
          where general_project_id = p and type = 'sprint_automation' and user_id = a
            and title = 'Sprint 2 was created on its own' and preview = 'It runs Nov 11 to Nov 24, 2026.')
    and (select count(*) = 1 from public.notifications
          where general_project_id = p and type = 'sprint_automation' and user_id = a
            and title = 'Sprint 2 started on its own'));
  perform pg_temp.must_be('members and inactive coordinators are not notified',
    not exists (select 1 from public.notifications
                 where general_project_id = p and type = 'sprint_automation' and user_id in (m, c2)));

  ------------------------------------------------------------ skipped
  p := pg_temp.team_project(a, c, m, 'Zz auto archived');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'backlog');
  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, true);
  perform pg_temp.act_as_service();
  perform public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('archived projects are skipped',
    (select state = 'active' from public.general_sprints where id = s1));

  -- A finished sprint ending on the last day a date can hold: the next start
  -- day is out of range, so creating the next sprint raises.
  p := pg_temp.team_project(a, c, m, 'Zz auto fails');
  s2 := pg_temp.sprint(p, 'Sprint 0', '2026-10-01', '5874897-12-31', 'completed');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  t1 := pg_temp.task(p, a, s1, 'todo');
  insert into public.general_sprint_settings (project_id, auto_finish, carry, auto_start)
  values (p, true, 'backlog', true);
  n := public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('a project that fails is logged and skipped, and the run returns',
    n = 0
    and (select state = 'active' from public.general_sprints where id = s1)
    and (select sprint_id = s1 from public.general_tasks where id = t1)
    and (select auto_created_after is null from public.general_sprint_settings where project_id = p)
    and not exists (select 1 from public.notifications
                     where general_project_id = p and type = 'sprint_automation'));
  -- The same call over every project goes on to the next one; with one project
  -- per call here, the next project runs in its own call.
  p := pg_temp.team_project(a, c, m, 'Zz auto after a failure');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-28', '2026-11-10', 'active');
  insert into public.general_sprint_settings (project_id, auto_finish, carry) values (p, true, 'backlog');
  n := public.run_sprint_automation(v_due, p);
  perform pg_temp.must_be('the next project still runs after one fails',
    n = 1
    and (select state = 'completed' from public.general_sprints where id = s1));

  ------------------------------------------------------------ the start day
  p := pg_temp.team_project(a, c, m, 'Zz start day');
  perform pg_temp.must_be('with no sprints and no start day, a new sprint starts on a Monday',
    public.general_next_sprint_start(p, '2026-11-11') = '2026-11-16');
  s1 := pg_temp.sprint(p, 'Sprint 1', '2026-10-29', '2026-11-04', 'completed');
  perform pg_temp.must_be('start weekday falls back to the first sprint, then Monday',
    public.general_next_sprint_start(p, '2026-11-11') = '2026-11-12'
    and public.general_next_sprint_start(p, '2026-11-01') = '2026-11-05');
  insert into public.general_sprint_settings (project_id, start_weekday) values (p, 1);
  perform pg_temp.must_be('a set start day wins over the first sprint',
    public.general_next_sprint_start(p, '2026-11-11') = '2026-11-16');
end;
$$;

rollback;
