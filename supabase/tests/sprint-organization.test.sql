-- supabase/tests/sprint-organization.test.sql
-- Sequential, Multiple sprint streams and Flexible parallel on work projects.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/sprint-organization.test.sql
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

/** Runs a statement and asserts it is refused with the given words. */
create or replace function pg_temp.must_refuse(p_label text, p_sql text, p_words text) returns void
language plpgsql as $$
declare
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is null then
    raise exception 'FAIL  % — the write went through and should not have', p_label;
  end if;
  if position(p_words in v_message) = 0 then
    raise exception 'FAIL  % — refused for the wrong reason: %', p_label, v_message;
  end if;
  raise notice 'PASS  %', p_label;
end;
$$;

/** A work project with a manager, coordinator, member and two teams with leads. */
create or replace function pg_temp.org_project(a uuid, c uuid, m uuid, l1 uuid, l2 uuid, p_title text)
returns uuid language plpgsql as $$
declare
  p uuid; v_inv uuid; v_user uuid; v_front uuid; v_back uuid;
begin
  perform pg_temp.act_as(a);
  p := (public.create_general_project(p_title)).id;
  foreach v_user in array array[c, m, l1, l2] loop
    perform pg_temp.act_as(a);
    select id into v_inv from public.invite_to_general_project(p, v_user);
    perform pg_temp.act_as(v_user);
    perform public.respond_general_invitation(v_inv, true);
  end loop;
  perform pg_temp.act_as_service();
  update public.general_members set role = 'coordinator' where project_id = p and user_id = c;
  insert into public.general_teams (project_id, name) values (p, 'Frontend') returning id into v_front;
  insert into public.general_teams (project_id, name) values (p, 'Backend') returning id into v_back;
  insert into public.general_team_members (team_id, project_id, user_id) values
    (v_front, p, l1), (v_front, p, m), (v_back, p, l2);
  update public.general_teams set leader_id = l1 where id = v_front;
  update public.general_teams set leader_id = l2 where id = v_back;
  return p;
end;
$$;

create or replace function pg_temp.team(p uuid, p_name text) returns uuid
language sql as $$
  select id from public.general_teams where project_id = p and name = p_name;
$$;

create or replace function pg_temp.mode(p uuid, p_organization text) returns void
language plpgsql as $$
begin
  perform pg_temp.act_as_service();
  insert into public.general_sprint_settings (project_id, organization)
  values (p, p_organization)
  on conflict (project_id) do update set organization = excluded.organization;
end;
$$;

/** A planned, running or finished sprint for a team, or for none. */
create or replace function pg_temp.sprint(p uuid, p_name text, p_team uuid, p_state text default 'planned',
                                          p_starts date default '2026-11-02', p_ends date default '2026-11-15')
returns uuid language plpgsql as $$
declare
  s uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_sprints (project_id, name, team_id, starts_on, ends_on)
  values (p, p_name, p_team, p_starts, p_ends) returning id into s;
  if p_state in ('active', 'completed') then
    update public.general_sprints set state = 'active' where id = s;
  end if;
  if p_state = 'completed' then
    update public.general_sprints set state = 'completed' where id = s;
  end if;
  return s;
end;
$$;

create or replace function pg_temp.task(p uuid, a uuid, p_team uuid, s uuid, p_status text default 'todo')
returns uuid language plpgsql as $$
declare
  t uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.general_tasks (routing_state, created_by, project_id, title, team_id, sprint_id, status)
  values ('released', a, p, 'Zz organization task', p_team, s, p_status::public.general_task_status)
  returning id into t;
  return t;
end;
$$;

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Coord', 'Member', 'Leadone', 'Leadtwo'];
  i int;
  a uuid; c uuid; m uuid; l1 uuid; l2 uuid;
  p uuid;
  front uuid; back uuid;
  s1 uuid; s2 uuid; s3 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  n int;
