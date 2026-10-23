-- Company roles, phase 1: the account model — rolled back, touches nothing
-- permanently.
--
--   node scripts/db.mjs supabase/tests/company-accounts.test.sql
--
-- Faculty is gone. A Member is a plain account, and the admin hands out two
-- switches: Can teach and Project manager. Every refusal here is paired with a
-- case that is allowed, so a refusal never passes for the wrong reason.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_admin     uuid;
  v_fac_sign  uuid := gen_random_uuid();  -- signs up sending the old 'faculty'
  v_prof_sign uuid := gen_random_uuid();  -- signs up sending 'professor'
  v_student   uuid := gen_random_uuid();
  v_bare      uuid := gen_random_uuid();  -- Google, no profile yet
  v_plain     uuid := gen_random_uuid();  -- member, no switches
  v_coteach   uuid := gen_random_uuid();  -- member, teaches, Manager seat in a class
  v_seatonly  uuid := gen_random_uuid();  -- member, does not teach, same seat
  v_teachfree uuid := gen_random_uuid();  -- member, teaches, no seats
  v_opener    uuid := gen_random_uuid();  -- member, teaches, opens a class
  v_runner    uuid := gen_random_uuid();  -- member, project manager, owns a work project
  v_class     uuid;
  v_cspace    uuid;
  v_wspace    uuid;
  v_project   uuid;
begin
  select id into v_admin from public.profiles
   where role = 'admin' and status = 'active' order by created_at limit 1;
  if v_admin is null then
    raise exception 'This suite needs an active admin account in the database';
  end if;

  select c.id, c.space_id into v_class, v_cspace
    from public.classes c where c.archived_at is null order by c.created_at limit 1;
  if v_class is null then
    raise exception 'This suite needs an active class in the database';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', v.meta, now(), now()
    from (values
      (v_fac_sign,  'zz-ca-fac@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Facsign', 'role', 'faculty')),
      (v_prof_sign, 'zz-ca-prof@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Profsign', 'role', 'professor')),
      (v_student,   'zz-ca-student@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Castudent', 'role', 'student')),
      (v_bare,      'zz-ca-bare@example.test', '{}'::jsonb),
      (v_plain,     'zz-ca-plain@example.test', '{}'::jsonb),
      (v_coteach,   'zz-ca-coteach@example.test', '{}'::jsonb),
      (v_seatonly,  'zz-ca-seatonly@example.test', '{}'::jsonb),
      (v_teachfree, 'zz-ca-teachfree@example.test', '{}'::jsonb),
      (v_opener,    'zz-ca-opener@example.test', '{}'::jsonb),
      (v_runner,    'zz-ca-runner@example.test', '{}'::jsonb)
    ) as v(id, em, meta);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_plain,     'zz-ca-plain@example.test',     'Zz', 'Caplain',     'member', 'active', false, false),
    (v_coteach,   'zz-ca-coteach@example.test',   'Zz', 'Cacoteach',   'member', 'active', true,  false),
    (v_seatonly,  'zz-ca-seatonly@example.test',  'Zz', 'Caseatonly',  'member', 'active', false, false),
    (v_teachfree, 'zz-ca-teachfree@example.test', 'Zz', 'Cateachfree', 'member', 'active', true,  false),
    (v_opener,    'zz-ca-opener@example.test',    'Zz', 'Caopener',    'member', 'active', true,  false),
    (v_runner,    'zz-ca-runner@example.test',    'Zz', 'Carunner',    'member', 'active', false, true);

  -- Two seats in a live class space, one held by someone who teaches.
  insert into public.general_space_members (space_id, user_id, level) values
    (v_cspace, v_coteach, 'manager'),
    (v_cspace, v_seatonly, 'manager');

  -- A live work project the runner owns.
  insert into public.general_spaces (name, created_by) values ('Zz CA work', v_runner)
  returning id into v_wspace;
  insert into public.general_space_members (space_id, user_id, level)
  values (v_wspace, v_runner, 'owner') on conflict do nothing;
  insert into public.general_projects (name, created_by, space_id)
  values ('Zz CA project', v_runner, v_wspace) returning id into v_project;
  insert into public.general_members (project_id, user_id, level)
  values (v_project, v_runner, 'owner')
  on conflict (project_id, user_id) do update set level = 'owner';

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('admin', v_admin), ('fac_sign', v_fac_sign), ('prof_sign', v_prof_sign),
    ('student', v_student), ('bare', v_bare), ('plain', v_plain), ('coteach', v_coteach),
    ('seatonly', v_seatonly), ('teachfree', v_teachfree), ('opener', v_opener),
    ('runner', v_runner), ('class', v_class), ('cspace', v_cspace), ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ sign-up

