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

rollback;
