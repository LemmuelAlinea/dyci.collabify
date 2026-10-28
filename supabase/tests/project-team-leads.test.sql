-- Company roles, phase 2: team leaders — rolled back, touches nothing
-- permanently.
--
--   node scripts/db.mjs supabase/tests/project-team-leads.test.sql
--
-- A work project's team can have one leader, who must be on the team and not a
-- stakeholder. Leading lets them edit, assign and unassign tasks held by people
-- on their team, and nothing more: points stay with whoever manages tasks.
-- Every refusal here is paired with a case that is allowed, so a refusal never
-- passes for the wrong reason.
--
-- Fixture, on work project P: team A (lead L, member U, stakeholder S) and
-- team B (member V). Coordinator C, project manager PM, stranger X (not on P).

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

-- A refusal that must be the one under test, not some other rule further along.
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(lower(p_needle) in lower(sqlerrm)) > 0 then
        raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
        return;
      end if;
      raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
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

-- ------------------------------------------------------------------ live data

do $$
begin
  perform pg_temp.must_be('no class-board team has a leader',
    not exists (select 1 from public.general_teams t
                  join public.general_projects p on p.id = t.project_id
                 where p.class_board_id is not null and t.leader_id is not null));
  perform pg_temp.must_be('every live leader is on their team and not a stakeholder',
    not exists (select 1 from public.general_teams t
                 where t.leader_id is not null
                   and (not exists (select 1 from public.general_team_members tm
                                     where tm.team_id = t.id and tm.user_id = t.leader_id)
                        or exists (select 1 from public.general_members m
                                    where m.project_id = t.project_id
                                      and m.user_id = t.leader_id and m.role = 'stakeholder'))));
