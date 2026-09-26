-- Admission-gated access — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/access.test.sql
--
-- Nobody does anything until somebody admits them: the admin admits faculty
-- and says whether they teach, faculty admit students with a class code.
-- Every refusal is paired with somebody who is allowed the same thing.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 56);
      return;
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

create or replace function pg_temp.must_be(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_student  uuid := gen_random_uuid();
  v_student2 uuid := gen_random_uuid();
  v_student3 uuid := gen_random_uuid();  -- joins a class, and nothing else
  v_teacher  uuid := gen_random_uuid();  -- approved, teaches
  v_staff    uuid := gen_random_uuid();  -- approved, does not teach
  v_pending  uuid := gen_random_uuid();  -- faculty waiting on the admin
  v_legacy   uuid := gen_random_uuid();  -- an old client still sending workplace = general
  v_bare     uuid := gen_random_uuid();  -- Google, no profile yet
  v_bare2    uuid := gen_random_uuid();
  v_admin    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', v.meta, now(), now()
    from (values
      (v_student,  'zz-acc-student@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Student', 'role', 'student')),
      (v_student2, 'zz-acc-student2@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Studenttwo', 'role', 'student')),
      (v_student3, 'zz-acc-student3@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Studentthree', 'role', 'student')),
      (v_teacher,  'zz-acc-teacher@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Teacher', 'role', 'professor')),
      (v_staff,    'zz-acc-staff@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Staff', 'role', 'professor')),
      (v_pending,  'zz-acc-pending@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Pending', 'role', 'professor')),
      (v_legacy,   'zz-acc-legacy@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Legacy', 'workplace', 'general')),
      (v_bare,     'zz-acc-bare@example.test',  '{}'::jsonb),
      (v_bare2,    'zz-acc-bare2@example.test', '{}'::jsonb)
    ) as v(id, em, meta);

  select id into v_admin from public.profiles
   where role = 'admin' and status = 'active' order by created_at limit 1;
  if v_admin is null then
    raise exception 'This suite needs an active admin account in the database';
  end if;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('student', v_student), ('student2', v_student2), ('student3', v_student3),
    ('teacher', v_teacher), ('staff', v_staff), ('pending', v_pending),
    ('legacy', v_legacy), ('bare', v_bare), ('bare2', v_bare2), ('admin', v_admin);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ signup

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_legacy  uuid := (select v from fx where k = 'legacy');
  v_bare    uuid := (select v from fx where k = 'bare');
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student signup is active and does not teach',
    (select status = 'active' and not can_teach from public.profiles where id = v_student));
  perform pg_temp.must_be('a faculty signup waits for the admin and does not teach',
    (select status = 'pending' and not can_teach from public.profiles where id = v_teacher));
  perform pg_temp.must_be('a signup naming only a workplace gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_legacy));
  perform pg_temp.must_be('a Google account gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ onboarding

do $$
declare
  v_bare  uuid := (select v from fx where k = 'bare');
  v_bare2 uuid := (select v from fx where k = 'bare2');
begin
  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_refuse('onboarding cannot make you an admin', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-acc-bare@example.test', 'Zz', 'Bare', 'admin', 'active')$q$, v_bare));
  perform pg_temp.must_refuse('onboarding cannot skip choosing student or faculty', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-acc-bare@example.test', 'Zz', 'Bare', null, 'active')$q$, v_bare));

  perform pg_temp.act_as(v_bare2);
  perform pg_temp.must_allow('onboarding as faculty is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
       values (%L, 'zz-acc-bare2@example.test', 'Zz', 'Baretwo', 'professor', 'active', true)$q$,
    v_bare2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...but it waits for approval and does not teach, whatever was sent',
    (select status = 'pending' and not can_teach from public.profiles where id = v_bare2));
end $$;

-- ------------------------------------------------------------------ privileged columns

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
begin
  perform pg_temp.act_as(v_student);
  update public.profiles set role = 'professor', status = 'active', can_teach = true
   where id = v_student;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an account cannot write its own role, status or teaching',
    (select role = 'student' and status = 'active' and not can_teach
       from public.profiles where id = v_student));

  perform pg_temp.must_be('enter_education is gone',
    not exists (select 1 from pg_proc where proname = 'enter_education'));
  perform pg_temp.must_be('decide_professor is gone',
    not exists (select 1 from pg_proc where proname = 'decide_professor'));
end $$;

-- ------------------------------------------------------------------ admission by the admin

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_student uuid := (select v from fx where k = 'student');
  v_admin   uuid := (select v from fx where k = 'admin');
begin
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('faculty cannot approve themselves',
    format('select public.decide_faculty(%L, true, true)', v_staff));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin approves a teacher',
    format('select public.decide_faculty(%L, true, true)', v_teacher));
  perform pg_temp.must_allow('the admin approves staff who do not teach',
    format('select public.decide_faculty(%L, true, false)', v_staff));
  perform pg_temp.must_refuse('a student does not go through faculty approval',
    format('select public.decide_faculty(%L, true, true)', v_student));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the teacher is active and teaches',
    (select status = 'active' and can_teach from public.profiles where id = v_teacher));
  perform pg_temp.must_be('the staff member is active and does not teach',
    (select status = 'active' and not can_teach from public.profiles where id = v_staff));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('faculty cannot change who teaches',
    format('select public.set_faculty_teaching(%L, true)', v_staff));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin turns teaching on later',
    format('select public.set_faculty_teaching(%L, true)', v_staff));
  perform pg_temp.must_allow('...and off again',
    format('select public.set_faculty_teaching(%L, false)', v_staff));
  perform pg_temp.must_refuse('teaching is only for faculty accounts',
    format('select public.set_faculty_teaching(%L, true)', v_student));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('each teaching change is in the audit log',
    (select count(*) = 2 from public.audit_events
      where action = 'teaching_changed' and subject_id = v_staff));
