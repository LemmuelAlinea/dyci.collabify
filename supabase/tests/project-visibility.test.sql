-- Company roles, phase 2: who sees a work project — rolled back, touches
-- nothing permanently.
--
--   node scripts/db.mjs supabase/tests/project-visibility.test.sql
--
-- A work project is read by its members, and by the Owners of its space
-- (read-only). A plain space member who is not on the project sees nothing of
-- it. Joining a project adds you to its space; leaving it does not take you
-- out. Space invites offer Member or co-owner access, and
-- space join codes no longer admit anyone. Class-board Files projects keep
-- their old access. Every refusal is paired with a case that is allowed, so a
-- refusal never passes for the wrong reason.

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

-- Rows of one project the caller can see in a table, through RLS.
create or replace function pg_temp.seen(p_table text, p_project uuid) returns int
language plpgsql as $$
declare
  n int;
begin
  execute format('select count(*) from public.%I where %I = $1', p_table,
                 case when p_table = 'general_projects' then 'id' else 'project_id' end)
    into n using p_project;
  return n;
end;
$$;

-- ------------------------------------------------------------------ live data

do $$
begin
  perform pg_temp.must_be('every member of a work project is in its space (backfill)',
    not exists (
      select 1
        from public.general_members m
        join public.general_projects p on p.id = m.project_id
        join public.general_spaces s on s.id = p.space_id
       where p.class_board_id is null and s.kind = 'work'
         and not exists (select 1 from public.general_space_members sm
                          where sm.space_id = p.space_id and sm.user_id = m.user_id)));
  perform pg_temp.must_be('no space join code is open',
    not exists (select 1 from public.general_space_join_codes where open));
end $$;