do $$
declare
  v_fac  uuid := (select v from fx where k = 'fac_sign');
  v_prof uuid := (select v from fx where k = 'prof_sign');
begin
  perform pg_temp.must_be('a signup sending ''faculty'' gets an active member with no switches',
    (select role = 'member' and status = 'active' and not can_teach and not can_manage_projects
       from public.profiles where id = v_fac));
  perform pg_temp.must_be('a signup sending ''professor'' gets the same',
    (select role = 'member' and status = 'active' and not can_teach and not can_manage_projects
       from public.profiles where id = v_prof));
end $$;

-- ------------------------------------------------------------------ onboarding

do $$
declare
  v_bare uuid := (select v from fx where k = 'bare');
begin
  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_refuse('onboarding cannot pick faculty', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role)
       values (%L, 'zz-ca-bare@example.test', 'Zz', 'Cabare', 'faculty')$q$, v_bare));
  perform pg_temp.must_allow('onboarding as a member is allowed', format(
    $q$insert into public.profiles
         (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
       values (%L, 'zz-ca-bare@example.test', 'Zz', 'Cabare', 'member', 'pending', true, true)$q$,
    v_bare));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and lands active, with both switches off',
    (select role = 'member' and status = 'active' and not can_teach and not can_manage_projects
       from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------- nobody but the admin

do $$
declare
  v_plain uuid := (select v from fx where k = 'plain');
begin
  perform pg_temp.act_as(v_plain);
  update public.profiles set can_manage_projects = true where id = v_plain;
  update public.profiles set role = 'admin' where id = v_plain;
  update public.profiles set first_name = 'Zzz' where id = v_plain;
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('a member cannot make themselves a project manager',
    (select not can_manage_projects from public.profiles where id = v_plain));
  perform pg_temp.must_be('...nor an admin',
    (select role = 'member' from public.profiles where id = v_plain));
  perform pg_temp.must_be('...while their own name still saves',
    (select first_name = 'Zzz' from public.profiles where id = v_plain));
end $$;

-- ------------------------------------------------------------ creating work

do $$
declare
  v_admin uuid := (select v from fx where k = 'admin');
  v_plain uuid := (select v from fx where k = 'plain');
begin
  perform pg_temp.act_as(v_plain);
  perform pg_temp.must_be('a member with no switches is not a project manager',
    not public.is_project_manager(v_plain));
  perform pg_temp.must_refuse_with('a member with no switches cannot make a work space',
    $q$select public.create_general_space('Zz CA refused', '')$q$, 'Only project managers');

  perform pg_temp.act_as(v_plain);
  perform pg_temp.must_refuse('a member cannot switch Project manager on',
    format('select public.set_project_manager(%L, true)', v_plain));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin turns Project manager on',
    format('select public.set_project_manager(%L, true)', v_plain));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...it reads back on',
    (select can_manage_projects from public.profiles where id = v_plain));
  perform pg_temp.must_be('...and the change is in the audit log',
    exists (select 1 from public.audit_events
             where subject_id = v_plain and after_value = 'project manager'
               and before_value = 'not project manager'));

  perform pg_temp.act_as(v_plain);
  perform pg_temp.must_be('now they are a project manager', public.is_project_manager(v_plain));
  perform pg_temp.must_allow('...and the same work space goes through',
    $q$select public.create_general_space('Zz CA allowed', '')$q$);

  perform pg_temp.must_refuse_with('a project manager who does not teach cannot make a class space',
    $q$insert into public.general_spaces (name, created_by, kind)
       values ('Zz CA class space', auth.uid(), 'education')$q$,
    'Only teachers can create class spaces');
  perform pg_temp.act_as_service();
end $$;

