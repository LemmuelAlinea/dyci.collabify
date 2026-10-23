-- Company roles, phase 2: project roles — rolled back, touches nothing
-- permanently.
--
--   node scripts/db.mjs supabase/tests/project-roles.test.sql
--
-- A work project's people each hold one role: project manager (exactly one),
-- coordinator or member. `level` follows the role, so every older check keeps
-- working. Class-board Files projects keep the old model. Every refusal here
-- is paired with a case that is allowed, so a refusal never passes for the
-- wrong reason.

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

-- The six permissions the caller holds on a project, as a sorted list.
create or replace function pg_temp.perms(p_project uuid) returns text
language sql as $$
  select coalesce(string_agg(p::text, ',' order by p::text), '')
    from unnest(enum_range(null::public.general_permission)) p
   where public.general_has(p_project, p);
$$;

-- ------------------------------------------------------------------ migration

do $$
begin
  -- At most one: PM recovery leaves a project with none until a space owner or
  -- an admin assigns one (assign_general_project_pm).
  perform pg_temp.must_be('no work project has more than one project manager',
    not exists (
      select 1 from public.general_projects p
       where p.class_board_id is null
         and (select count(*) from public.general_members m
               where m.project_id = p.id and m.role = 'pm') > 1));
  perform pg_temp.must_be('...and it is the old Owner: the one Owner row, now pm',
    not exists (
      select 1 from public.general_members m
        join public.general_projects p on p.id = m.project_id
       where p.class_board_id is null
         and (m.level = 'owner') <> (m.role = 'pm')));
  perform pg_temp.must_be('level follows role on every work project row',
    not exists (
      select 1 from public.general_members m
        join public.general_projects p on p.id = m.project_id
       where p.class_board_id is null
         and m.level <> public.general_role_level(m.role)));
  perform pg_temp.must_be('every class-board row is a member by role',
    not exists (
      select 1 from public.general_members m
        join public.general_projects p on p.id = m.project_id
       where p.class_board_id is not null and m.role <> 'member'));
end $$;

-- Class-board Files projects: rows and permissions are what the old model says,
-- before and after the migration runs again.
create temp table cb_before on commit drop as
select m.project_id, m.user_id, m.level::text as level, m.role::text as role
  from public.general_members m
  join public.general_projects p on p.id = m.project_id
 where p.class_board_id is not null;

create temp table cb_perms (phase text, project_id uuid, user_id uuid, perms text, old_rule text)
  on commit drop;

-- Read as the member (auth.uid()), but as postgres, so RLS does not hide the
-- rows the old rule is written against.
create or replace function pg_temp.snapshot_cb_perms(p_phase text) returns void
language plpgsql as $$
declare
  r record;
begin
  for r in select project_id, user_id from cb_before loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    insert into cb_perms
    select p_phase, r.project_id, r.user_id, pg_temp.perms(r.project_id),
           -- The old general_has, written out: Owner or Manager, a grant, or
           -- the class-board commit rule.
           coalesce((select string_agg(p::text, ',' order by p::text)
              from unnest(enum_range(null::public.general_permission)) p
             where public.is_general_member(r.project_id) and (
                   exists (select 1 from public.general_members m
                            where m.project_id = r.project_id and m.user_id = auth.uid()
                              and m.level in ('owner', 'manager'))
                or exists (select 1 from public.general_grants g
                            where g.project_id = r.project_id and g.user_id = auth.uid()
                              and g.permission = p)
                or (p = 'commit_main' and public.general_class_commit_ok(r.project_id)))), '');
  end loop;
  perform pg_temp.act_as_service();
end;
$$;

select pg_temp.snapshot_cb_perms('before');

-- The migration statements again (they must be no-ops by now).
update public.general_members m
   set role = case
                when m.level = 'owner' and m.user_id = (
                  select o.user_id from public.general_members o
                   where o.project_id = m.project_id and o.level = 'owner'
                   order by (o.user_id = p.created_by) desc, o.joined_at, o.user_id
                   limit 1) then 'pm'
                when m.level in ('owner', 'manager') then 'coordinator'
                else 'member'
              end::public.general_role
  from public.general_projects p
 where p.id = m.project_id and p.class_board_id is null
   and m.level <> public.general_role_level(m.role);
update public.general_members m
   set role = 'member'
  from public.general_projects p
 where p.id = m.project_id and p.class_board_id is not null and m.role <> 'member';

select pg_temp.snapshot_cb_perms('after');

do $$
begin
  perform pg_temp.must_be('class-board member rows are unchanged',
    not exists (
      (select project_id, user_id, level, role from cb_before)
      except
      (select m.project_id, m.user_id, m.level::text, m.role::text
         from public.general_members m
         join public.general_projects p on p.id = m.project_id
        where p.class_board_id is not null))
    and (select count(*) from cb_before) = (
      select count(*) from public.general_members m
        join public.general_projects p on p.id = m.project_id
       where p.class_board_id is not null));
  perform pg_temp.must_be('class-board general_has matches the old rule for every member',
    not exists (select 1 from cb_perms where perms <> old_rule));
  perform pg_temp.must_be('...and is the same before and after',
    not exists (
      select 1 from cb_perms b join cb_perms a
        on a.project_id = b.project_id and a.user_id = b.user_id
       where b.phase = 'before' and a.phase = 'after' and a.perms <> b.perms));
  raise notice 'class-board rows checked: %', (select count(*) from cb_before);
