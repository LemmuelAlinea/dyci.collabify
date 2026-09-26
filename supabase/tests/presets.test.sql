-- Project presets. Rolls back; nothing here survives.
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  n        int;
  team_a   uuid;
  team_b   uuid;
  content  jsonb;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at,
                          aud, role, instance_id)
  values
    (owner_id, 'preset-owner@test.local', 'x', now(),
     jsonb_build_object('first_name', 'Pres', 'last_name', 'Owner', 'role', 'professor'),
     now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (other_id, 'preset-other@test.local', 'x', now(),
     jsonb_build_object('first_name', 'Pres', 'last_name', 'Other', 'role', 'professor'),
     now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';

  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  ------------------------------------------------------------------ no content
  proj := public.create_general_project('Plain one', 'no preset');
  if proj.preset is null then
    raise notice 'PASS  a project made without a preset records none';
  else
    raise notice 'FAIL  a project made without a preset recorded %', proj.preset;
  end if;

  select count(*) into n from public.general_fields where project_id = proj.id;
  if n = 0 then
    raise notice 'PASS  no content means no fields';
  else
    raise notice 'FAIL  no content still wrote % fields', n;
  end if;

  ------------------------------------------------------------- a full preset
  content := jsonb_build_object(
    'fields', jsonb_build_array(
      jsonb_build_object('name', 'Client', 'type', 'short_text', 'options', '[]'::jsonb, 'sort', 0),
      jsonb_build_object('name', 'Stage', 'type', 'single_choice',
                         'options', jsonb_build_array('One', 'Two'), 'sort', 1)
    ),
    'teams', jsonb_build_array('Development', 'Testing'),
    'positions', jsonb_build_array(
      jsonb_build_object('name', 'Adviser', 'team', null),
      jsonb_build_object('name', 'Lead developer', 'team', 'Development')
    ),
    'tasks', jsonb_build_array(
      jsonb_build_object('title', 'Gather requirements', 'description', 'With the client', 'team', null),
      jsonb_build_object('title', 'Build it', 'description', '', 'team', 'Development')
    )
  );

  proj := public.create_general_project('Capstone one', 'from a preset', null, null, 'capstone', content);

  if proj.preset = 'capstone' then
    raise notice 'PASS  the project records which preset it started from';
  else
    raise notice 'FAIL  preset recorded as %', coalesce(proj.preset, 'null');
  end if;

  select count(*) into n from public.general_fields where project_id = proj.id;
  if n = 2 then
    raise notice 'PASS  the preset wrote both fields';
  else
    raise notice 'FAIL  the preset wrote % fields, expected 2', n;
  end if;

  select count(*) into n from public.general_fields
   where project_id = proj.id and type = 'single_choice'
     and options = jsonb_build_array('One', 'Two');
  if n = 1 then
    raise notice 'PASS  a choice field keeps its options and its type';
  else
    raise notice 'FAIL  the choice field did not survive';
  end if;

  select id into team_a from public.general_teams where project_id = proj.id and name = 'Development';
  select id into team_b from public.general_teams where project_id = proj.id and name = 'Testing';
  if team_a is not null and team_b is not null then
    raise notice 'PASS  both teams exist';
  else
    raise notice 'FAIL  a team is missing';
  end if;

  select count(*) into n from public.general_positions
   where project_id = proj.id and name = 'Lead developer' and team_id = team_a;
  if n = 1 then
    raise notice 'PASS  a position lands on the team the preset named';
  else
    raise notice 'FAIL  the position did not land on its team';
  end if;

  select count(*) into n from public.general_positions
   where project_id = proj.id and name = 'Adviser' and team_id is null;
  if n = 1 then
    raise notice 'PASS  a position with no team covers the whole project';
  else
    raise notice 'FAIL  the project-wide position did not land';
  end if;

  select count(*) into n from public.general_tasks
   where project_id = proj.id and title = 'Build it' and team_id = team_a;
  if n = 1 then
    raise notice 'PASS  a task lands on the team the preset named';
  else
    raise notice 'FAIL  the task did not land on its team';
  end if;

  select count(*) into n from public.general_tasks
   where project_id = proj.id and created_by = owner_id and status = 'todo';
  if n = 2 then
    raise notice 'PASS  preset tasks start in To do, credited to the creator';
  else
    raise notice 'FAIL  % preset tasks credited and to-do, expected 2', n;
  end if;

  select count(*) into n from public.general_members
   where project_id = proj.id and user_id = owner_id and level = 'owner';
  if n = 1 then
    raise notice 'PASS  the creator is still the Owner';
  else
    raise notice 'FAIL  the creator is not the Owner';
  end if;

  ------------------------------------------------- nothing a preset makes is locked
  begin
    delete from public.general_fields where project_id = proj.id and name = 'Client';
    select count(*) into n from public.general_fields where project_id = proj.id and name = 'Client';
    if n = 0 then
      raise notice 'PASS  a preset field can be removed like any other';
    else
      raise notice 'FAIL  a preset field could not be removed';
    end if;
  exception when others then
    raise notice 'FAIL  removing a preset field raised %', sqlerrm;
  end;

  begin
    update public.general_teams set name = 'Dev' where id = team_a;
    select count(*) into n from public.general_teams where id = team_a and name = 'Dev';
    if n = 1 then
      raise notice 'PASS  a preset team can be renamed like any other';
    else
      raise notice 'FAIL  a preset team could not be renamed';
    end if;
  exception when others then
    raise notice 'FAIL  renaming a preset team raised %', sqlerrm;
  end;

  ------------------------------------------------------------------ refusals
  begin
    perform public.create_general_project('Too big', '', null, null, 'x',
      jsonb_build_object('tasks',
        (select jsonb_agg(jsonb_build_object('title', 'T' || g, 'description', '', 'team', null))
           from generate_series(1, 101) g)));
    raise notice 'FAIL  a payload over the cap was applied';
  exception
    when check_violation then
      raise notice 'PASS  a payload over the cap is refused';
    when others then
      raise notice 'FAIL  the cap raised the wrong error: %', sqlerrm;
  end;

  begin
    perform public.create_general_project('Bad type', '', null, null, 'x',
      jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'Nope', 'type', 'not_a_type', 'options', '[]'::jsonb, 'sort', 0))));
    raise notice 'FAIL  an unknown field type was accepted';
  exception when others then
    raise notice 'PASS  an unknown field type is refused';
  end;

  -- A control: the same shape with a real type goes through.
  begin
    perform public.create_general_project('Good type', '', null, null, 'x',
      jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('name', 'Yep', 'type', 'short_text', 'options', '[]'::jsonb, 'sort', 0))));
    raise notice 'PASS  the same shape with a real type is accepted';
  exception when others then
    raise notice 'FAIL  a valid field type was refused: %', sqlerrm;
  end;

  -- A task naming a team the payload never creates must not point anywhere.
  proj := public.create_general_project('Ghost team', '', null, null, 'x',
    jsonb_build_object(
      'teams', jsonb_build_array('Real'),
      'tasks', jsonb_build_array(
        jsonb_build_object('title', 'Orphan', 'description', '', 'team', 'Imaginary'))));
  select count(*) into n from public.general_tasks
   where project_id = proj.id and title = 'Orphan' and team_id is null;
  if n = 1 then
    raise notice 'PASS  a task naming an unknown team covers the project instead';
  else
    raise notice 'FAIL  a task naming an unknown team did not fall back';
  end if;

  ------------------------------------------- a preset cannot reach another project
  perform set_config('request.jwt.claims',
    json_build_object('sub', other_id, 'role', 'authenticated')::text, true);

  select count(*) into n from public.general_project_overview where id = proj.id;
  if n = 0 then
    raise notice 'PASS  a stranger still cannot see the project the preset built';
  else
    raise notice 'FAIL  a stranger can see a preset-built project';
  end if;

  ------------------------------------------------------- a deactivated account
  -- Service role, the way the other suites do it: 'none' plus no claims.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set status = 'rejected' where id = other_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.create_general_project('From a dead account', '', null, null, 'blank', null);
    raise notice 'FAIL  a deactivated account created a project';
  exception
    when insufficient_privilege then
      raise notice 'PASS  a deactivated account cannot create a project';
    when others then
      raise notice 'FAIL  the wrong error for a deactivated account: %', sqlerrm;
  end;
end $$;

rollback;