-- Class-board Files projects: every member still reads their project.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select m.project_id, m.user_id
      from public.general_members m
      join public.general_projects p on p.id = m.project_id
      join public.profiles pr on pr.id = m.user_id
     where p.class_board_id is not null and p.archived_at is null
       and pr.status <> 'rejected'
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    if not coalesce(public.can_read_general_project(r.project_id), false) then
      raise exception 'FAIL  class-board member % lost read on %', r.user_id, r.project_id;
    end if;
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS  class-board members still read their Files project (% rows)', n;
end $$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_owner   uuid := gen_random_uuid();  -- space Owner O, Project manager on, not on P
  v_pm      uuid := gen_random_uuid();  -- P's project manager
  v_plain   uuid := gen_random_uuid();  -- S: plain space member, not on P
  v_member  uuid := gen_random_uuid();  -- M: member of P
  v_joiner  uuid := gen_random_uuid();  -- added to P during the test
  v_cowner  uuid := gen_random_uuid();  -- Project manager on, invited as co-owner
  v_nopm    uuid := gen_random_uuid();  -- no Project manager switch
  v_manager uuid := gen_random_uuid();  -- space Manager on P as a member
  v_student uuid := gen_random_uuid();  -- student added to P
  v_pm2     uuid := gen_random_uuid();  -- Project manager on, plain space member
  v_space   uuid;
  v_project uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_owner,   'zz-pv-owner@example.test'),
      (v_pm,      'zz-pv-pm@example.test'),
      (v_plain,   'zz-pv-plain@example.test'),
      (v_member,  'zz-pv-member@example.test'),
      (v_joiner,  'zz-pv-joiner@example.test'),
      (v_cowner,  'zz-pv-cowner@example.test'),
      (v_nopm,    'zz-pv-nopm@example.test'),
      (v_manager, 'zz-pv-manager@example.test'),
      (v_student, 'zz-pv-student@example.test'),
      (v_pm2,     'zz-pv-pm2@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_owner,   'zz-pv-owner@example.test',   'Zz', 'Pvowner',   'member',  'active', false, true),
    (v_pm,      'zz-pv-pm@example.test',      'Zz', 'Pvpm',      'member',  'active', false, true),
    (v_plain,   'zz-pv-plain@example.test',   'Zz', 'Pvplain',   'member',  'active', false, false),
    (v_member,  'zz-pv-member@example.test',  'Zz', 'Pvmember',  'member',  'active', false, false),
    (v_joiner,  'zz-pv-joiner@example.test',  'Zz', 'Pvjoiner',  'member',  'active', false, false),
    (v_cowner,  'zz-pv-cowner@example.test',  'Zz', 'Pvcowner',  'member',  'active', false, true),
    (v_nopm,    'zz-pv-nopm@example.test',    'Zz', 'Pvnopm',    'member',  'active', false, false),
    (v_manager, 'zz-pv-manager@example.test', 'Zz', 'Pvmanager', 'member',  'active', false, false),
    (v_student, 'zz-pv-student@example.test', 'Zz', 'Pvstudent', 'student', 'active', false, false),
    (v_pm2,     'zz-pv-pm2@example.test',     'Zz', 'Pvpmtwo',   'member',  'active', false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_owner);
  v_space := (public.create_general_space('Zz PV space', '')).id;
  perform pg_temp.act_as_service();

  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_pm, 'member'), (v_space, v_plain, 'member'), (v_space, v_manager, 'manager'),
    (v_space, v_pm2, 'member');

  perform pg_temp.act_as(v_pm);
  v_project := (public.create_general_project('Zz PV project', '', null, null, null, null,
                                              v_space)).id;
  -- A project code is open, so the overview has one to withhold.
  perform public.set_general_join_code(v_project, true, true);
  perform pg_temp.act_as_service();

  insert into public.general_members (project_id, user_id) values
    (v_project, v_member), (v_project, v_manager);
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (v_project, 'Zz PV task', v_pm, 'released');
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (v_project, 'Zz PV sprint', current_date, current_date + 7);
  insert into public.general_milestones (project_id, name, due_on)
  values (v_project, 'Zz PV milestone', current_date + 14);
  if not exists (select 1 from public.general_repos where project_id = v_project) then
    insert into public.general_repos (project_id) values (v_project);
  end if;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('owner', v_owner), ('pm', v_pm), ('plain', v_plain), ('member', v_member),
    ('joiner', v_joiner), ('cowner', v_cowner), ('nopm', v_nopm),
    ('manager', v_manager), ('student', v_student), ('pm2', v_pm2),
    ('space', v_space), ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ reading

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_space   uuid := (select v from fx where k = 'space');
  t text;