end $$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm       uuid := gen_random_uuid();  -- member, Project manager on
  v_pm2      uuid := gen_random_uuid();  -- member, Project manager on
  v_coord    uuid := gen_random_uuid();
  v_plain    uuid := gen_random_uuid();  -- member, no grants
  v_granted  uuid := gen_random_uuid();  -- member, granted edit_files
  v_student  uuid := gen_random_uuid();
  v_student2 uuid := gen_random_uuid();
  v_joiner   uuid := gen_random_uuid();  -- student who joins by code
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,       'zz-pr-pm@example.test'),
      (v_pm2,      'zz-pr-pm2@example.test'),
      (v_coord,    'zz-pr-coord@example.test'),
      (v_plain,    'zz-pr-plain@example.test'),
      (v_granted,  'zz-pr-granted@example.test'),
      (v_student,  'zz-pr-student@example.test'),
      (v_student2, 'zz-pr-student2@example.test'),
      (v_joiner,   'zz-pr-joiner@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,       'zz-pr-pm@example.test',       'Zz', 'Prpm',       'member',  'active', false, true),
    (v_pm2,      'zz-pr-pm2@example.test',      'Zz', 'Prpmtwo',    'member',  'active', false, true),
    (v_coord,    'zz-pr-coord@example.test',    'Zz', 'Prcoord',    'member',  'active', false, false),
    (v_plain,    'zz-pr-plain@example.test',    'Zz', 'Prplain',    'member',  'active', false, false),
    (v_granted,  'zz-pr-granted@example.test',  'Zz', 'Prgranted',  'member',  'active', false, false),
    (v_student,  'zz-pr-student@example.test',  'Zz', 'Prstudent',  'student', 'active', false, false),
    (v_student2, 'zz-pr-student2@example.test', 'Zz', 'Prstudtwo',  'student', 'active', false, false),
    (v_joiner,   'zz-pr-joiner@example.test',   'Zz', 'Prjoiner',   'student', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('pm', v_pm), ('pm2', v_pm2), ('coord', v_coord), ('plain', v_plain),
    ('granted', v_granted), ('student', v_student), ('student2', v_student2),
    ('joiner', v_joiner);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ creating

do $$
declare
  v_pm      uuid := (select v from fx where k = 'pm');
  v_student uuid := (select v from fx where k = 'student');
  v_project uuid;
  v_space   uuid;
  v_team    uuid;
  v_teamed  uuid;
begin
  perform pg_temp.act_as(v_pm);
  v_project := (public.create_general_project('Zz PR project', '')).id;
  perform pg_temp.must_be('the creator of a project is its pm, at level owner',
    (select role = 'pm' and level = 'owner' from public.general_members
      where project_id = v_project and user_id = v_pm));
  perform pg_temp.must_be('general_role_of reads it',
    public.general_role_of(v_project, v_pm) = 'pm');
  perform pg_temp.must_be('...and defaults to the caller',
    public.general_role_of(v_project) = 'pm');
  perform pg_temp.must_be('the project has a pm', public.general_project_has_pm(v_project));

  v_space := (select space_id from public.general_projects where id = v_project);
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level)
  values (v_space, v_student, 'member') on conflict do nothing;
  perform pg_temp.act_as(v_pm);
  v_team := (public.create_general_space_team(v_space, 'Zz PR team', '', array[v_student])).id;
  v_teamed := (public.create_general_project('Zz PR teamed', '', null, null, null, null,
                                             v_space, v_team)).id;
  perform pg_temp.must_be('with a space team, the creator is still pm at level owner',
    (select role = 'pm' and level = 'owner' from public.general_members
      where project_id = v_teamed and user_id = v_pm));
  perform pg_temp.must_be('...and the team''s student is seeded as a member',
    (select role = 'member' and level = 'member' from public.general_members
      where project_id = v_teamed and user_id = v_student));
  perform pg_temp.must_be('...with exactly one pm',
    (select count(*) = 1 from public.general_members
      where project_id = v_teamed and role = 'pm'));
  perform pg_temp.act_as_service();

  insert into fx values ('project', v_project), ('teamed', v_teamed);
end $$;

-- ------------------------------------------------------------------ one pm

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_pm2     uuid := (select v from fx where k = 'pm2');
begin
  perform pg_temp.must_refuse_with('a second pm on the same project is refused',
    format($q$insert into public.general_members (project_id, user_id, role)
              values (%L, %L, 'pm')$q$, v_project, v_pm2),
    'general_members_one_pm');
  perform pg_temp.must_refuse_with('...and so is a second Owner from an older caller',
    format($q$insert into public.general_members (project_id, user_id, level)
              values (%L, %L, 'owner')$q$, v_project, v_pm2),
    'general_members_one_pm');
  perform pg_temp.must_allow('the same person goes in as coordinator',
    format($q$insert into public.general_members (project_id, user_id, role)
              values (%L, %L, 'coordinator')$q$, v_project, v_pm2));
  perform pg_temp.must_be('...at level manager',
    (select level = 'manager' from public.general_members
      where project_id = v_project and user_id = v_pm2));
end $$;

-- ------------------------------------------------------------------ level sync

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_coord   uuid := (select v from fx where k = 'coord');
  v_plain   uuid := (select v from fx where k = 'plain');
  v_granted uuid := (select v from fx where k = 'granted');
  v_pm      uuid := (select v from fx where k = 'pm');
begin
  -- An older caller writes level only.
  insert into public.general_members (project_id, user_id, level)
  values (v_project, v_coord, 'manager');
  perform pg_temp.must_be('an insert at level manager becomes a coordinator',
    (select role = 'coordinator' and level = 'manager' from public.general_members
      where project_id = v_project and user_id = v_coord));

  insert into public.general_members (project_id, user_id) values (v_project, v_plain);
  insert into public.general_members (project_id, user_id, role)
  values (v_project, v_granted, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (v_project, v_granted, 'edit_files', v_pm);

  update public.general_members set role = 'coordinator'
   where project_id = v_project and user_id = v_plain;
  perform pg_temp.must_be('setting the role moves level to manager',
    (select level = 'manager' from public.general_members
      where project_id = v_project and user_id = v_plain));
  update public.general_members set level = 'member'
   where project_id = v_project and user_id = v_plain;
  perform pg_temp.must_be('an older caller setting level member makes them a member again',
    (select role = 'member' and level = 'member' from public.general_members
      where project_id = v_project and user_id = v_plain));
  update public.general_members set role = 'qa'
   where project_id = v_project and user_id = v_plain;
  perform pg_temp.must_be('a qa sits at level member',
    (select level = 'member' from public.general_members
      where project_id = v_project and user_id = v_plain));
  update public.general_members set role = 'member'
   where project_id = v_project and user_id = v_plain;
end $$;

-- ------------------------------------------------------------------ general_has

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as((select v from fx where k = 'coord'));
  perform pg_temp.must_be('a coordinator holds everything but edit_project',
    pg_temp.perms(v_project) = 'commit_main,edit_files,manage_members,manage_structure,manage_tasks');
  perform pg_temp.must_be('...general_has edit_project is false, not null',
    public.general_has(v_project, 'edit_project') is false);

  perform pg_temp.act_as((select v from fx where k = 'plain'));
  perform pg_temp.must_be('a member with no grants holds none', pg_temp.perms(v_project) = '');

  perform pg_temp.act_as((select v from fx where k = 'granted'));
  perform pg_temp.must_be('a member granted edit_files holds only that',
    pg_temp.perms(v_project) = 'edit_files');

  perform pg_temp.act_as((select v from fx where k = 'pm'));
  perform pg_temp.must_be('a pm holds all six',
    pg_temp.perms(v_project)
      = 'commit_main,edit_files,edit_project,manage_members,manage_structure,manage_tasks');

  perform pg_temp.act_as((select v from fx where k = 'joiner'));
  perform pg_temp.must_be('somebody not on the project holds none', pg_temp.perms(v_project) = '');
  perform pg_temp.must_be('...and general_role_of tells them nothing about others',
    public.general_role_of(v_project, (select v from fx where k = 'pm')) is null);
  perform pg_temp.act_as_service();

  -- qa and stakeholder hold nothing, even with a grant.
  update public.general_members set role = 'stakeholder'
   where project_id = v_project and user_id = (select v from fx where k = 'granted');
  perform pg_temp.act_as((select v from fx where k = 'granted'));
  perform pg_temp.must_be('a stakeholder holds none, grant or not', pg_temp.perms(v_project) = '');
  perform pg_temp.act_as_service();
  update public.general_members set role = 'qa'
   where project_id = v_project and user_id = (select v from fx where k = 'granted');
  perform pg_temp.act_as((select v from fx where k = 'granted'));
  perform pg_temp.must_be('...nor does a qa', pg_temp.perms(v_project) = '');
  perform pg_temp.act_as_service();
  update public.general_members set role = 'member'
   where project_id = v_project and user_id = (select v from fx where k = 'granted');
end $$;

-- ------------------------------------------------------------------ pm only

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_coord   uuid := (select v from fx where k = 'coord');
  v_pm      uuid := (select v from fx where k = 'pm');
  n int;
begin
  perform pg_temp.act_as(v_coord);
  update public.general_projects set description = 'Zz coordinator edit' where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a coordinator cannot change the project details', n = 0);
  update public.general_projects set stages = array['Plan', 'Build', 'Test', 'Done']
   where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...nor its stages', n = 0);

  perform pg_temp.act_as(v_pm);
  update public.general_projects set description = 'Zz pm edit' where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('the pm changes the project details', n = 1);
  update public.general_projects set stages = array['Plan', 'Build', 'Test', 'Done']
   where id = v_project;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...and its stages', n = 1);

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot open the join code',
    format('select public.set_general_join_code(%L, true)', v_project), 'Only an Owner');
  perform pg_temp.must_refuse_with('a coordinator cannot archive the project',
    format('select public.archive_general_project(%L, true)', v_project), 'Only an Owner');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm archives it',
    format('select public.archive_general_project(%L, true)', v_project));

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot restore it',
    format('select public.archive_general_project(%L, false)', v_project), 'Only an Owner');
  perform pg_temp.must_refuse_with('...nor delete it',
    format('select public.delete_general_project(%L)', v_project), 'Only an Owner');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm restores it',
    format('select public.archive_general_project(%L, false)', v_project));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ students

