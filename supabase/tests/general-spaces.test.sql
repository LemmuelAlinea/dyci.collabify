-- Spaces: what a space member may read, and everything they may not do.
--
-- The whole design is one split — read widens to the space, write stays on the
-- project — so most of this file is the negative half of it.
--
-- Rolls back; nothing here survives.
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
  owner_id    uuid := gen_random_uuid();  -- owns the space and the project
  watcher_id  uuid := gen_random_uuid();  -- in the space, NOT on the project
  stranger_id uuid := gen_random_uuid();  -- in neither
  space       public.general_spaces%rowtype;
  other       public.general_spaces%rowtype;
  proj        public.general_projects%rowtype;
  p2          public.general_projects%rowtype;
  task        uuid;
  code        text;
  joined      uuid;
  n           int;
  lvl         public.general_level;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Space', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id,    'space-owner@test.local',    'Owner'),
                 (watcher_id,  'space-watcher@test.local',  'Watcher'),
                 (stranger_id, 'space-stranger@test.local', 'Stranger')) as v(id, em, ln);
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';

  ------------------------------------------------------------------ setup
  perform pg_temp.act_as(owner_id);
  space := public.create_general_space('Thesis space', 'Everything for the thesis');
  perform pg_temp.ok('creating a space makes you its Owner',
    (select level from public.general_space_members
      where space_id = space.id and user_id = owner_id) = 'owner');

  proj := public.create_general_project('Capstone', '', null, null, null, null, space.id);
  perform pg_temp.ok('a project created in a space belongs to it',
                     proj.space_id = space.id);

  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Write chapter 1', owner_id) returning id into task;

  -- The watcher joins the SPACE by code, and never the project.
  code := public.set_general_space_join_code(space.id, true);
  perform pg_temp.ok('an Owner can open a join code', code is not null and length(code) = 8);

  perform pg_temp.act_as(watcher_id);
  joined := public.join_general_space(code);
  perform pg_temp.ok('a correct code joins the space', joined = space.id);
  perform pg_temp.ok('joining a space does not join its projects',
    not exists (select 1 from public.general_members
                 where project_id = proj.id and user_id = watcher_id));

  ------------------------------------------------------------------ the widening
  select count(*) into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('a space member reads a project they are not on', n = 1);

  select count(*) into n from public.general_tasks where project_id = proj.id;
  perform pg_temp.ok('...and its tasks', n = 1);

  select count(*) into n from public.general_members where project_id = proj.id;
  perform pg_temp.ok('...and who is on it', n = 1);

  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('...and the overview view, which is security_invoker', n = 1);

  -- The client half of the same change: a space member holds no level on the
  -- project, so anything reading my_level has to treat null as no permissions.
  perform pg_temp.ok('...where their level on the project is null',
    (select my_level from public.general_project_overview where id = proj.id) is null);
  perform pg_temp.ok('...and the join code is still withheld',
    (select join_code from public.general_project_overview where id = proj.id) is null);
  perform pg_temp.ok('...while the progress figures are real',
    (select task_count from public.general_project_overview where id = proj.id) = 1);

  ------------------------------------------------------------------ but writes nothing
  begin
    insert into public.general_tasks (project_id, title, created_by)
    values (proj.id, 'Sneak a task in', watcher_id);
    perform pg_temp.ok('a space member cannot add a task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a space member cannot add a task', true);
  end;

  update public.general_tasks set title = 'Renamed by a watcher' where id = task;
  perform pg_temp.ok('a space member cannot rename a task',
    (select title from public.general_tasks where id = task) = 'Write chapter 1');

  update public.general_projects set name = 'Renamed by a watcher' where id = proj.id;
  perform pg_temp.ok('a space member cannot rename the project',
    (select name from public.general_projects where id = proj.id) = 'Capstone');

  delete from public.general_tasks where id = task;
  perform pg_temp.ok('a space member cannot delete a task',
    exists (select 1 from public.general_tasks where id = task));

  begin
    insert into public.general_members (project_id, user_id, level)
    values (proj.id, watcher_id, 'owner');
    perform pg_temp.ok('a space member cannot add themselves to the project', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a space member cannot add themselves to the project', true);
  end;

  ------------------------------------------------------------------ and reads no secrets
  select count(*) into n from public.general_join_codes where project_id = proj.id;
  perform pg_temp.ok('a space member cannot read the project''s join code', n = 0);

  -- The reason can_read_general_project exists instead of widening
  -- is_general_member: profiles carry emails.
  select count(*) into n from public.profiles where id = owner_id;
  perform pg_temp.ok('a space member cannot read a project member''s profile row', n = 0);

  select count(*) into n from public.list_general_project_members(proj.id);
  perform pg_temp.ok('...but the members list RPC still names them', n = 1);

  ------------------------------------------------------------------ a stranger
  perform pg_temp.act_as(stranger_id);
  select count(*) into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('a stranger reads no project', n = 0);
  select count(*) into n from public.general_tasks where project_id = proj.id;
  perform pg_temp.ok('a stranger reads no tasks', n = 0);
  select count(*) into n from public.general_spaces where id = space.id;
  perform pg_temp.ok('a stranger reads no space', n = 0);

  begin
    perform public.list_general_project_members(proj.id);
    perform pg_temp.ok('a stranger cannot list the project''s members', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a stranger cannot list the project''s members', true);
  end;

  ------------------------------------------------------------------ a project invitee
  -- general_projects_select was rewritten; the pending-invitation door that
  -- lets somebody see what they were invited to must still work.
  perform pg_temp.act_as(owner_id);
  perform public.invite_to_general_project(proj.id, stranger_id);

  perform pg_temp.act_as(stranger_id);
  select count(*) into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('a project invitee still sees the project they were invited to', n = 1);
  select count(*) into n from public.general_tasks where project_id = proj.id;
  perform pg_temp.ok('...but not what is inside it', n = 0);

  -- The overview left-joins membership now, so an invitee reaches a row where
  -- they used to reach none. Every figure on it must still come back empty.
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('an invitee reaches the overview row', n = 1);
  perform pg_temp.ok('...carrying no level, no members and no tasks',
    (select my_level is null and member_count = 0 and task_count = 0 and join_code is null
       from public.general_project_overview where id = proj.id));

  ------------------------------------------------------------------ creating projects
  perform pg_temp.act_as(stranger_id);
  begin
    p2 := public.create_general_project('Trespass', '', null, null, null, null, space.id);
    perform pg_temp.ok('you cannot create a project in a space you are not in', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('you cannot create a project in a space you are not in', true);
  end;

  -- No space named: one is made for you, so this file can land before the
  -- pages know what a space is.
  p2 := public.create_general_project('My first', '');
  perform pg_temp.ok('a project created with no space still gets one',
                     p2.space_id is not null);
  perform pg_temp.ok('...and you own that space',
    (select level from public.general_space_members
      where space_id = p2.space_id and user_id = stranger_id) = 'owner');

  -- The second one reuses it rather than making another.
  perform public.create_general_project('My second', '');
  select count(*) into n from public.general_spaces where created_by = stranger_id;
  perform pg_temp.ok('a second project reuses the same space', n = 1);

  -- A space member who is not an Owner may still create a project.
  perform pg_temp.act_as(watcher_id);
  p2 := public.create_general_project('Watcher''s project', '', null, null, null, null, space.id);
  perform pg_temp.ok('any space member may create a project in it',
                     p2.space_id = space.id);
  perform pg_temp.ok('...and owns the project they made',
    (select level from public.general_members
      where project_id = p2.id and user_id = watcher_id) = 'owner');
  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_projects where id = p2.id;
  perform pg_temp.ok('...which everyone else in the space can now read', n = 1);

  ------------------------------------------------------------------ join code misses
  perform pg_temp.act_as(stranger_id);
  perform pg_temp.ok('a wrong code is a miss, not an error',
                     public.join_general_space('ZZZZZZZZ') is null);

  perform pg_temp.act_as(owner_id);
  perform public.set_general_space_join_code(space.id, false);
  perform pg_temp.act_as(stranger_id);
  perform pg_temp.ok('a closed code no longer joins',
                     public.join_general_space(code) is null);

  ------------------------------------------------------------------ the last Owner
  perform pg_temp.act_as(owner_id);
  begin
    perform public.set_general_space_level(space.id, owner_id, 'member');
    perform pg_temp.ok('the last Owner cannot step down', false);
  exception when check_violation then
    perform pg_temp.ok('the last Owner cannot step down', true);
  end;

  begin
    perform public.remove_general_space_member(space.id, owner_id);
    perform pg_temp.ok('the last Owner cannot leave', false);
  exception when check_violation then
    perform pg_temp.ok('the last Owner cannot leave', true);
  end;

  -- With a second Owner, the first may go.
  perform public.set_general_space_level(space.id, watcher_id, 'owner');
  select level into lvl from public.general_space_members
   where space_id = space.id and user_id = watcher_id;
  perform pg_temp.ok('an Owner can promote somebody', lvl = 'owner');
  perform public.remove_general_space_member(space.id, owner_id);
  perform pg_temp.ok('...and then step out themselves',
    not exists (select 1 from public.general_space_members
                 where space_id = space.id and user_id = owner_id));

  -- Which takes their read of the space's projects with them.
  select count(*) into n from public.general_projects where id = p2.id;
  perform pg_temp.ok('leaving a space ends the read it granted', n = 0);
  -- But not of the project they are actually on.
  select count(*) into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('...while a project membership of their own survives it', n = 1);

  ------------------------------------------------------------------ permission levels
  perform pg_temp.act_as(watcher_id);
  other := public.create_general_space('Levels', '');
  perform public.invite_to_general_space(other.id, stranger_id);

  perform pg_temp.act_as(stranger_id);
  select count(*) into n from public.general_spaces where id = other.id;
  perform pg_temp.ok('an invitee can see the space they were invited to', n = 1);
  perform public.respond_general_space_invitation(
    (select id from public.general_space_invitations
      where space_id = other.id and invitee = stranger_id), true);
  perform pg_temp.ok('accepting an invitation joins the space',
    exists (select 1 from public.general_space_members
             where space_id = other.id and user_id = stranger_id));

  begin
    perform public.invite_to_general_space(other.id, owner_id);
    perform pg_temp.ok('a Member cannot invite', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member cannot invite', true);
  end;

  begin
    perform public.update_general_space(other.id, 'Renamed', '');
    perform pg_temp.ok('a Member cannot rename the space', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member cannot rename the space', true);
  end;

  -- A Manager invites but does not rename.
  perform pg_temp.act_as(watcher_id);
  perform public.set_general_space_level(other.id, stranger_id, 'manager');
  perform pg_temp.act_as(stranger_id);
  perform public.invite_to_general_space(other.id, owner_id);
  perform pg_temp.ok('a Manager can invite',
    exists (select 1 from public.general_space_invitations
             where space_id = other.id and invitee = owner_id and status = 'pending'));
  begin
    perform public.update_general_space(other.id, 'Renamed', '');
    perform pg_temp.ok('a Manager still cannot rename the space', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Manager still cannot rename the space', true);
  end;

  ------------------------------------------------------------------ archiving
  perform pg_temp.act_as(watcher_id);
  perform public.archive_general_space(other.id, true);
  begin
    perform public.create_general_project('After the archive', '', null, null, null, null, other.id);
    perform pg_temp.ok('an archived space takes no new projects', false);
  exception when check_violation then
    perform pg_temp.ok('an archived space takes no new projects', true);
  end;
  begin
    perform public.update_general_space(other.id, 'Renamed', '');
    perform pg_temp.ok('an archived space cannot be renamed', false);
  exception when check_violation then
    perform pg_temp.ok('an archived space cannot be renamed', true);
  end;
  select count(*) into n from public.general_spaces where id = other.id;
  perform pg_temp.ok('...but an archived space is still readable', n = 1);
  perform public.archive_general_space(other.id, false);
  perform pg_temp.ok('and an Owner can restore it',
    (select archived_at from public.general_spaces where id = other.id) is null);

  perform pg_temp.act_as(stranger_id);
  begin
    perform public.delete_general_space(other.id);
    perform pg_temp.ok('a Manager cannot delete a space', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Manager cannot delete a space', true);
  end;

  perform pg_temp.act_as(watcher_id);
  perform public.delete_general_space(other.id);
  select count(*) into n from public.general_spaces where id = other.id;
  perform pg_temp.ok('an Owner can delete a space', n = 0);
end $$;

rollback;