begin
  -- S: a plain space member who is not on P.
  perform pg_temp.act_as((select v from fx where k = 'plain'));
  foreach t in array array['general_tasks', 'general_members', 'general_repos',
                           'general_sprints', 'general_milestones', 'general_projects'] loop
    perform pg_temp.must_be(format('a plain space member sees no %s of P', t),
      pg_temp.seen(t, v_project) = 0);
  end loop;
  perform pg_temp.must_be('...can_read_general_project says no',
    not coalesce(public.can_read_general_project(v_project), false));
  perform pg_temp.must_be('...and P is not in their project overview',
    not exists (select 1 from public.general_project_overview where id = v_project));
  perform pg_temp.must_be('...and their space overview counts no project',
    (select project_count = 0 from public.general_space_overview where id = v_space));
  perform pg_temp.must_be('...but they still see the space itself',
    exists (select 1 from public.general_spaces where id = v_space));
  perform pg_temp.must_refuse_with('a plain space member cannot list P''s members',
    format('select * from public.list_general_project_members(%L)', v_project),
    'You cannot see this project');

  -- M: a member of P.
  perform pg_temp.act_as((select v from fx where k = 'member'));
  foreach t in array array['general_tasks', 'general_members', 'general_repos',
                           'general_sprints', 'general_milestones', 'general_projects'] loop
    perform pg_temp.must_be(format('a project member sees %s of P', t),
      pg_temp.seen(t, v_project) > 0);
  end loop;
  perform pg_temp.must_be('...and lists its members',
    (select count(*) from public.list_general_project_members(v_project)) = 3);

  -- O: an Owner of the space, not on P.
  perform pg_temp.act_as((select v from fx where k = 'owner'));
  perform pg_temp.must_be('the space Owner sees P',
    pg_temp.seen('general_projects', v_project) = 1);
  perform pg_temp.must_be('...and its tasks', pg_temp.seen('general_tasks', v_project) = 1);
  perform pg_temp.must_be('...and its members', pg_temp.seen('general_members', v_project) = 3);
  perform pg_temp.must_be('...and P in their project overview',
    exists (select 1 from public.general_project_overview where id = v_project));
  perform pg_temp.must_be('...and their space overview counts it',
    (select project_count = 1 from public.general_space_overview where id = v_space));
  perform pg_temp.must_allow('...and lists its members',
    format('select * from public.list_general_project_members(%L)', v_project));
  perform pg_temp.must_be('...all three of them',
    (select count(*) from public.list_general_project_members(v_project)) = 3);
  perform pg_temp.must_be('...and can still ask whether P has a project manager',
    public.general_project_has_pm(v_project));
  perform pg_temp.must_be('...where they hold no level on P',
    (select my_level is null from public.general_project_overview where id = v_project));
  perform pg_temp.must_be('...and the project''s join code is withheld',
    (select join_code is null from public.general_project_overview where id = v_project));
  perform pg_temp.must_be('...and is a report lead on P',
    public.general_report_is_lead(v_project));
  -- An internal helper the report RPCs call; read as postgres with O's claims.
  perform set_config('role', 'none', true);
  perform pg_temp.must_be('...and P is in their report scope',
    exists (select 1 from public.general_report_projects(v_space, null, false)
             where project_id = v_project and is_lead));
  perform pg_temp.act_as_service();
end $$;

-- A space Manager on P as a member reads P as a member, not as a lead.
do $$
declare
  v_project uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as((select v from fx where k = 'manager'));
  perform pg_temp.must_be('a space Manager on P reads it',
    pg_temp.seen('general_projects', v_project) = 1);
  perform pg_temp.must_be('...but is not a report lead: only Owners see every row',
    not public.general_report_is_lead(v_project));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ read-only

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_owner   uuid := (select v from fx where k = 'owner');
  v_member  uuid := (select v from fx where k = 'member');
  n int;
begin
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('the space Owner cannot add a task to P',
    format($q$insert into public.general_tasks (project_id, title, created_by)
              values (%L, 'Zz PV owner task', %L)$q$, v_project, v_owner),
    'You are not on this project');
  update public.general_projects set name = 'Zz PV renamed' where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...and cannot rename P (no row changes)', n = 0);

  -- Members cannot create work; the PM creates a private plan and renames P.
  perform pg_temp.act_as(v_member);
  perform pg_temp.must_refuse_with('a project member cannot add a task to P',
    format($q$insert into public.general_tasks (project_id, title, created_by)
              values (%L, 'Zz PV member task', %L)$q$, v_project, v_member),
    'Only the project manager or a coordinator creates tasks');
  perform pg_temp.act_as((select v from fx where k = 'pm'));
  insert into public.general_tasks (project_id, title) values (v_project, 'Zz PV plan');
  perform pg_temp.must_be('the project manager creates a private plan',
    exists (select 1 from public.general_tasks where project_id = v_project
      and title = 'Zz PV plan' and routing_state = 'planning'));
  update public.general_projects set name = 'Zz PV renamed' where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...and the project manager renames P', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ joining

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_space   uuid := (select v from fx where k = 'space');
  v_joiner  uuid := (select v from fx where k = 'joiner');
  v_student uuid := (select v from fx where k = 'student');
  v_pm      uuid := (select v from fx where k = 'pm');