do $$
declare
  v_project  uuid := (select v from fx where k = 'project');
  v_student  uuid := (select v from fx where k = 'student');
  v_student2 uuid := (select v from fx where k = 'student2');
  v_pm       uuid := (select v from fx where k = 'pm');
  v_empty    uuid;
begin
  perform pg_temp.must_allow('a student set to coordinator by the service role is allowed',
    format($q$insert into public.general_members (project_id, user_id, role)
              values (%L, %L, 'coordinator')$q$, v_project, v_student));
  perform pg_temp.must_be('...at level manager',
    (select level = 'manager' from public.general_members
      where project_id = v_project and user_id = v_student));

  -- A project with nobody on it, so the one-pm index is not what refuses.
  insert into public.general_projects (name, created_by, space_id)
  values ('Zz PR empty', v_pm, (select space_id from public.general_projects where id = v_project))
  returning id into v_empty;
  perform pg_temp.must_be('a project with nobody on it has no pm',
    not public.general_project_has_pm(v_empty));

  perform pg_temp.must_refuse_with('a student as pm is refused',
    format($q$insert into public.general_members (project_id, user_id, role)
              values (%L, %L, 'pm')$q$, v_empty, v_student2),
    'A student cannot be the project manager.');
  perform pg_temp.must_refuse_with('...and so is a student at level owner from an older caller',
    format($q$insert into public.general_members (project_id, user_id, level)
              values (%L, %L, 'owner')$q$, v_empty, v_student2),
    'A student cannot be the project manager.');
  perform pg_temp.must_refuse_with('...and a student coordinator promoted to pm',
    format($q$update public.general_members set role = 'pm'
               where project_id = %L and user_id = %L$q$, v_project, v_student),
    'A student cannot be the project manager.');
  perform pg_temp.must_allow('a member with Project manager on goes in as pm',
    format($q$insert into public.general_members (project_id, user_id, role)
              values (%L, %L, 'pm')$q$, v_empty, v_pm));
  perform pg_temp.must_be('...and now the project has a pm', public.general_project_has_pm(v_empty));

  -- has_pm wants the switch on.
  update public.profiles set can_manage_projects = false where id = v_pm;
  perform pg_temp.must_be('a pm without the Project manager switch does not count',
    not public.general_project_has_pm(v_empty));
  update public.profiles set can_manage_projects = true where id = v_pm;