end $$;

-- ------------------------------------------------------------------ who is admitted

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_pending uuid := (select v from fx where k = 'pending');
begin
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_be('a student in nothing is not admitted', not public.am_i_admitted());

  perform pg_temp.act_as(v_pending);
  perform pg_temp.must_be('pending faculty are not admitted', not public.am_i_admitted());
  perform pg_temp.must_be('...and cannot read General', not public.general_viewer_active());

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_be('approved faculty are admitted', public.am_i_admitted());
  perform pg_temp.must_be('...and can read General', public.general_viewer_active());
end $$;

-- ------------------------------------------------------------------ creating spaces and projects

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_pending uuid := (select v from fx where k = 'pending');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_space   uuid;
begin
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot create a space',
    $q$select public.create_general_space('Zz student space', '')$q$);
  perform pg_temp.must_refuse('a student cannot create a project',
    $q$select public.create_general_project('Zz student project')$q$);

  perform pg_temp.act_as(v_pending);
  perform pg_temp.must_refuse('pending faculty cannot create a space',
    $q$select public.create_general_space('Zz pending space', '')$q$);

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_allow('approved faculty create a space, teaching or not',
    $q$select public.create_general_space('Zz office', '')$q$);

  perform pg_temp.act_as_service();
  select id into v_space from public.general_spaces where name = 'Zz office' and created_by = v_staff;
  insert into fx values ('space', v_space);

  perform pg_temp.act_as(v_staff);
  insert into fx
  select 'project', (public.create_general_project('Zz office project', '', null, null, null, null, v_space)).id;
end $$;

-- ------------------------------------------------------------------ joining by code

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_space   uuid := (select v from fx where k = 'space');
  v_project uuid := (select v from fx where k = 'project');
  v_space_code   text;
  v_project_code text;
begin
  perform pg_temp.act_as(v_staff);
  v_space_code := public.set_general_space_join_code(v_space, true, true);
  v_project_code := public.set_general_join_code(v_project, true, true);

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot join a work space by code',
    format('select public.join_general_space(%L)', v_space_code));
  perform pg_temp.must_refuse('a student cannot join a work-space project by code',
    format('select public.join_general_project(%L)', v_project_code));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_allow('faculty join a work space by code',
    format('select public.join_general_space(%L)', v_space_code));
  perform pg_temp.must_allow('...and a project by code',
    format('select public.join_general_project(%L)', v_project_code));
end $$;

-- ------------------------------------------------------------------ invitations and levels

do $$
declare
  v_student  uuid := (select v from fx where k = 'student');
  v_student2 uuid := (select v from fx where k = 'student2');
  v_staff    uuid := (select v from fx where k = 'staff');
  v_space    uuid := (select v from fx where k = 'space');
  v_project  uuid := (select v from fx where k = 'project');
  v_inv      uuid;
begin
  perform pg_temp.act_as(v_staff);
  v_inv := (public.invite_to_general_space(v_space, v_student)).id;
  perform pg_temp.act_as(v_student);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.must_be('a student let into a space is admitted', public.am_i_admitted());
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('faculty invite a student into a work space, as a member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_student));

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('a student cannot be made a Manager of a space',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_student, 'manager'));

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot invite another student into a space',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_student2));

  perform pg_temp.act_as(v_staff);
  v_inv := (public.invite_to_general_project(v_project, v_student2)).id;
  perform pg_temp.act_as(v_student2);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.must_be('a student let onto a project is admitted', public.am_i_admitted());
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('faculty invite a student onto a project, as a member',
    (select level = 'member' from public.general_members
      where project_id = v_project and user_id = v_student2));

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('a student cannot be made a Manager of a project',
    format('select public.set_general_member_level(%L, %L, %L)', v_project, v_student2, 'manager'));
end $$;

-- ------------------------------------------------------------------ classes

do $$
declare
  v_teacher  uuid := (select v from fx where k = 'teacher');
  v_staff    uuid := (select v from fx where k = 'staff');
  v_student3 uuid := (select v from fx where k = 'student3');
  v_result   text;
begin
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('faculty who do not teach cannot open a class', format(
    $q$insert into public.classes
         (professor_id, name, initial, code, section, year_level, semester, school_year)
       values (%L, 'Zz Staff class', 'ZZS', 'ZZACC-STAFF', 'BSIT 1A', '1st', '1st', '2026-2027')$q$,
    v_staff));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_allow('teaching faculty open a class', format(
    $q$insert into public.classes
         (professor_id, name, initial, code, section, year_level, semester, school_year)
       values (%L, 'Zz Teacher class', 'ZZT', 'ZZACC-TEACH', 'BSIT 1A', '1st', '1st', '2026-2027')$q$,
    v_teacher));

  perform pg_temp.act_as(v_student3);
  perform pg_temp.must_be('a student in nothing is not admitted yet', not public.am_i_admitted());
  select public.join_class('ZZACC-TEACH') ->> 'result' into v_result;
  perform pg_temp.must_be('a student joins a class with its code', v_result = 'joined');
  perform pg_temp.must_be('...and is admitted from then on', public.am_i_admitted());
end $$;

rollback;