begin
  perform pg_temp.must_be('the joiner starts outside the space',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_joiner));
  insert into public.general_members (project_id, user_id) values (v_project, v_joiner);
  perform pg_temp.must_be('joining P adds them to its space as a member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_joiner));

  delete from public.general_members where project_id = v_project and user_id = v_joiner;
  perform pg_temp.must_be('leaving P keeps the space row',
    exists (select 1 from public.general_space_members
             where space_id = v_space and user_id = v_joiner));

  -- Through the app: the PM adds a student by invitation; the student accepts.
  perform pg_temp.act_as(v_pm);
  perform public.invite_to_general_project(v_project, v_student, 'member');
  perform pg_temp.act_as(v_student);
  perform public.respond_general_invitation(
    (select id from public.general_invitations
      where project_id = v_project and invitee = v_student and status = 'pending'), true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student who accepts a project invite is a space member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_student));

  -- Someone already in the space keeps their level.
  insert into public.general_members (project_id, user_id)
  values (v_project, (select v from fx where k = 'owner'));
  perform pg_temp.must_be('an Owner who joins P stays the space''s Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = (select v from fx where k = 'owner')));
  delete from public.general_members
   where project_id = v_project and user_id = (select v from fx where k = 'owner');
end $$;

-- ------------------------------------------------------------------ invites

do $$
declare
  v_space  uuid := (select v from fx where k = 'space');
  v_owner  uuid := (select v from fx where k = 'owner');
  v_plain  uuid := (select v from fx where k = 'plain');
  v_cowner uuid := (select v from fx where k = 'cowner');
  v_nopm   uuid := (select v from fx where k = 'nopm');
begin
  perform pg_temp.act_as(v_plain);
  perform pg_temp.must_refuse_with('a plain space member cannot invite anyone',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_cowner),
    'Only an Owner');

  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('the Owner cannot invite someone without Project manager',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_nopm),
    'Only people with Project manager turned on can co-own a space. Invite them to a project instead.');
  perform pg_temp.must_allow('the Owner invites someone with Project manager',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_cowner));

  perform pg_temp.must_be('legacy co-owner invitations default to Owner',
    (select invited_level = 'owner' from public.general_space_invitations
      where space_id = v_space and invitee = v_cowner and status = 'pending'));

  perform pg_temp.must_be('the Owner lists co-owner access',
    (select invited_level = 'owner' from public.list_general_space_invitations(v_space)
      where invitee_id = v_cowner));
  perform pg_temp.act_as(v_cowner);
  perform pg_temp.must_be('the co-owner invitee lists Owner access',
    (select invited_level = 'owner' from public.list_my_general_space_invitations()
      where space_id = v_space));
  perform pg_temp.must_allow('...who accepts',
    format('select public.respond_general_space_invitation(%L, true)',
      (select id from public.general_space_invitations
        where space_id = v_space and invitee = v_cowner and status = 'pending')));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and joins the space as an Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_cowner));
end $$;

-- A plain member with Project manager can be invited to co-own; an Owner cannot.
do $$
declare
  v_space uuid := (select v from fx where k = 'space');
  v_owner uuid := (select v from fx where k = 'owner');
  v_pm    uuid := (select v from fx where k = 'pm');
  v_cowner uuid := (select v from fx where k = 'cowner');
begin
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('inviting someone who already co-owns the space is refused',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_cowner),
    'They already co-own this space');
  perform pg_temp.must_allow('the Owner invites a plain space member who has Project manager',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_pm));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('...who accepts',
    format('select public.respond_general_space_invitation(%L, true)',
      (select id from public.general_space_invitations
        where space_id = v_space and invitee = v_pm and status = 'pending')));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and is raised from member to Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_pm));
end $$;

-- Making someone an Owner directly follows the same rule.
do $$
declare
  v_space uuid := (select v from fx where k = 'space');
  v_owner uuid := (select v from fx where k = 'owner');
  v_plain uuid := (select v from fx where k = 'plain');
  v_pm2   uuid := (select v from fx where k = 'pm2');