end $$;

do $$
declare
  v_project uuid := (select v from fx where k = 'project');
  v_pm      uuid := (select v from fx where k = 'pm');
  v_joiner  uuid := (select v from fx where k = 'joiner');
  v_code    text;
  v_got     uuid;
begin
  perform pg_temp.act_as(v_pm);
  v_code := public.set_general_join_code(v_project, true);
  perform pg_temp.must_be('the pm opens the join code', v_code is not null);

  perform pg_temp.act_as(v_joiner);
  v_got := public.join_general_project(v_code);
  perform pg_temp.must_be('a student uses an open project code', v_got = v_project);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and joins as a member',
    (select role = 'member' and level = 'member' from public.general_members
      where project_id = v_project and user_id = v_joiner));

  perform pg_temp.act_as(v_joiner);
  perform pg_temp.must_be('a wrong code is still a miss, not a refusal',
    public.join_general_project('ZZZZZZZZ') is null);
  perform pg_temp.act_as_service();
end $$;

-- ================================================================== task 2
-- Role management, hand over, PM recovery and the role activity log, on a
-- project of their own (R) so the blocks above stay as they are.

do $$
declare
  v_mem2     uuid := gen_random_uuid();  -- member
  v_out      uuid := gen_random_uuid();  -- Project manager on, on no project
  v_sowner   uuid := gen_random_uuid();  -- co-owner of R's space, not on R
  v_smember  uuid := gen_random_uuid();  -- plain member of R's space, not on R
  v_admin    uuid := gen_random_uuid();
  v_inv1     uuid := gen_random_uuid();
  v_inv2     uuid := gen_random_uuid();
  v_inv3     uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();  -- on nothing at all
  v_pm       uuid := (select v from fx where k = 'pm');
  v_r        uuid;
  v_space    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_mem2,     'zz-pr-mem2@example.test'),
      (v_out,      'zz-pr-out@example.test'),
      (v_sowner,   'zz-pr-sowner@example.test'),
      (v_smember,  'zz-pr-smember@example.test'),
      (v_admin,    'zz-pr-admin@example.test'),
      (v_inv1,     'zz-pr-inv1@example.test'),
      (v_inv2,     'zz-pr-inv2@example.test'),
      (v_inv3,     'zz-pr-inv3@example.test'),
      (v_stranger, 'zz-pr-stranger@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_mem2,     'zz-pr-mem2@example.test',     'Zz', 'Prmemtwo',   'member', 'active', false, false),
    (v_out,      'zz-pr-out@example.test',      'Zz', 'Prout',      'member', 'active', false, true),
    (v_sowner,   'zz-pr-sowner@example.test',   'Zz', 'Prsowner',   'member', 'active', false, true),
    (v_smember,  'zz-pr-smember@example.test',  'Zz', 'Prsmember',  'member', 'active', false, false),
    (v_admin,    'zz-pr-admin@example.test',    'Zz', 'Pradmin',    'admin',  'active', false, false),
    (v_inv1,     'zz-pr-inv1@example.test',     'Zz', 'Prinvone',   'member', 'active', false, false),
    (v_inv2,     'zz-pr-inv2@example.test',     'Zz', 'Prinvtwo',   'member', 'active', false, false),
    (v_inv3,     'zz-pr-inv3@example.test',     'Zz', 'Prinvthree', 'member', 'active', false, false),
    (v_stranger, 'zz-pr-stranger@example.test', 'Zz', 'Prstranger', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_r := (public.create_general_project('Zz PR roles', '')).id;
  perform pg_temp.act_as_service();
  v_space := (select space_id from public.general_projects where id = v_r);

  insert into public.general_space_members (space_id, user_id, level)
  values (v_space, v_sowner, 'owner'), (v_space, v_smember, 'member')
  on conflict (space_id, user_id) do update set level = excluded.level;

  -- R: pm (pm), coord (coordinator), plain, granted, mem2, pm2 (members).
  insert into public.general_members (project_id, user_id, role) values
    (v_r, (select v from fx where k = 'coord'), 'coordinator'),
    (v_r, (select v from fx where k = 'plain'), 'member'),
    (v_r, (select v from fx where k = 'granted'), 'member'),
    (v_r, v_mem2, 'member'),
    (v_r, (select v from fx where k = 'pm2'), 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (v_r, (select v from fx where k = 'granted'), 'edit_files', v_pm);
  insert into public.general_access_requests (project_id, user_id, permission, note)
  values (v_r, (select v from fx where k = 'granted'), 'manage_tasks', 'Zz');

  insert into fx values
    ('r', v_r), ('space', v_space), ('mem2', v_mem2), ('out', v_out), ('sowner', v_sowner),
    ('smember', v_smember), ('admin', v_admin), ('inv1', v_inv1), ('inv2', v_inv2),
    ('inv3', v_inv3), ('stranger', v_stranger);
  raise notice 'task 2 fixture ready';
end $$;

-- How many events of a kind R has about a person.
create or replace function pg_temp.events(p_kind text, p_subject uuid) returns int
language sql as $$
  select count(*)::int from public.general_project_events
   where project_id = (select v from fx where k = 'r') and kind = p_kind
     and subject_id = p_subject;
$$;

-- ------------------------------------------------------------------ set role

do $$
declare
  v_r       uuid := (select v from fx where k = 'r');
  v_pm      uuid := (select v from fx where k = 'pm');
  v_coord   uuid := (select v from fx where k = 'coord');
  v_plain   uuid := (select v from fx where k = 'plain');
  v_granted uuid := (select v from fx where k = 'granted');
  v_mem2    uuid := (select v from fx where k = 'mem2');
  v_stranger uuid := (select v from fx where k = 'stranger');
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm makes a member a coordinator',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_r, v_plain));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...who is now a coordinator at level manager',
    (select role = 'coordinator' and level = 'manager' from public.general_members
      where project_id = v_r and user_id = v_plain));
  perform pg_temp.must_be('...and a member_role event says from member to coordinator',
    exists (select 1 from public.general_project_events
             where project_id = v_r and kind = 'member_role' and subject_id = v_plain
               and actor_id = v_pm
               and detail = jsonb_build_object('from', 'member', 'to', 'coordinator')));
  perform pg_temp.must_be('...and no member_level event for a work project',
    pg_temp.events('member_level', v_plain) = 0);
  perform pg_temp.must_be('...and they are told "You are now a coordinator"',
    exists (select 1 from public.notifications
             where user_id = v_plain and type = 'membership_changed'
               and general_project_id = v_r and preview = 'You are now a coordinator'));

  -- Moving away from member drops grants and open requests.
  perform pg_temp.act_as(v_pm);
  perform public.set_general_member_role(v_r, v_granted, 'coordinator');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a member made coordinator loses their grants',
    not exists (select 1 from public.general_grants where project_id = v_r and user_id = v_granted));
  perform pg_temp.must_be('...and their open requests are withdrawn',
    not exists (select 1 from public.general_access_requests
                 where project_id = v_r and user_id = v_granted and status = 'open'));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm demotes a coordinator to member',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_granted));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...who is told "You are now a member"',
    exists (select 1 from public.notifications
             where user_id = v_granted and type = 'membership_changed'
               and general_project_id = v_r and preview = 'You are now a member'));

  -- Coordinators.
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot make a member a coordinator',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_r, v_mem2),
    'Only the project manager can make someone a coordinator');
  perform pg_temp.must_refuse_with('a coordinator cannot demote a coordinator',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_plain),
    'Only the project manager can change a coordinator');
  perform pg_temp.must_refuse_with('...nor change their own role',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_coord),
    'Only the project manager can change a coordinator');
  perform pg_temp.must_refuse_with('...nor the pm''s',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_pm),
    'Only the project manager can change a coordinator');

  -- A role-only change (same level) is still a change: the event and the
  -- notification key on the role. qa is written directly; the RPCs refuse it.
  perform pg_temp.act_as_service();
  update public.general_members set role = 'qa' where project_id = v_r and user_id = v_mem2;
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_allow('a coordinator moves a qa back to member',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_mem2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...a member_role event from qa to member, though level stayed member',
    exists (select 1 from public.general_project_events
             where project_id = v_r and kind = 'member_role' and subject_id = v_mem2
               and actor_id = v_coord
               and detail = jsonb_build_object('from', 'qa', 'to', 'member')));
  perform pg_temp.must_be('...and the notification goes out',
    exists (select 1 from public.notifications
             where user_id = v_mem2 and type = 'membership_changed'
               and general_project_id = v_r and preview = 'You are now a member'));

  -- pm, qa and stakeholder.
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm cannot set someone to pm',
    format($q$select public.set_general_member_role(%L, %L, 'pm')$q$, v_r, v_mem2),
    'Use hand over to change the project manager.');
  perform pg_temp.must_refuse_with('...nor step down by setting their own role',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_r, v_pm),
    'Use hand over to change the project manager.');
  perform pg_temp.must_refuse_with('the pm cannot set qa',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_r, v_mem2),
    'QA and stakeholder roles are not available yet.');
  perform pg_temp.must_refuse_with('...nor stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_r, v_mem2),
    'QA and stakeholder roles are not available yet.');
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot set qa',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_r, v_mem2),
    'QA and stakeholder roles are not available yet.');
  perform pg_temp.act_as(v_stranger);
  perform pg_temp.must_refuse_with('nor can somebody off the project',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_r, v_mem2),
    'QA and stakeholder roles are not available yet.');

  -- Who may set roles at all.
  perform pg_temp.must_refuse_with('somebody off the project cannot set roles',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_r, v_mem2),
    'Only the project manager or a coordinator');
  perform pg_temp.act_as(v_mem2);
  perform pg_temp.must_refuse_with('a member cannot set roles',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_r, v_granted),
    'Only the project manager or a coordinator');

  -- Archived projects.
  perform pg_temp.act_as(v_pm);
  perform public.archive_general_project(v_r, true);
  perform pg_temp.must_refuse_with('roles do not change on an archived project',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_r, v_mem2),
    'archived');
  perform public.archive_general_project(v_r, false);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ old level RPC

