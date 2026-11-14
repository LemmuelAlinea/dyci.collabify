-- supabase/tests/offboarding.test.sql
-- Offboarding: the admin's preview of what a member holds, and the one-step offboard that
-- hands it over and deactivates them. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/offboarding.sql supabase/anon-lockdown.sql supabase/tests/offboarding.test.sql
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

/** Runs a statement and asserts it is refused with exactly this message. */
create or replace function pg_temp.must_refuse_exact(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 80);
      return;
    end if;
    raise exception 'FAIL  % — refused with another message: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the call went through and should not have', p_label;
end;
$$;

/** The project role a person holds, read as the database. */
create or replace function pg_temp.prole(p_project uuid, p_user uuid) returns text
language sql as $$
  select role::text from public.general_members where project_id = p_project and user_id = p_user;
$$;

/** The space role a person holds, read as the database. */
create or replace function pg_temp.srole(p_space uuid, p_user uuid) returns text
language sql as $$
  select role::text from public.general_space_members where space_id = p_space and user_id = p_user;
$$;

create or replace function pg_temp.holds(p_task uuid, p_user uuid) returns boolean
language sql as $$
  select exists (select 1 from public.general_task_assignees where task_id = p_task and user_id = p_user);
$$;

create or replace function pg_temp.unassigned(p_task uuid, p_user uuid) returns int
language sql as $$
  select count(*)::int from public.general_task_events
   where task_id = p_task and kind = 'unassigned' and detail->>'user_id' = p_user::text;
$$;