end $$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm    uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_lead  uuid := gen_random_uuid();
  v_u     uuid := gen_random_uuid();
  v_v     uuid := gen_random_uuid();
  v_s     uuid := gen_random_uuid();
  v_x     uuid := gen_random_uuid();
  v_p     uuid;
  v_a     uuid;
  v_b     uuid;
  v_tu    uuid;
  v_tv    uuid;
  v_free  uuid;
  v_free2 uuid;
  v_tuv   uuid;
  v_sprint uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,    'zz-tl-pm@example.test'),
      (v_coord, 'zz-tl-coord@example.test'),
      (v_lead,  'zz-tl-lead@example.test'),
      (v_u,     'zz-tl-u@example.test'),
      (v_v,     'zz-tl-v@example.test'),
      (v_s,     'zz-tl-s@example.test'),
      (v_x,     'zz-tl-x@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,    'zz-tl-pm@example.test',    'Zz', 'Tlpm',    'member',  'active', false, true),
    (v_coord, 'zz-tl-coord@example.test', 'Zz', 'Tlcoord', 'member',  'active', false, false),
    (v_lead,  'zz-tl-lead@example.test',  'Zz', 'Tllead',  'member',  'active', false, false),
    (v_u,     'zz-tl-u@example.test',     'Zz', 'Tlu',     'member',  'active', false, false),
    (v_v,     'zz-tl-v@example.test',     'Zz', 'Tlv',     'student', 'active', false, false),
    (v_s,     'zz-tl-s@example.test',     'Zz', 'Tls',     'member',  'active', false, false),
    (v_x,     'zz-tl-x@example.test',     'Zz', 'Tlx',     'member',  'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_p := (public.create_general_project('Zz TL project', '')).id;
  perform pg_temp.act_as_service();

  insert into public.general_members (project_id, user_id, role) values
    (v_p, v_coord, 'coordinator'),
    (v_p, v_lead, 'member'),
    (v_p, v_u, 'member'),
    (v_p, v_v, 'member'),
    (v_p, v_s, 'member');
  -- Stakeholder is refused by set_general_member_role in phase 2, so the
  -- service role sets it directly.
  update public.general_members set role = 'stakeholder'
   where project_id = v_p and user_id = v_s;

  insert into public.general_teams (project_id, name) values (v_p, 'Zz team A') returning id into v_a;
  insert into public.general_teams (project_id, name) values (v_p, 'Zz team B') returning id into v_b;
  insert into public.general_team_members (team_id, project_id, user_id) values
    (v_a, v_p, v_lead), (v_a, v_p, v_u), (v_a, v_p, v_s), (v_b, v_p, v_v);

  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz held by U') returning id into v_tu;
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz held by V') returning id into v_tv;
  insert into public.general_tasks (project_id, title, team_id) values (v_p, 'Zz unheld', v_a) returning id into v_free;
  insert into public.general_tasks (project_id, title, team_id) values (v_p, 'Zz unheld two', v_a) returning id into v_free2;
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz held by U and V') returning id into v_tuv;
  -- Preserve the existing released-work fixture; creation defaults are tested separately.
  perform pg_temp.act_as_service();
  update public.general_tasks set routing_state='released' where id in(v_tu,v_tv,v_free,v_free2,v_tuv);
  perform pg_temp.act_as(v_pm);
  insert into public.general_task_assignees (task_id, project_id, user_id) values
    (v_tu, v_p, v_u), (v_tv, v_p, v_v), (v_tuv, v_p, v_u), (v_tuv, v_p, v_v);
  perform pg_temp.act_as_service();
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (v_p, 'Zz sprint', current_date, current_date + 14) returning id into v_sprint;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('pm', v_pm), ('coord', v_coord), ('lead', v_lead), ('u', v_u), ('v', v_v), ('s', v_s),
    ('x', v_x), ('p', v_p), ('a', v_a), ('b', v_b), ('tu', v_tu), ('tv', v_tv),
    ('free', v_free), ('free2', v_free2), ('tuv', v_tuv), ('sprint', v_sprint);
  raise notice 'fixture ready';
end $$;

-- How many team_leader events P has for a team, from one leader to another.
create or replace function pg_temp.leader_events(p_team uuid, p_from uuid, p_to uuid) returns int
language sql as $$
  select count(*)::int from public.general_project_events
   where project_id = (select v from fx where k = 'p') and kind = 'team_leader'
     and detail->>'team_id' = p_team::text
     and (detail->>'from') is not distinct from p_from::text
     and (detail->>'to') is not distinct from p_to::text;
$$;

create or replace function pg_temp.leader_of(p_team uuid) returns uuid
language sql as $$
  select leader_id from public.general_teams where id = p_team;
$$;

-- ------------------------------------------------------------------ picking a leader

do $$
declare
  v_p     uuid := (select v from fx where k = 'p');
  v_a     uuid := (select v from fx where k = 'a');
  v_coord uuid := (select v from fx where k = 'coord');
  v_lead  uuid := (select v from fx where k = 'lead');
  v_u     uuid := (select v from fx where k = 'u');
  v_v     uuid := (select v from fx where k = 'v');
  v_s     uuid := (select v from fx where k = 's');
begin
  perform pg_temp.must_be('a new team has no leader', pg_temp.leader_of(v_a) is null);

  perform pg_temp.act_as(v_v);
  perform pg_temp.must_refuse_with('a member cannot pick a team''s leader',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_lead),
    'Only someone who manages teams');
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_allow('a coordinator makes L the leader of team A',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_lead));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and L leads team A', pg_temp.leader_of(v_a) = v_lead);
  perform pg_temp.must_be('...and a team_leader event {team_id, from: null, to: L} is written',
    pg_temp.leader_events(v_a, null, v_lead) = 1);
  perform pg_temp.must_be('...carrying the team''s name for the activity log',
    exists (select 1 from public.general_project_events
             where project_id = v_p and kind = 'team_leader'
               and detail->>'team_id' = v_a::text
               and detail->>'team_name' = (select name from public.general_teams where id = v_a)));
  perform pg_temp.must_be('leading never changes L''s role (still member)',
    (select role = 'member' from public.general_members where project_id = v_p and user_id = v_lead));

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a leader who is not on the team is refused',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_v),
    'not on this team');
  perform pg_temp.must_refuse_with('a stakeholder on the team is refused',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_s),
    'stakeholder');
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse_with('...and the trigger refuses it from a direct write too',
    format('update public.general_teams set leader_id = %L where id = %L', v_s, v_a),
    'stakeholder');
  perform pg_temp.must_be('...and L still leads team A', pg_temp.leader_of(v_a) = v_lead);