do $$
declare
  v_r    uuid := (select v from fx where k = 'r');
  v_pm   uuid := (select v from fx where k = 'pm');
  v_pm2  uuid := (select v from fx where k = 'pm2');
  v_mem2 uuid := (select v from fx where k = 'mem2');
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('set_general_member_level manager still works',
    format($q$select public.set_general_member_level(%L, %L, 'manager')$q$, v_r, v_mem2));
  perform pg_temp.must_be('...as coordinator', public.general_role_of(v_r, v_mem2) = 'coordinator');
  perform public.set_general_member_level(v_r, v_mem2, 'member');
  perform pg_temp.must_be('...and member as member', public.general_role_of(v_r, v_mem2) = 'member');

  perform pg_temp.must_refuse_with('set_general_member_level owner is refused, not a quiet hand over',
    format($q$select public.set_general_member_level(%L, %L, 'owner')$q$, v_r, v_pm2),
    'Use hand over to change the project manager.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and nothing moved', public.general_role_of(v_r, v_pm) = 'pm'
    and public.general_role_of(v_r, v_pm2) = 'member');
end $$;

-- ------------------------------------------------------------------ inviting

do $$
declare
  v_r        uuid := (select v from fx where k = 'r');
  v_pm       uuid := (select v from fx where k = 'pm');
  v_coord    uuid := (select v from fx where k = 'coord');
  v_inv1     uuid := (select v from fx where k = 'inv1');
  v_inv2     uuid := (select v from fx where k = 'inv2');
  v_inv3     uuid := (select v from fx where k = 'inv3');
  v_mem2     uuid := (select v from fx where k = 'mem2');
  v_student2 uuid := (select v from fx where k = 'student2');
  inv public.general_invitations%rowtype;
  v_code text;
