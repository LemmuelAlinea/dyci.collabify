-- A task's start date. Rolls back; nothing here survives.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  t        uuid;
  d        jsonb;
  n        int;
  ts       timestamptz := now();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Sched', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'sched-owner@test.local', 'Owner'),
                 (other_id, 'sched-other@test.local', 'Other')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Schedule project', '');

  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Plan it', owner_id) returning id into t;

  ------------------------------------------------------------------ the column
  perform pg_temp.ok('a task starts with no start date',
                     (select starts_at from public.general_tasks where id = t) is null);

  update public.general_tasks
     set starts_at = ts, due_at = ts + interval '5 days' where id = t;
  perform pg_temp.ok('a start before its due date is accepted',
                     (select starts_at from public.general_tasks where id = t) = ts);

  begin
    update public.general_tasks set starts_at = ts + interval '9 days' where id = t;
    perform pg_temp.ok('a start after its due date is refused', false);
  exception when check_violation then
    perform pg_temp.ok('a start after its due date is refused', true);
  end;

  -- A control: the same start on the same day as the due date is fine.
  update public.general_tasks set starts_at = ts + interval '5 days' where id = t;
  perform pg_temp.ok('a start on the due date is accepted',
                     (select starts_at from public.general_tasks where id = t) = ts + interval '5 days');

  begin
    insert into public.general_tasks (project_id, title, created_by, starts_at)
    values (proj.id, 'No due date', owner_id, ts);
    perform pg_temp.ok('a start with no due date is accepted', true);
  exception when others then
    perform pg_temp.ok('a start with no due date is accepted', false);
  end;

  ------------------------------------------------------------------ the history
  update public.general_tasks set starts_at = ts + interval '1 day' where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('the history names the start among the changed fields',
                     (d -> 'fields') ? 'starts_at');
  perform pg_temp.ok('the history keeps where the start came from',
                     (d ->> 'starts_from')::timestamptz = ts + interval '5 days');
  perform pg_temp.ok('the history keeps where the start went',
                     (d ->> 'starts_to')::timestamptz = ts + interval '1 day');

  update public.general_tasks set starts_at = null where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('taking the start off is recorded as a change',
                     (d -> 'fields') ? 'starts_at' and d ->> 'starts_to' is null);

  update public.general_tasks set title = 'Plan it properly' where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('a change that leaves the start alone does not mention it',
                     not ((d -> 'fields') ? 'starts_at'));

  ------------------------------------------------------------------ the overview
  select count(*) into n from public.general_task_overview where id = t;
  perform pg_temp.ok('the overview still returns the task', n = 1);

  update public.general_tasks set starts_at = ts where id = t;
  perform pg_temp.ok('the overview carries the start date',
                     (select starts_at from public.general_task_overview where id = t) = ts);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(other_id);
  select count(*) into n from public.general_task_overview where id = t;
  perform pg_temp.ok('a stranger still reads nothing', n = 0);
end $$;

-- Task 6's exemption test: a Member with manage_structure but not manage_tasks
-- may clear a task's team through guard_general_task's cascade exemption, and
-- must not be able to ride a start-date move along with it. Requires
-- supabase/general-schedule-guard.sql.
do $$ begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  owner_id      uuid := gen_random_uuid();
  structurer_id uuid := gen_random_uuid();
  proj          public.general_projects%rowtype;
  team          uuid;
  t             uuid;
  inv           uuid;
  ts            timestamptz := now();
  v_starts      timestamptz;
  v_team        uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Sched', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'sched-owner2@test.local', 'Owner2'),
                 (structurer_id, 'sched-structurer@test.local', 'Structurer')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Schedule guard project', '');
  insert into public.general_teams (project_id, name) values (proj.id, 'Logistics') returning id into team;

  -- A task the structurer neither holds nor created, already on the team, with
  -- a start date set.
  insert into public.general_tasks (project_id, team_id, title, created_by, starts_at, due_at)
  values (proj.id, team, 'Owned by someone else', owner_id, ts, ts + interval '10 days')
  returning id into t;

  select id into inv from public.invite_to_general_project(proj.id, structurer_id);
  perform pg_temp.act_as(structurer_id);
  perform public.respond_general_invitation(inv, true);
  perform pg_temp.act_as(owner_id);
  perform public.grant_general_permission(proj.id, structurer_id, 'manage_structure');

  perform pg_temp.act_as(structurer_id);

  begin
    update public.general_tasks
       set team_id = null, starts_at = ts + interval '1 day'
     where id = t;
    perform pg_temp.ok(
      'a Member with only manage_structure may not move the start while clearing the team', false);
  exception when insufficient_privilege then
    perform pg_temp.ok(
      'a Member with only manage_structure may not move the start while clearing the team', true);
  end;

  select starts_at, team_id into v_starts, v_team from public.general_tasks where id = t;
  perform pg_temp.ok('the refused update left the start and the team untouched',
                     v_starts = ts and v_team = team);

  -- Control: the same person, the same exemption, but starts_at untouched.
  update public.general_tasks set team_id = null where id = t;
  perform pg_temp.ok('...while clearing the team alone still goes through',
                     (select team_id from public.general_tasks where id = t) is null);
end $$;

rollback;