end $$;

-- ------------------------------------------------------------------ the lead and tasks

do $$
declare
  v_p     uuid := (select v from fx where k = 'p');
  v_lead  uuid := (select v from fx where k = 'lead');
  v_u     uuid := (select v from fx where k = 'u');
  v_v     uuid := (select v from fx where k = 'v');
  v_x     uuid := (select v from fx where k = 'x');
  v_tu    uuid := (select v from fx where k = 'tu');
  v_tv    uuid := (select v from fx where k = 'tv');
  v_free  uuid := (select v from fx where k = 'free');
  v_free2 uuid := (select v from fx where k = 'free2');
  v_tuv   uuid := (select v from fx where k = 'tuv');
  v_sprint uuid := (select v from fx where k = 'sprint');
begin
  perform pg_temp.act_as(v_u);
  perform pg_temp.must_be('general_leads_user: L leads U', public.general_leads_user(v_p, v_lead, v_u));
  perform pg_temp.must_be('...but not V, who is on team B',
    not public.general_leads_user(v_p, v_lead, v_v));
  perform pg_temp.must_be('...and U leads nobody', not public.general_leads_user(v_p, v_u, v_lead));
  perform pg_temp.act_as(v_x);
  perform pg_temp.must_be('...and someone not on P cannot probe it',
    not public.general_leads_user(v_p, v_lead, v_u));

  perform pg_temp.act_as(v_lead);
  perform pg_temp.must_allow('L edits a task held by U',
    format($q$update public.general_tasks set title = 'Zz edited by L' where id = %L$q$, v_tu));
  perform pg_temp.must_allow('L moves the stage of a task held by U',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, v_tu));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and both changes landed',
    (select title = 'Zz edited by L' and status = 'in_progress'
       from public.general_tasks where id = v_tu));

  perform pg_temp.act_as(v_lead);
  perform pg_temp.must_refuse_with('L edits a task held only by V: refused',
    format($q$update public.general_tasks set title = 'Zz nope' where id = %L$q$, v_tv),
    'Only whoever holds this task');
  perform pg_temp.must_refuse_with('...and so is moving its status',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, v_tv),
    'Only whoever holds this task');
  perform pg_temp.must_allow('L edits a task held by U (team A) and V (team B): one holder on L''s team is enough',
    format($q$update public.general_tasks set description = 'Zz shared, edited by L' where id = %L$q$, v_tuv));
  perform pg_temp.must_allow('L reorders U''s task in the backlog',
    format($q$update public.general_tasks set rank = 42 where id = %L$q$, v_tu));
  perform pg_temp.must_refuse_with('...but L cannot put U''s task in a sprint',
    format($q$update public.general_tasks set sprint_id = %L where id = %L$q$, v_sprint, v_tu),
    'plan sprints and order the backlog');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the shared task and the new rank landed, and U''s task is in no sprint',
    (select description = 'Zz shared, edited by L' from public.general_tasks where id = v_tuv)
    and (select rank = 42 and sprint_id is null from public.general_tasks where id = v_tu));
  perform pg_temp.act_as(v_u);
  perform pg_temp.must_refuse_with('...and U, who leads nobody, cannot reorder U''s own task',
    format($q$update public.general_tasks set rank = 7 where id = %L$q$, v_tu),
    'plan sprints and order the backlog');
  perform pg_temp.act_as(v_lead);
  perform pg_temp.must_refuse_with('L changes the points of U''s task: refused',
    format($q$update public.general_tasks set weight = 3 where id = %L$q$, v_tu),
    'manages tasks changes points');

  perform pg_temp.must_allow('L assigns U to an unheld task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_free, v_p, v_u));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and U holds it, assigned by L',
    (select assigned_by = v_lead from public.general_task_assignees
      where task_id = v_free and user_id = v_u));

  perform pg_temp.act_as(v_lead);
  perform pg_temp.must_refuse_with('L assigns V to an unheld task: refused',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_free2, v_p, v_v),
    'receiving team lead');
  perform pg_temp.act_as(v_u);
  perform pg_temp.must_refuse_with('...and U, who leads nobody, cannot assign L either',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_free2, v_p, v_lead),
    'receiving team lead');

  perform pg_temp.act_as(v_lead);
  delete from public.general_task_assignees where task_id = v_tv and user_id = v_v;
  delete from public.general_task_assignees where task_id = v_free and user_id = v_u;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('L cannot unassign V (the row stays)',
    exists (select 1 from public.general_task_assignees where task_id = v_tv and user_id = v_v));
  perform pg_temp.must_be('L unassigns U',
    not exists (select 1 from public.general_task_assignees where task_id = v_free and user_id = v_u));