begin
  perform pg_temp.act_as(v_pm);
  inv := public.invite_to_general_project(v_r, v_inv1, 'coordinator');
  perform pg_temp.must_be('the pm invites as coordinator; the invitation holds the role',
    inv.role = 'coordinator');
  perform pg_temp.act_as(v_inv1);
  perform public.respond_general_invitation(inv.id, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the invitee joins as coordinator',
    (select role = 'coordinator' and level = 'manager' from public.general_members
      where project_id = v_r and user_id = v_inv1));

  perform pg_temp.act_as(v_pm);
  inv := public.invite_to_general_project(v_r, v_student2, 'coordinator');
  perform pg_temp.act_as(v_student2);
  perform pg_temp.must_allow('a student invited as coordinator accepts',
    format('select public.respond_general_invitation(%L, true)', inv.id));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and is a coordinator',
    public.general_role_of(v_r, v_student2) = 'coordinator');

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot invite a coordinator',
    format($q$select public.invite_to_general_project(%L, %L, 'coordinator')$q$, v_r, v_inv2),
    'Only the project manager can invite a coordinator');
  perform pg_temp.must_allow('a coordinator invites as member',
    format($q$select public.invite_to_general_project(%L, %L, 'member')$q$, v_r, v_inv2));
  perform pg_temp.must_allow('...and the old two-argument call still works',
    format('select public.invite_to_general_project(%L, %L)', v_r, v_inv3));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...both stored as member',
    (select count(*) = 2 from public.general_invitations
      where project_id = v_r and invitee in (v_inv2, v_inv3) and status = 'pending'
        and role = 'member'));

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('nobody is invited as pm',
    format($q$select public.invite_to_general_project(%L, %L, 'pm')$q$, v_r, v_inv3),
    'Use hand over to change the project manager.');
  perform pg_temp.must_refuse_with('...nor as qa',
    format($q$select public.invite_to_general_project(%L, %L, 'qa')$q$, v_r, v_inv3),
    'QA and stakeholder roles are not available yet.');
  perform pg_temp.must_refuse_with('inviting someone already on the project is refused',
    format($q$select public.invite_to_general_project(%L, %L, 'member')$q$, v_r, v_mem2),
    'already on this project');
  inv := public.invite_to_general_project(v_r, v_inv3, 'coordinator');
  perform pg_temp.must_be('the pm re-inviting as coordinator updates the pending invitation',
    inv.role = 'coordinator'
    and (select count(*) = 1 from public.general_invitations
          where project_id = v_r and invitee = v_inv3 and status = 'pending'));

  -- The join code honours a pending invitation's role.
  v_code := public.set_general_join_code(v_r, true);
  perform pg_temp.act_as(v_inv3);
  perform pg_temp.must_be('someone invited as coordinator who uses the join code instead',
    public.join_general_project(v_code) = v_r);
  perform pg_temp.act_as(v_inv2);
  perform pg_temp.must_be('...and someone invited as member who does the same',
    public.join_general_project(v_code) = v_r);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...joins as coordinator, the invitation''s role',
    (select role = 'coordinator' from public.general_members
      where project_id = v_r and user_id = v_inv3));
  perform pg_temp.must_be('...while the member invitee joins as member',
    (select role = 'member' from public.general_members
      where project_id = v_r and user_id = v_inv2));
  perform pg_temp.must_be('...and both invitations are accepted',
    not exists (select 1 from public.general_invitations
                 where project_id = v_r and invitee in (v_inv2, v_inv3) and status = 'pending'));
  perform pg_temp.act_as(v_pm);
  perform public.set_general_join_code(v_r, false);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ removing, leaving