begin
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('an Owner cannot make someone without Project manager an Owner',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_plain, 'owner'),
    'Only people with Project manager turned on can co-own a space');
  perform pg_temp.must_allow('...but can make someone with it an Owner',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_pm2, 'owner'));
  perform pg_temp.must_allow('...and can still make the plain member a Manager',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_plain, 'manager'));
  perform pg_temp.must_allow('...and back to member',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_plain, 'member'));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...so they are a member again and the switch-holder an Owner',
    (select level = 'member' from public.general_space_members where space_id = v_space and user_id = v_plain)
    and (select level = 'owner' from public.general_space_members where space_id = v_space and user_id = v_pm2));
end $$;

-- In a work space a Manager runs no invitations or codes; an Owner does.
do $$
declare
  v_space   uuid := (select v from fx where k = 'space');
  v_owner   uuid := (select v from fx where k = 'owner');
  v_manager uuid := (select v from fx where k = 'manager');
  v_nopm    uuid := (select v from fx where k = 'nopm');
  v_inv     uuid;
begin
  update public.profiles set can_manage_projects = true where id = v_nopm;
  perform pg_temp.act_as(v_owner);
  v_inv := (public.invite_to_general_space(v_space, v_nopm)).id;
  perform pg_temp.act_as_service();
  insert into public.general_space_join_codes (space_id, code, open)
  values (v_space, 'ZZPVCODE', false);

  perform pg_temp.act_as(v_manager);
  perform pg_temp.must_be('a work-space Manager reads no pending invitations',
    not exists (select 1 from public.general_space_invitations where id = v_inv));
  perform pg_temp.must_be('...nor the join code',
    not exists (select 1 from public.general_space_join_codes where space_id = v_space));
  perform pg_temp.must_refuse_with('...cannot list the invitations',
    format('select * from public.list_general_space_invitations(%L)', v_space),
    'You need permission to see this space''s invitations');
  perform pg_temp.must_refuse_with('...cannot withdraw one',
    format('select public.withdraw_general_space_invitation(%L)', v_inv),
    'You need permission to withdraw this invitation');
  perform pg_temp.must_refuse_with('...and cannot close the join code',
    format('select public.set_general_space_join_code(%L, false)', v_space),
    'You need permission to change this space''s join code');

  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_be('the Owner reads the pending invitation',
    exists (select 1 from public.general_space_invitations where id = v_inv));
  perform pg_temp.must_be('...and the join code',
    exists (select 1 from public.general_space_join_codes where space_id = v_space));
  perform pg_temp.must_be('...lists the invitations',
    exists (select 1 from public.list_general_space_invitations(v_space) where invitation_id = v_inv));
  perform pg_temp.must_allow('...and withdraws one',
    format('select public.withdraw_general_space_invitation(%L)', v_inv));
  perform pg_temp.act_as_service();
  -- The closed code stays: a join code is never removed, only turned off.
  update public.profiles set can_manage_projects = false where id = v_nopm;
end $$;

-- A project stays in its space and keeps its class-board link.
do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_space   uuid := (select v from fx where k = 'space');
  v_pm      uuid := (select v from fx where k = 'pm');
  v_elsewhere uuid;
  v_board   uuid := (select id from public.project_boards limit 1);
begin
  perform pg_temp.act_as(v_pm);
  v_elsewhere := (public.create_general_space('Zz PV elsewhere', '')).id;
  perform pg_temp.must_refuse_with('the project manager cannot move P to another space',
    format('update public.general_projects set space_id = %L where id = %L', v_elsewhere, v_project),
    'A project stays in the space it was created in');
  perform pg_temp.must_refuse_with('...nor turn it into a class board''s Files project',
    format('update public.general_projects set class_board_id = %L where id = %L',
           coalesce(v_board, gen_random_uuid()), v_project),
    'link to a class board cannot be changed');
  perform pg_temp.must_allow('...while renaming it, space unchanged, still works',
    format($q$update public.general_projects set name = 'Zz PV moved?', space_id = %L where id = %L$q$,
           v_space, v_project));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and P is still in its space, with no board',
    (select space_id = v_space and class_board_id is null
       from public.general_projects where id = v_project));