do $$
declare
  v_a    uuid := gen_random_uuid();  -- the active admin
  v_pa   uuid := gen_random_uuid();  -- an admin still pending
  v_t    uuid := gen_random_uuid();  -- the person leaving: member, Project manager on
  v_s1   uuid := gen_random_uuid();  -- successor: member, Project manager on
  v_s2   uuid := gen_random_uuid();  -- second successor: member, Project manager on
  v_s3   uuid := gen_random_uuid();  -- a deactivated member, Project manager on
  v_m    uuid := gen_random_uuid();  -- member without the Project manager switch
  v_x    uuid := gen_random_uuid();  -- an admin with Project manager on
  v_q    uuid := gen_random_uuid();  -- member who runs spaces, Project manager later off
  ws1    uuid;  -- live work space T runs
  ws2    uuid;  -- archived work space T runs
  p1     uuid;  -- T's project in WS1, S1 already Coordinator
  p2     uuid;  -- T's archived project in WS1
  p3     uuid;  -- S1's project, T Coordinator
  t1     uuid;  -- team on P1 that T leads
  t2     uuid;  -- team on P2 that T leads
  r1     uuid;  -- review on P1 waiting on T
  r2     uuid;  -- review on P1 waiting on T
  k1     uuid;  -- open, P1, T and M hold it
  k2     uuid;  -- done, P1
  k3     uuid;  -- archived, P1
  k4     uuid;  -- open, in archived P2
  k5     uuid;  -- open, P3
  k6     uuid;  -- planning, P1
  wsa    uuid;  -- S2's space: a working PM
  wsb    uuid;  -- Q's space: Q's switch goes off; filed in office O
  wsc    uuid;  -- a space with no pm row
  wsd    uuid;  -- a space whose PM (S3) is deactivated
  wse    uuid;  -- an archived space Q runs
  pb     uuid;  -- Q's project in WSB
  o      uuid;  -- an office
  r      record;
  n      int;
  v_err  text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_a,  'zz-ob-a@example.test'),
      (v_pa, 'zz-ob-pa@example.test'),
      (v_t,  'zz-ob-t@example.test'),
      (v_s1, 'zz-ob-s1@example.test'),
      (v_s2, 'zz-ob-s2@example.test'),
      (v_s3, 'zz-ob-s3@example.test'),
      (v_m,  'zz-ob-m@example.test'),
      (v_x,  'zz-ob-x@example.test'),
      (v_q,  'zz-ob-q@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_a,  'zz-ob-a@example.test',  'Zz', 'Oba',  'admin',  'active',   false, false),
    (v_pa, 'zz-ob-pa@example.test', 'Zz', 'Obpa', 'admin',  'pending',  false, false),
    (v_t,  'zz-ob-t@example.test',  'Zz', 'Obt',  'member', 'active',   false, true),
    (v_s1, 'zz-ob-s1@example.test', 'Zz', 'Obs1', 'member', 'active',   false, true),
    (v_s2, 'zz-ob-s2@example.test', 'Zz', 'Obs2', 'member', 'active',   false, true),
    (v_s3, 'zz-ob-s3@example.test', 'Zz', 'Obs3', 'member', 'rejected', false, true),
    (v_m,  'zz-ob-m@example.test',  'Zz', 'Obm',  'member', 'active',   false, false),
    (v_x,  'zz-ob-x@example.test',  'Zz', 'Obx',  'admin',  'active',   false, true),
    (v_q,  'zz-ob-q@example.test',  'Zz', 'Obq',  'member', 'active',   false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  -- ------------------------------------------------------------ fixtures

  perform pg_temp.act_as(v_t);
  ws1 := (public.create_general_space('Zz Ob space one', '')).id;
  ws2 := (public.create_general_space('Zz Ob space two', '')).id;
  p1 := (public.create_general_project('Zz Ob P1', '', null, null, null, null, ws1)).id;
  p2 := (public.create_general_project('Zz Ob P2', '', null, null, null, null, ws1)).id;
  perform pg_temp.act_as(v_s1);
  p3 := (public.create_general_project('Zz Ob P3', '')).id;

  perform pg_temp.act_as_service();
  update public.general_projects set allow_multiple_assignees = true where id = p1;
  insert into public.general_members (project_id, user_id, role) values
    (p1, v_s1, 'coordinator'),
    (p1, v_m,  'member'),
    (p3, v_t,  'coordinator');
  -- A grant the successor holds on P1, which becoming its PM clears.
  insert into public.general_grants (project_id, user_id, permission) values (p1, v_s1, 'manage_tasks');

  insert into public.general_teams (project_id, name) values (p1, 'Zz Ob team one') returning id into t1;
  insert into public.general_teams (project_id, name) values (p2, 'Zz Ob team two') returning id into t2;
  insert into public.general_team_members (project_id, team_id, user_id) values (p1, t1, v_t), (p2, t2, v_t);
  update public.general_teams set leader_id = v_t where id in (t1, t2);

  insert into public.general_tasks (project_id, title, routing_state, reviewer_id, status, stage, created_by)
  values (p1, 'Zz Ob review one', 'coordinator_review', v_t, 'in_progress', 1, v_t) returning id into r1;
  insert into public.general_tasks (project_id, title, routing_state, reviewer_id, status, stage, created_by)
  values (p1, 'Zz Ob review two', 'coordinator_review', v_t, 'in_progress', 1, v_t) returning id into r2;

  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p1, 'Zz Ob K1', 'released', v_t) returning id into k1;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p1, 'Zz Ob K2', 'released', v_t) returning id into k2;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p1, 'Zz Ob K3', 'released', v_t) returning id into k3;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p2, 'Zz Ob K4', 'released', v_t) returning id into k4;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p3, 'Zz Ob K5', 'released', v_s1) returning id into k5;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  values (p1, 'Zz Ob K6', 'planning', v_t) returning id into k6;
  insert into public.general_task_assignees (project_id, task_id, user_id) values
    (p1, k1, v_t), (p1, k1, v_m), (p1, k2, v_t), (p1, k3, v_t),
    (p2, k4, v_t), (p3, k5, v_t), (p1, k6, v_t);
  update public.general_tasks set status = 'done' where id = k2;
  update public.general_tasks set archived_at = now(), archived_by = v_t where id = k3;

  update public.general_projects set archived_at = now() where id = p2;
  update public.general_spaces set archived_at = now() where id = ws2;

  perform pg_temp.must_be('fixtures: T runs both spaces and P1, P2; S1 runs P3',
    pg_temp.srole(ws1, v_t) = 'pm' and pg_temp.srole(ws2, v_t) = 'pm'
    and pg_temp.prole(p1, v_t) = 'pm' and pg_temp.prole(p2, v_t) = 'pm'
    and pg_temp.prole(p3, v_s1) = 'pm' and pg_temp.prole(p3, v_t) = 'coordinator'
    and pg_temp.srole(ws1, v_s1) = 'member' and pg_temp.srole(ws2, v_s1) is null);

  -- ------------------------------------------------------------ preview

  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_refuse_exact('preview refuses a non-admin',
    format('select * from public.admin_offboarding_preview(%L)', v_t),
    'Only an admin can offboard someone.');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('preview refuses an inactive admin',
    format('select * from public.admin_offboarding_preview(%L)', v_t),
    'Only an admin can offboard someone.');

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('preview lists 2 spaces, 2 projects, 2 teams, 1 reviewer line with 2, open_tasks 3',
    (select count(*) from public.admin_offboarding_preview(v_t) x
      where x.kind = 'space_pm' and x.item_id in (ws1, ws2)) = 2
    and exists (select 1 from public.admin_offboarding_preview(v_t) x
                 where x.kind = 'space_pm' and x.item_id = ws2 and x.archived
                   and x.item_name = 'Zz Ob space two')
    and (select count(*) from public.admin_offboarding_preview(v_t) x
          where x.kind = 'project_pm' and x.item_id in (p1, p2)) = 2
    and exists (select 1 from public.admin_offboarding_preview(v_t) x
                 where x.kind = 'project_pm' and x.item_id = p2 and x.archived
                   and x.space_name = 'Zz Ob space one')
    and (select count(*) from public.admin_offboarding_preview(v_t) x
          where x.kind = 'team_lead') = 2
    and exists (select 1 from public.admin_offboarding_preview(v_t) x
                 where x.kind = 'team_lead' and x.item_id = t2 and x.item_name = 'Zz Ob team two'
                   and x.project_name = 'Zz Ob P2' and x.archived)
    and (select count(*) from public.admin_offboarding_preview(v_t) x where x.kind = 'reviewer') = 1
    and exists (select 1 from public.admin_offboarding_preview(v_t) x
                 where x.kind = 'reviewer' and x.item_id = p1 and x.task_count = 2)
    and exists (select 1 from public.admin_offboarding_preview(v_t) x
                 where x.kind = 'open_tasks' and x.item_id is null and x.task_count = 3)
    and (select count(*) from public.admin_offboarding_preview(v_t)) = 8);
  perform pg_temp.must_be('preview is ordered space, project, team, reviewer, open_tasks',
    (select array_agg(x.kind) from public.admin_offboarding_preview(v_t) x)
      = array['space_pm', 'space_pm', 'project_pm', 'project_pm', 'team_lead', 'team_lead',
              'reviewer', 'open_tasks']
    and (select array_agg(x.item_id) from public.admin_offboarding_preview(v_t) x
          where x.kind = 'space_pm') = array[ws1, ws2]);
  perform pg_temp.must_be('preview is zero rows for someone who holds nothing',
    (select count(*) from public.admin_offboarding_preview(v_s2)) = 0);
  perform pg_temp.must_be('preview returns exactly its columns',
    pg_get_function_result('public.admin_offboarding_preview(uuid)'::regprocedure)
      = 'TABLE(kind text, item_id uuid, item_name text, project_name text, space_name text, office_name text, archived boolean, task_count integer)');

  -- ------------------------------------------------------------ refusals

  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_refuse_exact('offboard refuses a non-admin',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_s2),
    'Only an admin can offboard someone.');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('offboard refuses an inactive admin',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_s2),
    'Only an admin can offboard someone.');
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('offboard refuses the target being an admin',
    format('select public.admin_offboard_member(%L, %L)', v_x, v_s1),
    'Only an active member can be offboarded here.');
  perform pg_temp.must_refuse_exact('offboard refuses the admin themself',
    format('select public.admin_offboard_member(%L, %L)', v_a, v_s1),
    'Only an active member can be offboarded here.');
  perform pg_temp.must_refuse_exact('offboard refuses an inactive target',
    format('select public.admin_offboard_member(%L, %L)', v_s3, v_s1),
    'Only an active member can be offboarded here.');
  perform pg_temp.must_refuse_exact('offboard refuses a successor without Project manager',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_m),
    'Zz Obm needs Project manager turned on first. Turn it on in Accounts.');
  perform pg_temp.must_refuse_exact('offboard refuses an admin successor',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_x),
    'Only an active member can take over.');
  perform pg_temp.must_refuse_exact('offboard refuses the target as successor',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_t),
    'Choose someone else to take over.');
  perform pg_temp.must_refuse_exact('offboard refuses the target as an override',
    format('select public.admin_offboard_member(%L, %L, %L)', v_t, v_s1, jsonb_build_object(p1, v_t)),
    'Choose someone else to take over.');
  perform pg_temp.must_refuse_exact('offboard refuses an inactive successor',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_s3),
    'Only an active member can take over.');

  -- ------------------------------------------------------------ a forced failure

  begin
    perform public.admin_offboard_member(v_t, v_s1, jsonb_build_object(p1, v_m));
    raise exception 'FAIL  an override naming M rolls back everything — the call went through';
  exception when others then
    v_err := sqlerrm;
    if v_err like 'FAIL%' then raise; end if;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an override naming M rolls back everything',
    v_err = 'Zz Obm needs Project manager turned on first. Turn it on in Accounts.'
    and (select status = 'active' from public.profiles where id = v_t)
    and pg_temp.prole(p1, v_t) = 'pm' and pg_temp.srole(ws1, v_t) = 'pm'
    and pg_temp.holds(k1, v_t)
    and (select leader_id = v_t from public.general_teams where id = t1)
    and not exists (select 1 from public.audit_events where action::text = 'offboarded'
                     and subject_id = v_t));

  -- ------------------------------------------------------------ a line gone since the preview

  -- Someone takes T off P1's pm seat between the preview and the confirm. The call works
  -- from what is there now, so it skips that line. Undone afterwards by a savepoint.
  begin
    perform pg_temp.act_as_service();
    update public.general_members set role = 'coordinator' where project_id = p1 and user_id = v_t;
    perform pg_temp.act_as(v_a);
    perform public.admin_offboard_member(v_t, v_s1);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('a line gone since the preview is skipped',
      (select status = 'rejected' from public.profiles where id = v_t)
      and pg_temp.prole(p1, v_s1) = 'coordinator'
      and pg_temp.prole(p2, v_s1) = 'pm'
      and (select reviewer_id = v_t from public.general_tasks where id = r1)
      and exists (select 1 from public.audit_events where action::text = 'offboarded'
                   and subject_id = v_t and before_value = '2 spaces, 1 project, 2 teams, 3 tasks'));
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the savepoint put everything back',
    pg_temp.prole(p1, v_t) = 'pm'
    and (select status = 'active' from public.profiles where id = v_t));

  -- ------------------------------------------------------------ a successor already QA or a stakeholder

  -- S1 is on P1 as QA, then as a stakeholder. Either way S1 ends as its PM with one row.
  -- Undone afterwards by a savepoint each time.
  begin
    perform pg_temp.act_as_service();
    update public.general_members set role = 'qa' where project_id = p1 and user_id = v_s1;
    perform pg_temp.act_as(v_a);
    perform public.admin_offboard_member(v_t, v_s1);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('a successor who is QA on the project becomes its PM with one row',
      pg_temp.prole(p1, v_s1) = 'pm' and pg_temp.prole(p1, v_t) = 'coordinator'
      and (select count(*) from public.general_members where project_id = p1 and user_id = v_s1) = 1
      and (select count(*) from public.general_members where project_id = p1 and role = 'pm') = 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;
  begin
    perform pg_temp.act_as_service();
    update public.general_members set role = 'stakeholder' where project_id = p1 and user_id = v_s1;
    perform pg_temp.act_as(v_a);
    perform public.admin_offboard_member(v_t, v_s1);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('a successor who is a stakeholder on the project becomes its PM with one row',
      pg_temp.prole(p1, v_s1) = 'pm' and pg_temp.prole(p1, v_t) = 'coordinator'
      and (select count(*) from public.general_members where project_id = p1 and user_id = v_s1) = 1
      and (select count(*) from public.general_members where project_id = p1 and role = 'pm') = 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and S1 is P1''s Coordinator again',
    pg_temp.prole(p1, v_s1) = 'coordinator' and pg_temp.prole(p1, v_t) = 'pm');

  -- ------------------------------------------------------------ a failure after the writes begin

  -- A trigger refuses T's status change, the last write, so the call fails after every
  -- handover write. Nothing it wrote survives.
  perform pg_temp.act_as_service();
  execute format($f$
    create function public.zz_ob_fail_status() returns trigger language plpgsql as $b$
    begin
      if new.id = %L::uuid then raise exception 'zz forced failure'; end if;
      return new;
    end $b$ $f$, v_t);
  create trigger zz_ob_fail_status before update on public.profiles
    for each row execute function public.zz_ob_fail_status();
  v_err := null;
  begin
    perform pg_temp.act_as(v_a);
    perform public.admin_offboard_member(v_t, v_s1);
  exception when others then
    v_err := sqlerrm;
  end;
  perform pg_temp.act_as_service();
  drop trigger zz_ob_fail_status on public.profiles;
  drop function public.zz_ob_fail_status();
  perform pg_temp.must_be('a failure at the status step rolls back every handover write',
    v_err = 'zz forced failure'
    and (select status = 'active' from public.profiles where id = v_t)
    and pg_temp.srole(ws1, v_t) = 'pm' and pg_temp.srole(ws1, v_s1) = 'member'
    and pg_temp.prole(p1, v_t) = 'pm' and pg_temp.prole(p1, v_s1) = 'coordinator'
    and (select leader_id = v_t from public.general_teams where id = t1)
    and (select count(*) from public.general_tasks where id in (r1, r2) and reviewer_id = v_t) = 2
    and pg_temp.holds(k1, v_t)
    and not exists (select 1 from public.audit_events where action::text = 'offboarded'
                     and subject_id = v_t));

  -- ------------------------------------------------------------ the offboard

  perform pg_temp.act_as(v_a);
  perform public.admin_offboard_member(v_t, v_s1, jsonb_build_object(p2, v_s2));

  perform pg_temp.must_be('the admin''s identity is restored after the review step',
    auth.uid() = v_a
    and current_setting('collabify.space_role_cascade', true) = 'off'
    and current_setting('collabify.team_leader_clear', true) = 'off');

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('WS1 and WS2 have S1 as PM and T as Coordinator',
    pg_temp.srole(ws1, v_s1) = 'pm' and pg_temp.srole(ws2, v_s1) = 'pm'
    and pg_temp.srole(ws1, v_t) = 'coordinator' and pg_temp.srole(ws2, v_t) = 'coordinator'
    and (select count(*) from public.general_space_members where space_id = ws2 and role = 'pm') = 1);
  perform pg_temp.must_be('P1 has S1 as PM, one row for S1, T is Coordinator',
    pg_temp.prole(p1, v_s1) = 'pm' and pg_temp.prole(p1, v_t) = 'coordinator'
    and (select count(*) from public.general_members where project_id = p1 and user_id = v_s1) = 1
    and (select count(*) from public.general_members where project_id = p1 and role = 'pm') = 1
    and (select level::text from public.general_members where project_id = p1 and user_id = v_s1) = 'owner');
  perform pg_temp.must_be('S1''s grants on P1 are cleared',
    not exists (select 1 from public.general_grants where project_id = p1 and user_id = v_s1));
  perform pg_temp.must_be('P2 has S2 as PM',
    pg_temp.prole(p2, v_s2) = 'pm' and pg_temp.prole(p2, v_t) = 'coordinator'
    and pg_temp.prole(p2, v_s1) is null);
  perform pg_temp.must_be('P3 is unchanged',
    pg_temp.prole(p3, v_s1) = 'pm' and pg_temp.prole(p3, v_t) = 'coordinator'
    and (select count(*) from public.general_members where project_id = p3) = 2);
  perform pg_temp.must_be('T1 and T2 have no leader',
    (select count(*) from public.general_teams where id in (t1, t2) and leader_id is null) = 2);
  perform pg_temp.must_be('both reviews now name S1',
    (select count(*) from public.general_tasks
      where id in (r1, r2) and reviewer_id = v_s1 and routing_state = 'coordinator_review') = 2);
  perform pg_temp.must_be('K1, K5, K6 lose T, K1 keeps M',
    not pg_temp.holds(k1, v_t) and not pg_temp.holds(k5, v_t) and not pg_temp.holds(k6, v_t)
    and pg_temp.holds(k1, v_m));
  perform pg_temp.must_be('K2, K3, K4 keep T',
    pg_temp.holds(k2, v_t) and pg_temp.holds(k3, v_t) and pg_temp.holds(k4, v_t));
  perform pg_temp.must_be('each removed assignee left exactly one unassigned event',
    pg_temp.unassigned(k1, v_t) = 1 and pg_temp.unassigned(k5, v_t) = 1
    and pg_temp.unassigned(k6, v_t) = 1
    and pg_temp.unassigned(k1, v_m) = 0 and pg_temp.unassigned(k2, v_t) = 0
    and pg_temp.unassigned(k3, v_t) = 0 and pg_temp.unassigned(k4, v_t) = 0
    and (select actor_id from public.general_task_events
          where task_id = k1 and kind = 'unassigned') = v_a);
  perform pg_temp.must_be('T is deactivated',
    exists (select 1 from public.profiles
             where id = v_t and status = 'rejected' and decided_by = v_a and decided_at is not null)
    and exists (select 1 from public.audit_events
                 where action = 'status_changed' and subject_id = v_t and actor_id = v_a
                   and after_value = 'rejected'));
  perform pg_temp.must_be('one offboarded audit row: after_value = S1''s name, before_value = ''2 spaces, 2 projects, 2 teams, 3 tasks''',
    (select count(*) from public.audit_events where action::text = 'offboarded' and subject_id = v_t) = 1
    and exists (select 1 from public.audit_events
                 where action::text = 'offboarded' and subject_id = v_t and actor_id = v_a
                   and subject_label = 'Zz Obt' and after_value = 'Zz Obs1'
                   and before_value = '2 spaces, 2 projects, 2 teams, 3 tasks'));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('preview after the offboard is empty',
    (select count(*) from public.admin_offboarding_preview(v_t)) = 0);
  perform pg_temp.must_refuse_exact('a second offboard is refused: T is no longer active',
    format('select public.admin_offboard_member(%L, %L)', v_t, v_s1),
    'Only an active member can be offboarded here.');

  perform pg_temp.must_be('the audit enum has offboarded and space_pm_assigned',
    'offboarded' = any (enum_range(null::public.audit_action)::text[])
    and 'space_pm_assigned' = any (enum_range(null::public.audit_action)::text[]));

  -- ------------------------------------------------------------ a stuck space and the oversight reads

  perform pg_temp.act_as(v_s2);
  wsa := (public.create_general_space('Zz Ob healthy', '')).id;
  perform pg_temp.act_as(v_q);
  wsb := (public.create_general_space('Zz Ob switched off', '')).id;
  wsc := (public.create_general_space('Zz Ob no pm', '')).id;
  wsd := (public.create_general_space('Zz Ob deactivated pm', '')).id;
  wse := (public.create_general_space('Zz Ob archived', '')).id;
  pb := (public.create_general_project('Zz Ob PB', '', null, null, null, null, wsb)).id;
  perform pg_temp.act_as_service();
  delete from public.general_space_members where space_id = wsc and user_id = v_q;
  insert into public.general_space_members (space_id, user_id, role) values (wsd, v_s3, 'member');
  update public.general_space_members set role = 'coordinator' where space_id = wsd and user_id = v_q;
  update public.general_space_members set role = 'pm' where space_id = wsd and user_id = v_s3;
  update public.general_spaces set archived_at = now() where id = wse;
  update public.profiles set can_manage_projects = false where id = v_q;
  perform pg_temp.act_as(v_a);
  o := (public.create_office('Zz Ob office', '')).id;
  perform public.set_space_office(wsb, o);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('fixtures: S2 runs WSA, Q runs WSB with the switch off, WSC has no pm row',
    pg_temp.srole(wsa, v_s2) = 'pm' and pg_temp.srole(wsb, v_q) = 'pm'
    and not (select can_manage_projects from public.profiles where id = v_q)
    and not exists (select 1 from public.general_space_members where space_id = wsc and role = 'pm'));

  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_be('spaces_without_pm is zero rows for a non-admin',
    (select count(*) from public.admin_spaces_without_pm()) = 0);
  perform pg_temp.must_be('project_offices is zero rows for a non-admin',
    (select count(*) from public.admin_project_offices()) = 0);
  perform pg_temp.must_refuse_exact('assign refuses a non-admin',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_s1),
    'Only an admin can give a space a project manager.');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_be('the reads are zero rows for an inactive admin',
    (select count(*) from public.admin_spaces_without_pm()) = 0
    and (select count(*) from public.admin_project_offices()) = 0);
  perform pg_temp.must_refuse_exact('assign refuses an inactive admin',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_s1),
    'Only an admin can give a space a project manager.');

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('spaces_without_pm lists the switched-off space and not a healthy one',
    exists (select 1 from public.admin_spaces_without_pm() x
             where x.space_id = wsb and x.space_name = 'Zz Ob switched off'
               and x.office_name = 'Zz Ob office')
    and exists (select 1 from public.admin_spaces_without_pm() x
                 where x.space_id = wsc and x.office_name = '')
    and not exists (select 1 from public.admin_spaces_without_pm() x
                     where x.space_id in (wsa, ws1, ws2)));
  perform pg_temp.must_be('spaces_without_pm lists a deactivated PM''s space and not an archived one',
    exists (select 1 from public.admin_spaces_without_pm() x where x.space_id = wsd)
    and not exists (select 1 from public.admin_spaces_without_pm() x where x.space_id = wse));
  perform pg_temp.must_be('spaces_without_pm returns exactly its columns',
    pg_get_function_result('public.admin_spaces_without_pm()'::regprocedure)
      = 'TABLE(space_id uuid, space_name text, office_name text)');
  perform pg_temp.must_be('project_offices names the office of a filed space and '''' for an unfiled one',
    exists (select 1 from public.admin_project_offices() x
             where x.project_id = pb and x.office_id = o and x.office_name = 'Zz Ob office')
    and exists (select 1 from public.admin_project_offices() x
                 where x.project_id = p1 and x.office_id is null and x.office_name = '')
    and exists (select 1 from public.admin_project_offices() x where x.project_id = p2)
    and (select count(*) from public.admin_project_offices() x where x.project_id = pb) = 1);
  perform pg_temp.must_be('project_offices returns exactly its columns',
    pg_get_function_result('public.admin_project_offices()'::regprocedure)
      = 'TABLE(project_id uuid, office_id uuid, office_name text)');

  perform pg_temp.must_refuse_exact('assign refuses while the PM is active with the switch on',
    format('select public.admin_assign_space_pm(%L, %L)', wsa, v_s1),
    'This space already has a project manager.');
  perform pg_temp.must_refuse_exact('assign refuses a space that is not there',
    format('select public.admin_assign_space_pm(%L, %L)', gen_random_uuid(), v_s1),
    'That space no longer exists. Refresh the page.');
  perform pg_temp.must_refuse_exact('assign refuses a successor without Project manager',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_m),
    'Zz Obm needs Project manager turned on first. Turn it on in Accounts.');
  perform pg_temp.must_refuse_exact('assign refuses an admin successor',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_x),
    'Only an active member can take over.');
  perform pg_temp.must_refuse_exact('assign refuses an inactive successor',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_s3),
    'Only an active member can take over.');

  perform public.admin_assign_space_pm(wsb, v_s1);
  perform public.admin_assign_space_pm(wsc, v_s2);
  perform public.admin_assign_space_pm(wsd, v_s2);

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('assign works when the PM''s switch is off',
    pg_temp.srole(wsb, v_s1) = 'pm' and pg_temp.srole(wsb, v_q) = 'coordinator'
    and (select count(*) from public.general_space_members where space_id = wsb and role = 'pm') = 1
    and (select count(*) from public.general_space_members where space_id = wsb and user_id = v_s1) = 1
    and pg_temp.prole(pb, v_q) = 'pm');
  perform pg_temp.must_be('assign works on a space with no pm row',
    pg_temp.srole(wsc, v_s2) = 'pm'
    and (select count(*) from public.general_space_members where space_id = wsc and role = 'pm') = 1);
  perform pg_temp.must_be('assign works when the PM is deactivated',
    pg_temp.srole(wsd, v_s2) = 'pm' and pg_temp.srole(wsd, v_s3) = 'coordinator'
    and (select count(*) from public.general_space_members where space_id = wsd and role = 'pm') = 1);
  perform pg_temp.must_be('assign writes one space_pm_assigned row',
    (select count(*) from public.audit_events
      where action::text = 'space_pm_assigned' and subject_id = wsb) = 1
    and exists (select 1 from public.audit_events
                 where action::text = 'space_pm_assigned' and subject_id = wsb and actor_id = v_a
                   and subject_label = 'Zz Ob switched off' and after_value = 'Zz Obs1'));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('spaces_without_pm no longer lists them',
    not exists (select 1 from public.admin_spaces_without_pm() x where x.space_id in (wsb, wsc)));
  perform pg_temp.must_refuse_exact('a second assign is refused: the space has a working PM now',
    format('select public.admin_assign_space_pm(%L, %L)', wsb, v_s2),
    'This space already has a project manager.');

  perform pg_temp.act_as_service();
  raise notice 'offboarding suite: all passed';
end $$;

rollback;