do $$
declare
  v_opener uuid := (select v from fx where k = 'opener');
begin
  perform pg_temp.act_as(v_opener);
  perform pg_temp.must_allow('a member who teaches opens a class, and its class space with it',
    format($q$insert into public.classes
                (professor_id, name, initial, code, section, year_level, semester, school_year)
              values (%L, 'Zz CA class', 'ZZCA', 'ZZCA-OPEN', 'BSIT 9Z', '1st', '1st', '2099-2100')$q$,
           v_opener));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the class space exists',
    exists (select 1 from public.classes c join public.general_spaces s on s.id = c.space_id
             where c.professor_id = v_opener and s.kind = 'education'));
end $$;

-- ------------------------------------------------------------------ teaching

do $$
declare
  v_coteach  uuid := (select v from fx where k = 'coteach');
  v_seatonly uuid := (select v from fx where k = 'seatonly');
  v_plain    uuid := (select v from fx where k = 'plain');
  v_student  uuid := (select v from fx where k = 'student');
  v_cspace   uuid := (select v from fx where k = 'cspace');
  v_class    uuid := (select v from fx where k = 'class');
begin
  perform pg_temp.act_as(v_coteach);
  perform pg_temp.must_be('a member who teaches, seated in a class, teaches in its space',
    public.teaches_in_space(v_cspace));
  perform pg_temp.act_as(v_seatonly);
  perform pg_temp.must_be('the same seat without Can teach does not',
    not public.teaches_in_space(v_cspace));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('class_teacher_ids counts the one who teaches',
    v_coteach in (select public.class_teacher_ids(v_class)));
  perform pg_temp.must_be('...and not the one who does not',
    v_seatonly not in (select public.class_teacher_ids(v_class)));

  perform pg_temp.act_as(v_plain);  -- a project manager by now
  perform pg_temp.must_be('the co-teacher picker lists a member who teaches',
    exists (select 1 from public.search_faculty('Cacoteach') where person_id = v_coteach));
  perform pg_temp.must_be('...and not a member who does not',
    not exists (select 1 from public.search_faculty('Caseatonly')));

  perform pg_temp.act_as(v_seatonly);
  perform pg_temp.must_refuse('a member with no switches cannot use the picker',
    $q$select * from public.search_faculty('Cacoteach')$q$);
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('...nor a student',
    $q$select * from public.search_faculty('Cacoteach')$q$);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------- Project manager

do $$
declare
  v_admin     uuid := (select v from fx where k = 'admin');
  v_student   uuid := (select v from fx where k = 'student');
  v_teachfree uuid := (select v from fx where k = 'teachfree');
  v_runner    uuid := (select v from fx where k = 'runner');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse_with('a student cannot be a project manager',
    format('select public.set_project_manager(%L, true)', v_student),
    'Students cannot be project managers');
  perform pg_temp.must_allow('a member can',
    format('select public.set_project_manager(%L, true)', v_teachfree));

  perform pg_temp.must_be('the runner''s live project is counted',
    (select managed_project_count = 1 from public.account_overview where id = v_runner));
  perform pg_temp.must_refuse_with('Project manager stays on while they run a project',
    format('select public.set_project_manager(%L, false)', v_runner),
    'They still run a project');
  perform pg_temp.must_refuse_with('...and they cannot be made a student either',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_runner),
    'Hand over their classes and projects first');
  perform pg_temp.must_allow('an admin can be a project manager too',
    format('select public.set_project_manager(%L, true)', v_admin));
  perform pg_temp.must_be('...and then is one', public.is_project_manager(v_admin));

  -- The count is security definer, so it must not answer just anybody.
  perform pg_temp.act_as(v_runner);
  perform pg_temp.must_be('a member reads their own project count',
    public.managed_project_count(v_runner) = 1);
  perform pg_temp.act_as(v_teachfree);
  perform pg_temp.must_be('...but not somebody else''s',
    public.managed_project_count(v_runner) = 0);
  perform pg_temp.act_as_service();

  delete from public.general_projects where id = (select v from fx where k = 'project');

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('with no project left, it comes off',
    format('select public.set_project_manager(%L, false)', v_runner));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and reads back off',
    (select not can_manage_projects from public.profiles where id = v_runner));
