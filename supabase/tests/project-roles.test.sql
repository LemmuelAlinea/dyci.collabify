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
  perform pg_temp.must_be('every work project has exactly one project manager',
    not exists (
      select 1 from public.general_projects p
       where p.class_board_id is null
         and (select count(*) from public.general_members m
               where m.project_id = p.id and m.role = 'pm') <> 1));
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

rollback;