end $$;

-- An invitee whose switch was turned off after the invite cannot accept it.
do $$
declare
  v_space uuid := (select v from fx where k = 'space');
  v_owner uuid := (select v from fx where k = 'owner');
  v_nopm  uuid := (select v from fx where k = 'nopm');
begin
  update public.profiles set can_manage_projects = true where id = v_nopm;
  perform pg_temp.act_as(v_owner);
  perform public.invite_to_general_space(v_space, v_nopm);
  perform pg_temp.act_as_service();
  update public.profiles set can_manage_projects = false where id = v_nopm;
  perform pg_temp.act_as(v_nopm);
  perform pg_temp.must_refuse_with('an invitee who lost Project manager cannot accept',
    format('select public.respond_general_space_invitation(%L, true)',
      (select id from public.general_space_invitations
        where space_id = v_space and invitee = v_nopm and status = 'pending')),
    'Project manager');
  perform pg_temp.must_allow('...but can decline',
    format('select public.respond_general_space_invitation(%L, false)',
      (select id from public.general_space_invitations
        where space_id = v_space and invitee = v_nopm and status = 'pending')));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and is not in the space',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_nopm));
end $$;

-- ------------------------------------------------------------------ space codes

do $$
declare
  v_space uuid := (select v from fx where k = 'space');
  v_owner uuid := (select v from fx where k = 'owner');
  v_nopm  uuid := (select v from fx where k = 'nopm');
begin
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('opening a space join code is refused',
    format('select public.set_general_space_join_code(%L, true)', v_space),
    'Space codes are retired. Share a project code instead.');
  perform pg_temp.must_refuse_with('...and so is regenerating one',
    format('select public.set_general_space_join_code(%L, true, true)', v_space),
    'Space codes are retired');
  perform pg_temp.must_allow('closing a code that was never opened is allowed',
    format('select public.set_general_space_join_code(%L, false)', v_space));

  -- An older open code (none live) still closes, and admits nobody meanwhile.
  perform pg_temp.act_as_service();
  update public.general_space_join_codes set open = true
   where space_id = v_space and code = 'ZZPVCODE';
  perform pg_temp.act_as(v_nopm);
  perform pg_temp.must_refuse_with('joining by an open space code is refused',
    'select public.join_general_space(''ZZPVCODE'')',
    'Space codes are retired. Share a project code instead.');
  perform pg_temp.must_refuse_with('...and by any other code',
    'select public.join_general_space(''NOPE1234'')',
    'Space codes are retired');
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_allow('the Owner closes the open code',
    format('select public.set_general_space_join_code(%L, false)', v_space));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is closed',
    (select not open from public.general_space_join_codes where space_id = v_space));
  perform pg_temp.must_be('...and the joiner never got in',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_nopm));
end $$;


-- Regular invitations grant space membership only, and never lower a seat.
do $$
declare
  v_space uuid := (select v from fx where k = 'space');
  v_owner uuid := (select v from fx where k = 'owner');
  v_nopm uuid := (select v from fx where k = 'nopm');
  v_plain uuid := (select v from fx where k = 'plain');
  v_member uuid := (select v from fx where k = 'member');
  v_project uuid := (select v from fx where k = 'project');
  v_class uuid;
  v_inv uuid;