begin
  perform pg_temp.act_as_service();
  for i in 1..5 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-sprintorg-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzsprintorg', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set can_teach = true, can_manage_projects = true
   where id = any (v_ids) and role = 'member';
  a := v_ids[1]; c := v_ids[2]; m := v_ids[3]; l1 := v_ids[4]; l2 := v_ids[5];

  ------------------------------------------------------------ the setting
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org setting');
  perform pg_temp.must_be('new projects stay sequential',
    public.general_sprint_organization(p) = 'sequential');

  perform pg_temp.act_as(c);
  insert into public.general_sprint_settings (project_id, organization) values (p, 'parallel')
  on conflict (project_id) do update set organization = excluded.organization;
  perform pg_temp.must_be('a coordinator changes the mode',
    public.general_sprint_organization(p) = 'parallel');
  perform pg_temp.act_as(a);
  update public.general_sprint_settings set organization = 'streams' where project_id = p;
  perform pg_temp.must_be('the project manager changes the mode',
    public.general_sprint_organization(p) = 'streams');
  perform pg_temp.act_as(l1);
  with u as (update public.general_sprint_settings set organization = 'parallel' where project_id = p returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('only the project manager and coordinators change the mode',
    n = 0 and public.general_sprint_organization(p) = 'streams');
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('an unknown mode is refused',
    format('update public.general_sprint_settings set organization = %L where project_id = %L', 'other', p),
    'general_sprint_settings_organization');

  ------------------------------------------------------------ how many can run
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org sequential');
  s1 := pg_temp.sprint(p, 'Sprint 1', null, 'active');
  s2 := pg_temp.sprint(p, 'Sprint 2', null);
  perform pg_temp.must_refuse('sequential still allows one running sprint',
    format('update public.general_sprints set state = %L where id = %L', 'active', s2),
    'Finish Sprint 1 first.');

  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org streams');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  perform pg_temp.mode(p, 'streams');
  s1 := pg_temp.sprint(p, 'Front 1', front, 'active');
  s2 := pg_temp.sprint(p, 'Back 1', back, 'active');
  perform pg_temp.must_be('streams allow one running sprint per team',
    (select count(*) = 2 from public.general_sprints where project_id = p and state = 'active'));
  s3 := pg_temp.sprint(p, 'Front 2', front);
  perform pg_temp.must_refuse('two starts for one team can''t both run',
    format('update public.general_sprints set state = %L where id = %L', 'active', s3),
    'Frontend is already running Front 1.');
  perform pg_temp.must_refuse('a new sprint in streams must have a team',
    format('insert into public.general_sprints (project_id, name, starts_on, ends_on) values (%L, %L, %L, %L)',
           p, 'No team', '2026-11-02', '2026-11-15'),
    'Choose the team this sprint is for.');

  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org no team');
  s1 := pg_temp.sprint(p, 'Sprint 1', null);
  perform pg_temp.mode(p, 'streams');
  perform pg_temp.must_refuse('a sprint without a team can''t start in streams',
    format('update public.general_sprints set state = %L where id = %L', 'active', s1),
    'Give this sprint a team first.');

  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org parallel');
  perform pg_temp.mode(p, 'parallel');
  s1 := pg_temp.sprint(p, 'One', null, 'active');
  s2 := pg_temp.sprint(p, 'Two', null, 'active');
  s3 := pg_temp.sprint(p, 'Three', null, 'active');
  perform pg_temp.must_be('parallel allows any number running',
    (select count(*) = 3 from public.general_sprints where project_id = p and state = 'active'));
  perform pg_temp.must_refuse('switching back to sequential is refused while two run',
    format('update public.general_sprint_settings set organization = %L where project_id = %L', 'sequential', p),
    'Finish all but one running sprint first.');
  perform pg_temp.must_be('the mode stays after a refused switch',
    public.general_sprint_organization(p) = 'parallel');

  ------------------------------------------------------------ switching to streams
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org switch');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  s1 := pg_temp.sprint(p, 'Sprint 1', null, 'active');
  perform pg_temp.must_refuse('switching to streams is refused while a running sprint has no team',
    format('insert into public.general_sprint_settings (project_id, organization) values (%L, %L)', p, 'streams'),
    'Give Sprint 1 a team first.');

  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org switch tasks');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  s1 := pg_temp.sprint(p, 'Sprint 1', front, 'active');
  t1 := pg_temp.task(p, a, back, s1);
  perform pg_temp.must_refuse('switching to streams is refused while a running sprint holds other teams'' tasks',
    format('insert into public.general_sprint_settings (project_id, organization) values (%L, %L)', p, 'streams'),
    'Sprint 1 holds tasks of other teams. Move them out first.');

  ------------------------------------------------------------ who runs a team's sprint
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org leads');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  perform pg_temp.mode(p, 'streams');
  s1 := pg_temp.sprint(p, 'Front 1', front);
  s2 := pg_temp.sprint(p, 'Back 1', back);
  t1 := pg_temp.task(p, a, front, s1);

  perform pg_temp.act_as(l2);
  with u as (update public.general_sprints set state = 'active' where id = s1 returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('a lead cannot start another team''s sprint',
    n = 0 and (select state = 'planned' from public.general_sprints where id = s1));

  perform pg_temp.act_as(m);
  with u as (update public.general_sprints set state = 'active' where id = s1 returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('a member of the team cannot start its sprint',
    n = 0 and (select state = 'planned' from public.general_sprints where id = s1));

  perform pg_temp.act_as(l1);
  perform pg_temp.must_refuse('a lead without manage tasks cannot rename the sprint',
    format('update public.general_sprints set name = %L where id = %L', 'Mine', s1),
    'Only someone who manages tasks can change a sprint.');
  update public.general_sprints set state = 'active' where id = s1;
  perform pg_temp.must_be('a team lead runs their team''s sprint in streams',
    (select state = 'active' from public.general_sprints where id = s1));
  perform public.complete_general_sprint(s1, null);
  perform pg_temp.must_be('a team lead finishes it, and open work returns to the backlog',
    (select state = 'completed' from public.general_sprints where id = s1)
    and (select sprint_id is null from public.general_tasks where id = t1));
  perform public.reopen_general_sprint(s1);
  perform pg_temp.must_be('a team lead runs it again',
    (select state = 'active' from public.general_sprints where id = s1));

  perform pg_temp.act_as(l2);
  perform pg_temp.must_refuse('a lead cannot finish another team''s sprint',
    format('select public.complete_general_sprint(%L, null)', s1),
    'can finish a sprint');
  t2 := pg_temp.task(p, a, back, null);
  perform pg_temp.act_as(l2);
  perform pg_temp.must_refuse('a lead cannot plan tasks into a sprint without manage tasks',
    format('update public.general_tasks set sprint_id = %L where id = %L', s2, t2),
    'manages tasks');

  perform pg_temp.mode(p, 'parallel');
  perform pg_temp.act_as(l2);
  with u as (update public.general_sprints set state = 'active' where id = s2 returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('a team lead runs nothing in parallel',
    n = 0 and (select state = 'planned' from public.general_sprints where id = s2));

  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org leads sequential');
  front := pg_temp.team(p, 'Frontend');
  s1 := pg_temp.sprint(p, 'Front 1', front);
  perform pg_temp.act_as(l1);
  with u as (update public.general_sprints set state = 'active' where id = s1 returning 1)
  select count(*) into n from u;
  perform pg_temp.must_be('a team lead runs nothing in sequential',
    n = 0 and (select state = 'planned' from public.general_sprints where id = s1));

  ------------------------------------------------------------ tasks in a team's sprint
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org tasks');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  perform pg_temp.mode(p, 'streams');
  s1 := pg_temp.sprint(p, 'Front 1', front);
  t1 := pg_temp.task(p, a, front, null);
  t2 := pg_temp.task(p, a, back, null);
  t3 := pg_temp.task(p, a, null, null);

  perform pg_temp.act_as(a);
  update public.general_tasks set sprint_id = s1 where id = t1;
  perform pg_temp.must_be('a task joins its team''s sprint in streams',
    (select sprint_id = s1 from public.general_tasks where id = t1));
  perform pg_temp.must_refuse('a task cannot join another team''s sprint in streams',
    format('update public.general_tasks set sprint_id = %L where id = %L', s1, t2),
    'This sprint is for Frontend. Move the task to that team''s sprint.');
  perform pg_temp.must_refuse('a team-less task joins no sprint in streams',
    format('update public.general_tasks set sprint_id = %L where id = %L', s1, t3),
    'Give the task a team before planning it into a sprint.');

  ------------------------------------------------------------ starting with another team's work
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org start tasks');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  s1 := pg_temp.sprint(p, 'Front 1', front);
  t1 := pg_temp.task(p, a, back, s1);
  t2 := pg_temp.task(p, a, back, s1);
  t3 := pg_temp.task(p, a, back, s1, 'done');
  perform pg_temp.mode(p, 'streams');
  perform pg_temp.must_refuse('starting is refused while a sprint holds another team''s open tasks',
    format('update public.general_sprints set state = %L where id = %L', 'active', s1),
    '2 tasks in this sprint belong to another team. Move them out first.');
  perform pg_temp.act_as_service();
  delete from public.general_tasks where id = t2;
  perform pg_temp.must_refuse('one task gets the singular message',
    format('update public.general_sprints set state = %L where id = %L', 'active', s1),
    '1 task in this sprint belongs to another team. Move it out first.');

  ------------------------------------------------------------ a task changing team
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org task team');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  perform pg_temp.mode(p, 'streams');
  s1 := pg_temp.sprint(p, 'Front 1', front, 'active');
  t1 := pg_temp.task(p, a, front, s1);
  t2 := pg_temp.task(p, a, front, s1, 'done');
  perform pg_temp.act_as_service();
  update public.general_tasks set team_id = back where id in (t1, t2);
  perform pg_temp.must_be('an open task that changes team leaves the sprint; a done one stays',
    (select sprint_id is null and team_id = back from public.general_tasks where id = t1)
    and (select sprint_id = s1 and team_id = back from public.general_tasks where id = t2));
  perform pg_temp.must_be('the task history says the task left the sprint',
    exists (select 1 from public.general_task_events
             where task_id = t1 and kind = 'updated'
               and detail -> 'fields' ? 'sprint_id'
               and detail ->> 'sprint_from' = 'Front 1')
    and not exists (select 1 from public.general_task_events
                     where task_id = t2 and detail -> 'fields' ? 'sprint_id'));

  ------------------------------------------------------------ a sprint's team
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org sprint team');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  s1 := pg_temp.sprint(p, 'Planned', front);
  s2 := pg_temp.sprint(p, 'Running', front, 'active');
  perform pg_temp.act_as(a);
  update public.general_sprints set team_id = back where id = s1;
  perform pg_temp.must_be('an empty planned sprint changes team',
    (select team_id = back from public.general_sprints where id = s1));
  t1 := pg_temp.task(p, a, back, s1);
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('a planned sprint''s team changes only while empty',
    format('update public.general_sprints set team_id = %L where id = %L', front, s1),
    'Move its tasks out first.');
  perform pg_temp.must_refuse('a running sprint''s team never changes',
    format('update public.general_sprints set team_id = %L where id = %L', back, s2),
    'A running or finished sprint keeps its team.');

  ------------------------------------------------------------ archiving and deleting a team
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org archive');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  perform pg_temp.mode(p, 'streams');
  s1 := pg_temp.sprint(p, 'Front 1', front, 'active');
  s2 := pg_temp.sprint(p, 'Front 2', front);
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('archiving a team is refused while it runs a sprint',
    format('update public.general_teams set archived_at = now() where id = %L', front),
    'Finish Front 1 first.');
  perform public.complete_general_sprint(s1, null);
  update public.general_teams set archived_at = now() where id = front;
  perform pg_temp.must_be('archiving a team clears its planned sprints',
    (select team_id is null from public.general_sprints where id = s2)
    and (select team_id = front from public.general_sprints where id = s1));

  s3 := pg_temp.sprint(p, 'Back 1', back, 'active');
  perform pg_temp.act_as(a);
  delete from public.general_teams where id = back;
  perform pg_temp.must_be('deleting a team clears it from its sprints',
    (select team_id is null and state = 'active' from public.general_sprints where id = s3));

  ------------------------------------------------------------ outside streams
  p := pg_temp.org_project(a, c, m, l1, l2, 'Zz org label');
  front := pg_temp.team(p, 'Frontend'); back := pg_temp.team(p, 'Backend');
  s1 := pg_temp.sprint(p, 'Front 1', front);
  t1 := pg_temp.task(p, a, back, s1);
  t2 := pg_temp.task(p, a, null, s1);
  perform pg_temp.act_as_service();
  update public.general_sprints set state = 'active' where id = s1;
  update public.general_tasks set team_id = front where id = t1;
  perform pg_temp.must_be('outside streams the team is only a label',
    (select state = 'active' from public.general_sprints where id = s1)
    and (select sprint_id = s1 from public.general_tasks where id = t1)
    and (select sprint_id = s1 from public.general_tasks where id = t2));

  ------------------------------------------------------------ the job's columns and the rest
  perform pg_temp.act_as(a);
  update public.general_sprints
     set auto_start_blocked_reason = 'x', auto_start_blocked_at = now(), next_auto_created = true
   where id = s1;
  perform pg_temp.must_be('a person cannot write the automation''s columns',
    (select auto_start_blocked_reason is null and auto_start_blocked_at is null and not next_auto_created
       from public.general_sprints where id = s1));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('class boards keep one running sprint per board',
    exists (select 1 from pg_indexes where indexname = 'board_sprints_one_running'));
  perform pg_temp.must_be('the project-wide index is gone',
    not exists (select 1 from pg_indexes where indexname = 'general_sprints_one_running'));
  perform pg_temp.must_be('the old created-after memory moves to the sprint',
    not exists (select 1 from public.general_sprint_settings g
                  join public.general_sprints s on s.id = g.auto_created_after
                 where not s.next_auto_created));
end;
$$;

rollback;
