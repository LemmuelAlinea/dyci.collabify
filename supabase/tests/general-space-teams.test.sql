-- Space teams are reusable only inside their Space, and using one while
-- creating a project seeds project membership without exposing other Spaces.
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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    raise notice 'FAIL  %  (allowed)', p_label;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
  end;
end;
$$;

do $$
declare
  owner_id   uuid := gen_random_uuid();
  teammate_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  space      public.general_spaces%rowtype;
  other      public.general_spaces%rowtype;
  team       public.general_space_teams%rowtype;
  project    public.general_projects%rowtype;
  code       text;
  n          int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Team', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'space-team-owner@test.local', 'Owner'),
                 (teammate_id, 'space-team-member@test.local', 'Member'),
                 (stranger_id, 'space-team-stranger@test.local', 'Stranger')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  space := public.create_general_space('Production space', '');
  other := public.create_general_space('Other space', '');

  code := public.set_general_space_join_code(space.id, true);
  perform pg_temp.act_as(teammate_id);
  perform public.join_general_space(code);
  perform pg_temp.act_as(owner_id);

  team := public.create_general_space_team(space.id, 'Writers', 'Reusable writing team', array[teammate_id]);
  perform pg_temp.ok('creating a Space team adds the creator as Owner',
    exists (select 1 from public.general_space_team_members
             where team_id = team.id and user_id = owner_id and level = 'owner'));
  perform pg_temp.ok('creating a Space team can add Space members',
    exists (select 1 from public.general_space_team_members
             where team_id = team.id and user_id = teammate_id));

  project := public.create_general_project('Thesis', '', null, null, null, null, space.id, team.id);
  perform pg_temp.ok('a project can be created from a Space team',
    exists (select 1 from public.general_teams
             where project_id = project.id and space_team_id = team.id and name = 'Writers'));
  perform pg_temp.ok('using a Space team adds its members to the project',
    exists (select 1 from public.general_members
             where project_id = project.id and user_id = teammate_id));
  perform pg_temp.ok('using a Space team fills the project team',
    exists (
      select 1
        from public.general_team_members tm
        join public.general_teams gt on gt.id = tm.team_id
       where gt.project_id = project.id
         and gt.space_team_id = team.id
         and tm.user_id = teammate_id
    ));

  perform pg_temp.must_refuse('a team cannot be reused in another Space',
    format(
      'select public.create_general_project(%L, %L, null, null, null, null, %L, %L)',
      'Wrong space', '', other.id, team.id
    ));

  perform pg_temp.act_as(stranger_id);
  select count(*) into n from public.general_space_teams where id = team.id;
  perform pg_temp.ok('a stranger cannot see the Space team', n = 0);

  perform pg_temp.act_as(owner_id);
  team := public.update_general_space_team(team.id, 'Writers guild', 'Updated reusable team');
  perform pg_temp.ok('an Owner can rename a Space team', team.name = 'Writers guild');

  team := public.archive_general_space_team(team.id, true);
  select count(*) into n from public.list_general_space_teams(space.id, false) where id = team.id;
  perform pg_temp.ok('archived teams leave the active teams list', n = 0);
  select count(*) into n from public.list_general_space_teams(space.id, true) where id = team.id;
  perform pg_temp.ok('archived teams appear in the archived teams list', n = 1);
  perform pg_temp.must_refuse('an archived team cannot be reused for a new project',
    format(
      'select public.create_general_project(%L, %L, null, null, null, null, %L, %L)',
      'Archived team project', '', space.id, team.id
    ));
  perform pg_temp.must_refuse('an archived team cannot be edited',
    format(
      'select public.update_general_space_team(%L, %L, %L)',
      team.id, 'Should fail', ''
    ));

  team := public.archive_general_space_team(team.id, false);
  select count(*) into n from public.list_general_space_teams(space.id, false) where id = team.id;
  perform pg_temp.ok('restored teams return to the active teams list', n = 1);

  perform public.delete_general_space_team(team.id);
  perform pg_temp.ok('deleting a reusable Space team keeps existing project teams',
    exists (select 1 from public.general_teams where project_id = project.id and name = 'Writers'));
  perform pg_temp.ok('deleting a reusable Space team removes its reusable record',
    not exists (select 1 from public.general_space_teams where id = team.id));
end $$;

rollback;