end $$;

-- ------------------------------------------------------------------ changing and clearing

do $$
declare
  v_p     uuid := (select v from fx where k = 'p');
  v_a     uuid := (select v from fx where k = 'a');
  v_b     uuid := (select v from fx where k = 'b');
  v_pm    uuid := (select v from fx where k = 'pm');
  v_coord uuid := (select v from fx where k = 'coord');
  v_lead  uuid := (select v from fx where k = 'lead');
  v_u     uuid := (select v from fx where k = 'u');
  v_v     uuid := (select v from fx where k = 'v');
  v_tu    uuid := (select v from fx where k = 'tu');
  v_x     uuid := (select v from fx where k = 'x');
begin
  perform pg_temp.act_as(v_x);
  perform pg_temp.must_refuse_with('someone not on P cannot pick a leader of its team',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_u),
    'not on a project you can see');
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_allow('a coordinator makes U the leader of team A',
    format('select public.set_general_team_leader(%L, %L)', v_a, v_u));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...U leads team A', pg_temp.leader_of(v_a) = v_u);
  perform pg_temp.must_be('...with a team_leader event {from: L, to: U}',
    pg_temp.leader_events(v_a, v_lead, v_u) = 1);
  perform pg_temp.act_as(v_lead);
  perform pg_temp.must_refuse_with('...and L, no longer leading, cannot edit U''s task',
    format($q$update public.general_tasks set title = 'Zz again' where id = %L$q$, v_tu),
    'Only whoever holds this task');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm clears the leader with null',
    format('select public.set_general_team_leader(%L, null)', v_a));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...team A has no leader', pg_temp.leader_of(v_a) is null);
  perform pg_temp.must_be('...with a team_leader event {from: U, to: null}',
    pg_temp.leader_events(v_a, v_u, null) = 1);

  -- Leaves the team.
  perform pg_temp.act_as(v_coord);
  perform public.set_general_team_leader(v_a, v_lead);
  delete from public.general_team_members where team_id = v_a and user_id = v_lead;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing L from team A clears its leader', pg_temp.leader_of(v_a) is null);
  perform pg_temp.must_be('...and writes a team_leader event {from: L, to: null}',
    pg_temp.leader_events(v_a, v_lead, null) = 1);

  -- Becomes a stakeholder.
  perform pg_temp.act_as(v_coord);
  perform public.set_general_team_leader(v_a, v_u);
  perform pg_temp.act_as_service();
  update public.general_members set role = 'stakeholder' where project_id = v_p and user_id = v_u;
  perform pg_temp.must_be('a leader who becomes a stakeholder leaves the team leaderless',
    pg_temp.leader_of(v_a) is null);
  perform pg_temp.must_be('...and stays on the team',
    exists (select 1 from public.general_team_members where team_id = v_a and user_id = v_u));

  -- Leaves the project, on an archived project.
  perform pg_temp.act_as(v_coord);
  perform public.set_general_team_leader(v_b, v_v);
  perform pg_temp.act_as_service();
  update public.general_projects set archived_at = now() where id = v_p;
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('no leader can be picked on an archived project',
    format('select public.set_general_team_leader(%L, null)', v_b),
    'This project is archived. The project manager can restore it');
  -- An insert, since an update is filtered out by RLS before the guard speaks.
  perform pg_temp.must_refuse_with('...and adding a team says the project manager restores it',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Zz team C')$q$, v_p),
    'The project manager can restore it');
  -- The pm, who still reads the archived project's tasks (a member does not,
  -- so their update finds no row before the guard speaks).
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('...and so does editing a task',
    format($q$update public.general_tasks set title = 'Zz archived' where id = %L$q$, v_tu),
    'The project manager can restore it');
  perform pg_temp.must_refuse_with('...and adding one',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz archived new')$q$, v_p),
    'The project manager can restore it');
  perform pg_temp.act_as(v_v);
  perform pg_temp.must_allow('V, team B''s leader, leaves the archived project',
    format('select public.leave_general_project(%L)', v_p));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...team B has no leader', pg_temp.leader_of(v_b) is null);
  perform pg_temp.must_be('...with a team_leader event {from: V, to: null}',
    pg_temp.leader_events(v_b, v_v, null) = 1);