do $$
declare
  v_r        uuid := (select v from fx where k = 'r');
  v_pm       uuid := (select v from fx where k = 'pm');
  v_coord    uuid := (select v from fx where k = 'coord');
  v_plain    uuid := (select v from fx where k = 'plain');
  v_inv1     uuid := (select v from fx where k = 'inv1');
  v_student2 uuid := (select v from fx where k = 'student2');
  v_granted  uuid := (select v from fx where k = 'granted');
begin
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot remove the pm',
    format('select public.remove_general_member(%L, %L)', v_r, v_pm),
    'Hand over the project before removing its project manager.');
  perform pg_temp.must_refuse_with('a coordinator cannot remove a coordinator',
    format('select public.remove_general_member(%L, %L)', v_r, v_plain),
    'Only the project manager removes a coordinator');
  perform pg_temp.must_allow('a coordinator removes a member',
    format('select public.remove_general_member(%L, %L)', v_r, v_granted));

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm removes a coordinator',
    format('select public.remove_general_member(%L, %L)', v_r, v_student2));
  perform pg_temp.must_refuse_with('the pm cannot leave',
    format('select public.leave_general_project(%L)', v_r),
    'Hand over the project before you leave.');

  perform pg_temp.act_as(v_inv1);
  perform pg_temp.must_allow('a coordinator leaves',
    format('select public.leave_general_project(%L)', v_r));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the pm is still there',
    public.general_role_of(v_r, v_pm) = 'pm');
end $$;

-- ------------------------------------------------------------------ hand over

do $$
declare
  v_r     uuid := (select v from fx where k = 'r');
  v_pm    uuid := (select v from fx where k = 'pm');
  v_pm2   uuid := (select v from fx where k = 'pm2');
  v_coord uuid := (select v from fx where k = 'coord');
  v_mem2  uuid := (select v from fx where k = 'mem2');
  v_out   uuid := (select v from fx where k = 'out');
  n_roles int;
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('hand over to a member without Project manager is refused',
    format('select public.hand_over_general_project(%L, %L)', v_r, v_mem2),
    'Only someone with Project manager turned on can run a project.');
  perform pg_temp.must_refuse_with('...and to somebody not on the project',
    format('select public.hand_over_general_project(%L, %L)', v_r, v_out),
    'They are not on this project');

  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot hand over',
    format('select public.hand_over_general_project(%L, %L)', v_r, v_pm2),
    'Only the project manager can hand over');

  perform pg_temp.act_as_service();
  n_roles := (select count(*) from public.general_project_events
               where project_id = v_r and kind = 'member_role');
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm hands over to a member with Project manager on',
    format('select public.hand_over_general_project(%L, %L)', v_r, v_pm2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...exactly one pm afterwards, and it is them',
    (select count(*) = 1 from public.general_members where project_id = v_r and role = 'pm')
    and public.general_role_of(v_r, v_pm2) = 'pm');
  perform pg_temp.must_be('...the old pm is a coordinator',
    public.general_role_of(v_r, v_pm) = 'coordinator');
  perform pg_temp.must_be('...one pm_handover event, from the old pm to the new',
    (select count(*) = 1 from public.general_project_events
      where project_id = v_r and kind = 'pm_handover' and actor_id = v_pm
        and subject_id = v_pm2
        and detail = jsonb_build_object('from_user', v_pm, 'to_user', v_pm2)));
  perform pg_temp.must_be('...and not two member_role events besides',
    (select count(*) from public.general_project_events
      where project_id = v_r and kind = 'member_role') = n_roles);
  perform pg_temp.must_be('...the new pm is told "You are now the project manager"',
    exists (select 1 from public.notifications
             where user_id = v_pm2 and type = 'membership_changed'
               and general_project_id = v_r and preview = 'You are now the project manager'));

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the old pm can no longer hand over',
    format('select public.hand_over_general_project(%L, %L)', v_r, v_pm),
    'Only the project manager can hand over');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ PM recovery