begin
  perform pg_temp.act_as(v_plain);
  perform pg_temp.must_refuse_with('a non-Owner cannot invite a regular member',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_nopm), 'Only an Owner');
  perform pg_temp.act_as((select v from fx where k = 'manager'));
  perform pg_temp.must_refuse_with('a Manager cannot invite a regular member',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_nopm), 'Only an Owner');
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('a seated Member cannot receive a regular invite',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_plain), 'already in this space');
  perform pg_temp.must_refuse_with('a seated Owner cannot receive a regular invite',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_owner), 'already in this space');
  perform pg_temp.must_refuse_with('a missing account cannot be invited',
    format('select public.invite_general_space_member(%L, %L)', v_space, gen_random_uuid()), 'cannot be invited');
  perform public.archive_general_space(v_space, true);
  perform pg_temp.must_refuse_with('an archived space cannot invite a regular member',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_nopm), 'archived');
  perform public.archive_general_space(v_space, false);
  v_inv := (public.invite_general_space_member(v_space, v_nopm)).id;
  perform pg_temp.must_be('the Owner sees the offered Member level',
    (select invited_level = 'member' from public.list_general_space_invitations(v_space)
      where invitation_id = v_inv));
  perform pg_temp.must_refuse_with('a duplicate pending regular invite is refused',
    format('select public.invite_general_space_member(%L, %L)', v_space, v_nopm), 'duplicate key');
  perform public.archive_general_space(v_space, true);
  perform pg_temp.act_as(v_nopm);
  perform pg_temp.must_refuse_with('a regular invite cannot be accepted while archived',
    format('select public.respond_general_space_invitation(%L, true)', v_inv), 'archived');
  perform pg_temp.act_as(v_owner);
  perform public.archive_general_space(v_space, false);
  perform pg_temp.act_as(v_nopm);
  perform pg_temp.must_be('the invitee sees the offered Member level',
    (select invited_level = 'member' from public.list_my_general_space_invitations()
      where invitation_id = v_inv));
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.must_be('regular acceptance does not reveal an unrelated project',
    pg_temp.seen('general_projects', v_project) = 0);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a non-PM accepts as Member without a project role',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_nopm)
    and not exists (select 1 from public.general_members where user_id = v_nopm));

  delete from public.general_space_members where space_id = v_space and user_id = v_nopm;
  perform pg_temp.act_as(v_owner);
  v_inv := (public.invite_general_space_member(v_space, v_nopm)).id;
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values (v_space, v_nopm, 'owner');
  perform pg_temp.act_as(v_nopm);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting a pending Member invitation never demotes an Owner',
    (select level = 'owner' from public.general_space_members where space_id = v_space and user_id = v_nopm));

  delete from public.general_space_members where space_id = v_space and user_id = v_member;
  perform pg_temp.act_as(v_owner);
  v_inv := (public.invite_general_space_member(v_space, v_member)).id;
  perform pg_temp.act_as(v_member);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('regular acceptance preserves an existing project role',
    (select role = 'member' from public.general_members where project_id = v_project and user_id = v_member));

  delete from public.general_space_members
   where space_id = v_space and user_id = (select v from fx where k = 'student');
  update public.profiles set can_manage_projects = false where id = v_owner;
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('regular invitations retain the student-inviter restriction',
    format('select public.invite_general_space_member(%L, %L)', v_space,
      (select v from fx where k = 'student')), 'Only project managers and teachers');
  perform pg_temp.act_as_service();
  update public.profiles set can_manage_projects = true where id = v_owner;
  perform pg_temp.act_as(v_owner);
  v_inv := (public.invite_general_space_member(v_space, (select v from fx where k = 'student'))).id;
  perform pg_temp.act_as((select v from fx where k = 'student'));
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an eligible Owner can still invite a student as Member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = (select v from fx where k = 'student')));

  update public.profiles set can_teach = true where id = v_owner;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_owner, 'Zz PV class', 'ZZPV', 'ZZPV-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027')
  returning space_id into v_class;
  perform pg_temp.act_as(v_owner);
  perform pg_temp.must_refuse_with('a class Owner cannot use the regular invitation RPC',
    format('select public.invite_general_space_member(%L, %L)', v_class, v_nopm), 'work space');
  v_inv := (public.invite_to_general_space(v_class, v_member)).id;
  perform pg_temp.act_as(v_member);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('class invitations still seat a co-teacher at Manager',
    (select level = 'manager' from public.general_space_members
      where space_id = v_class and user_id = v_member));
end $$;

rollback;