end $$;

-- ------------------------------------------------------------------ seeded teams

do $$
declare
  v_pm    uuid := (select v from fx where k = 'pm');
  v_lead  uuid := (select v from fx where k = 'lead');
  v_space uuid;
  v_team  uuid;
  v_q     uuid;
begin
  perform pg_temp.act_as(v_pm);
  v_space := (select space_id from public.general_projects where id = (select v from fx where k = 'p'));
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level)
  values (v_space, v_lead, 'member') on conflict do nothing;
  perform pg_temp.act_as(v_pm);
  v_team := (public.create_general_space_team(v_space, 'Zz TL space team', '', array[v_lead])).id;
  v_q := (public.create_general_project('Zz TL seeded', '', null, null, null, null,
                                        v_space, v_team)).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a project seeded from a space team has a team...',
    exists (select 1 from public.general_teams where project_id = v_q));
  perform pg_temp.must_be('...with no leader',
    not exists (select 1 from public.general_teams where project_id = v_q and leader_id is not null));
end $$;

-- ------------------------------------------------------------------ the lead is on the team

-- The triggers never leave a leader off their team, so to see general_leads_user
-- ask for it on its own, the clearing trigger is switched off for the rest of
-- this (rolled back) transaction. Last on purpose: the lock it takes is held
-- only until the rollback just below.
do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_a    uuid := (select v from fx where k = 'a');
  v_lead uuid := (select v from fx where k = 'lead');
  v_u    uuid := (select v from fx where k = 'u');
begin
  perform pg_temp.act_as_service();
  insert into public.general_team_members (team_id, project_id, user_id) values (v_a, v_p, v_lead);
  update public.general_teams set leader_id = v_lead where id = v_a;
  perform pg_temp.must_be('L leads U again', public.general_leads_user(v_p, v_lead, v_u));
  alter table public.general_team_members disable trigger general_team_members_leader_clear;
  delete from public.general_team_members where team_id = v_a and user_id = v_lead;
  perform pg_temp.must_be('a leader_id left behind by hand leads nobody once its holder is off the team',
    pg_temp.leader_of(v_a) = v_lead and not public.general_leads_user(v_p, v_lead, v_u));
end $$;

rollback;