do $$
declare
  v_r        uuid := (select v from fx where k = 'r');
  v_pm       uuid := (select v from fx where k = 'pm');
  v_pm2      uuid := (select v from fx where k = 'pm2');   -- R's pm now
  v_plain    uuid := (select v from fx where k = 'plain');
  v_out      uuid := (select v from fx where k = 'out');
  v_sowner   uuid := (select v from fx where k = 'sowner');
  v_smember  uuid := (select v from fx where k = 'smember');
  v_admin    uuid := (select v from fx where k = 'admin');
  v_stranger uuid := (select v from fx where k = 'stranger');
begin
  -- has_pm answers only somebody who can read the project.
  perform pg_temp.act_as(v_stranger);
  perform pg_temp.must_be('general_project_has_pm tells somebody who cannot read R nothing',
    public.general_project_has_pm(v_r) is false);
  perform pg_temp.act_as(v_sowner);
  perform pg_temp.must_be('...but a space owner sees that R has a pm',
    public.general_project_has_pm(v_r));
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_be('...and so does an admin', public.general_project_has_pm(v_r));

  perform pg_temp.act_as(v_sowner);
  perform pg_temp.must_refuse_with('assigning a pm while one is active is refused',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_out),
    'This project already has a project manager.');

  -- Archived, R is hidden from a space owner who is not a lead, so the gated
  -- has_pm reads false for them. Assign must not take that as "no pm".
  perform pg_temp.act_as(v_pm2);
  perform public.archive_general_project(v_r, true);
  perform pg_temp.act_as(v_sowner);
  perform pg_temp.must_be('archived, the gated has_pm tells a non-lead space owner nothing',
    public.general_project_has_pm(v_r) is false);
  perform pg_temp.must_refuse_with('...but assigning over the active pm is still refused',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_out),
    'This project already has a project manager.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the pm is untouched',
    (select role = 'pm' from public.general_members where project_id = v_r and user_id = v_pm2));
  perform pg_temp.act_as(v_pm2);
  perform public.archive_general_project(v_r, false);
  perform pg_temp.act_as(v_sowner);

  -- The pm is deactivated.
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = v_pm2;
  perform pg_temp.act_as(v_sowner);
  perform pg_temp.must_be('a deactivated pm leaves R with no pm',
    not public.general_project_has_pm(v_r));

  perform pg_temp.act_as(v_smember);
  perform pg_temp.must_refuse_with('a plain space member cannot assign a pm',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_out),
    'Only an owner of this project''s space or an admin');
  perform pg_temp.act_as(v_stranger);
  perform pg_temp.must_refuse_with('...nor can a stranger',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_out),
    'Only an owner of this project''s space or an admin');

  perform pg_temp.act_as(v_sowner);
  perform pg_temp.must_refuse_with('the space owner cannot assign someone without Project manager',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_plain),
    'Only someone with Project manager turned on can run a project.');
  perform pg_temp.must_allow('the space owner assigns a PM-enabled outsider',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_out));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the outsider is on R as pm',
    (select role = 'pm' and level = 'owner' from public.general_members
      where project_id = v_r and user_id = v_out));
  perform pg_temp.must_be('...the deactivated pm is now a coordinator',
    (select role = 'coordinator' from public.general_members
      where project_id = v_r and user_id = v_pm2));
  perform pg_temp.must_be('...with exactly one pm',
    (select count(*) = 1 from public.general_members where project_id = v_r and role = 'pm'));
  perform pg_temp.must_be('...and the space owner is still not on R',
    not exists (select 1 from public.general_members where project_id = v_r and user_id = v_sowner));

  -- An admin recovers too: the outsider loses the switch.
  update public.profiles set can_manage_projects = false where id = v_out;
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse_with('an admin assigning on a project that does not exist is told so',
    format('select public.assign_general_project_pm(%L, %L)', gen_random_uuid(), v_pm),
    'That project was not found. Check the link');
  perform pg_temp.must_allow('an admin assigns a pm',
    format('select public.assign_general_project_pm(%L, %L)', v_r, v_pm));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...the old pm is pm again and the outsider a coordinator',
    public.general_role_of(v_r, v_pm) = 'pm' and public.general_role_of(v_r, v_out) = 'coordinator'
    and (select count(*) = 1 from public.general_members where project_id = v_r and role = 'pm'));
end $$;

rollback;
