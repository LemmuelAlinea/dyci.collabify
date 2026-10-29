-- node scripts/db.mjs supabase/tests/project-team-archive.test.sql
begin;
do $$
declare
  pm uuid := gen_random_uuid();
  project uuid;
  other_project uuid;
  first_team uuid;
  second_team uuid;
  other_team uuid;
  task uuid;
  position_id uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'zz-team-archive-' || pm || '@example.test', '', now(), now());
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
    values (pm, 'zz-team-archive-' || pm || '@example.test', 'Archive', 'Test', 'member', 'active', false, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pm, 'role', 'authenticated')::text, true);
  project := (public.create_general_project('Archive team test', '')).id;
  other_project := (public.create_general_project('Other archive test', '')).id;
  insert into public.general_teams (project_id, name) values (project, 'First') returning id into first_team;
  insert into public.general_teams (project_id, name) values (project, 'Second') returning id into second_team;
  insert into public.general_teams (project_id, name) values (other_project, 'Other') returning id into other_team;
  insert into public.general_team_members (team_id, project_id, user_id) values (first_team, project, pm);
  perform public.set_general_team_leader(first_team, pm);
  if not public.general_leads_user(project, pm, pm) then raise exception 'FAIL: live lead has no rights'; end if;
  insert into public.general_positions (project_id, team_id, name)
    values (project, first_team, 'Coordinator') returning id into position_id;
  insert into public.general_tasks (project_id, team_id, title)
    values (project, first_team, 'Open work') returning id into task;

  begin
    update public.general_teams set archived_at = now() where id = first_team;
    raise exception 'FAIL: open work allowed archiving';
  exception when check_violation then
    if position('Move or complete' in sqlerrm) = 0 then raise; end if;
  end;

  update public.general_tasks set team_id = second_team where id = task;
  update public.general_teams set archived_at = now() where id = first_team;
  update public.general_teams set archived_at = now() where id = other_team;
  if not exists (select 1 from public.general_teams where id = first_team
      and project_id = project and archived_at is not null) then
    raise exception 'FAIL: team absent from owning project archive';
  end if;
  if public.general_leads_user(project, pm, pm) then raise exception 'FAIL: archived lead still has rights'; end if;
  if (select count(*) from public.general_teams where project_id = project and archived_at is not null) <> 1
     or exists (select 1 from public.general_teams where project_id = project and id = other_team) then
    raise exception 'FAIL: team appeared in another project archive';
  end if;
  if not exists (select 1 from public.general_team_members where team_id = first_team and user_id = pm)
     or not exists (select 1 from public.general_positions where id = position_id and team_id = first_team) then
    raise exception 'FAIL: archived team lost people or positions';
  end if;

  begin
    insert into public.general_tasks (project_id, team_id, title) values (project, first_team, 'New work');
    raise exception 'FAIL: open work assigned to archived team';
  exception when check_violation then
    if position('Restore the team' in sqlerrm) = 0 then raise; end if;
  end;

  update public.general_teams set archived_at = null where id = first_team;
  if not public.general_leads_user(project, pm, pm) then raise exception 'FAIL: restored lead has no rights'; end if;
  if not exists (select 1 from public.general_teams where id = first_team and archived_at is null) then
    raise exception 'FAIL: team was not restored';
  end if;
  raise notice 'PASS: open task refusal, project scope, preserved structure, archived task refusal, restore';
end $$;
rollback;