end $$;

-- ------------------------------------------------------------------ Can teach

do $$
declare
  v_admin     uuid := (select v from fx where k = 'admin');
  v_coteach   uuid := (select v from fx where k = 'coteach');
  v_teachfree uuid := (select v from fx where k = 'teachfree');
  v_student   uuid := (select v from fx where k = 'student');
  v_seatonly  uuid := (select v from fx where k = 'seatonly');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse_with('Can teach stays on while they co-teach a class',
    format('select public.set_faculty_teaching(%L, false)', v_coteach),
    'They still teach a class');
  perform pg_temp.must_refuse_with('...and they cannot be made a student either',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_coteach),
    'Hand over their classes and projects first');
  perform pg_temp.must_allow('one who teaches nothing can have it turned off',
    format('select public.set_faculty_teaching(%L, false)', v_teachfree));
  perform pg_temp.must_refuse_with('a student cannot teach',
    format('select public.set_faculty_teaching(%L, true)', v_student),
    'Only members can teach');
  perform pg_temp.must_allow('a member can be given Can teach',
    format('select public.set_faculty_teaching(%L, true)', v_seatonly));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the two switches read back',
    (select not can_teach from public.profiles where id = v_teachfree)
    and (select can_teach from public.profiles where id = v_seatonly));
end $$;

-- ------------------------------------------------------------------ account type

do $$
declare
  v_admin     uuid := (select v from fx where k = 'admin');
  v_student   uuid := (select v from fx where k = 'student');
  v_teachfree uuid := (select v from fx where k = 'teachfree');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse('nobody is made faculty any more',
    format('select public.set_account_role(%L, ''faculty''::public.user_role)', v_student));
  perform pg_temp.must_allow('a student is made a member',
    format('select public.set_account_role(%L, ''member''::public.user_role)', v_student));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and stays active, with no switches',
    (select role = 'member' and status = 'active' and not can_teach and not can_manage_projects
       from public.profiles where id = v_student));

  -- teachfree holds Project manager (above) and nothing to hand over.
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('a member holding nothing is made a student',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_teachfree));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and both switches are cleared',
    (select role = 'student' and not can_teach and not can_manage_projects
       from public.profiles where id = v_teachfree));
end $$;

do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-ca-nofac@example.test', '', now(), now());
  perform pg_temp.must_refuse_with('not even the database console can write a faculty row',
    format($q$insert into public.profiles (id, email, first_name, last_name, role, status)
              values (%L, 'zz-ca-nofac@example.test', 'Zz', 'Canofac', 'faculty', 'active')$q$, v_id),
    'profiles_no_faculty');
  perform pg_temp.must_allow('...while a member row goes in',
    format($q$insert into public.profiles (id, email, first_name, last_name, role, status)
              values (%L, 'zz-ca-nofac@example.test', 'Zz', 'Canofac', 'member', 'active')$q$, v_id));
end $$;

-- ------------------------------------------------------------------ views

do $$
declare
  v_admin    uuid := (select v from fx where k = 'admin');
  v_coteach  uuid := (select v from fx where k = 'coteach');
  v_plain    uuid := (select v from fx where k = 'plain');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_be('the account list carries both switches',
    (select can_teach and not can_manage_projects from public.account_overview where id = v_coteach)
    and (select can_manage_projects from public.account_overview where id = v_plain));
  perform pg_temp.must_be('the teachers list has a member who teaches',
    exists (select 1 from public.professor_accounts where id = v_coteach));
  perform pg_temp.must_be('...and not one who does not',
    not exists (select 1 from public.professor_accounts where id = v_plain));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ retired

do $$
begin
  perform pg_temp.must_be('no faculty account is left',
    not exists (select 1 from public.profiles where role = 'faculty'));
  perform pg_temp.must_be('is_faculty is gone',
    to_regprocedure('public.is_faculty(uuid)') is null);
  perform pg_temp.must_be('decide_faculty is gone',
    to_regprocedure('public.decide_faculty(uuid, boolean, boolean)') is null);
  perform pg_temp.must_be('...and is_project_manager is here',
    to_regprocedure('public.is_project_manager(uuid)') is not null);
end $$;

rollback;
