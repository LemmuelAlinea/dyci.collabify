-- Run after section-students.sql. All fixture rows roll back.
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end;
$$;

create or replace function pg_temp.refuse(p_label text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS % (refused: %)', p_label, left(sqlerrm, 64);
    return;
  end;
  raise exception 'FAIL %: should have been refused', p_label;
end;
$$;

do $$
declare
  adm uuid := gen_random_uuid();
  teacher uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  sec uuid;
  class1 uuid;
  class2 uuid;
  class3 uuid;
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (adm), (teacher), (s1), (s2)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (adm, adm::text || '@test.invalid', 'Section', 'Admin', 'admin', 'active', false),
         (teacher, teacher::text || '@test.invalid', 'Section', 'Teacher', 'member', 'active', true),
         (s1, s1::text || '@test.invalid', 'Section', 'One', 'student', 'active', false),
         (s2, s2::text || '@test.invalid', 'Section', 'Two', 'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status,
                                 can_teach = excluded.can_teach;

  insert into public.program_sections (name, year_level, school_year)
  values ('ZZ ST 9A', '3rd', '2099-2100') returning id into sec;

  perform pg_temp.act_as(teacher);
  perform pg_temp.refuse('faculty cannot assign students',
    format('select public.set_section_students(%L, array[%L]::uuid[])', sec, s1));
  perform pg_temp.refuse('faculty cannot write roster directly',
    format('insert into public.program_section_students (section_id, student_id) values (%L, %L)', sec, s1));

  perform pg_temp.act_as(adm);
  perform pg_temp.refuse('a faculty account cannot be assigned as a student',
    format('select public.set_section_students(%L, array[%L]::uuid[])', sec, teacher));
  perform pg_temp.check('admin assigns active students',
    public.set_section_students(sec, array[s1]) = 1);

  perform pg_temp.act_as(teacher);
  perform pg_temp.check('faculty cannot read the registry roster',
    (select count(*) from public.program_section_students where section_id = sec) = 0);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, student_cap)
  values (teacher, 'Section roster test', 'ZZST', 'ZZST-0001', 'zz-st9a', '3rd', '1st', '2099-2100', 2)
  returning id into class1;
  perform pg_temp.check('new class starts with assigned student',
    (select count(*) from public.class_members where class_id = class1 and student_id = s1 and status = 'active') = 1);
  perform pg_temp.check('new student is in the class space',
    (select count(*) from public.general_space_members m join public.classes c on c.space_id = m.space_id
      where c.id = class1 and m.user_id = s1) = 1);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, student_cap)
  values (teacher, 'Full section test', 'ZZFS', 'ZZST-0004', 'ZZ ST 9A', '3rd', '1st', '2099-2100', 1)
  returning id into class3;

  perform pg_temp.act_as(adm);
  perform pg_temp.refuse('existing class cap blocks roster expansion',
    format('select public.set_section_students(%L, array[%L,%L]::uuid[])', sec, s1, s2));
  perform pg_temp.check('refused roster edit is atomic',
    (select count(*) from public.program_section_students where section_id = sec) = 1);
  perform pg_temp.act_as(teacher);
  update public.classes set student_cap = 2 where id = class3;
  perform pg_temp.act_as(adm);
  perform pg_temp.check('admin expands section roster',
    public.set_section_students(sec, array[s1, s2]) = 2);
  perform pg_temp.act_as(teacher);
  perform pg_temp.check('assigning later adds students to running classes',
    (select count(*) from public.class_members where class_id = class1 and status = 'active') = 2);
  perform pg_temp.act_as(adm);
  perform pg_temp.check('duplicate assignments are harmless',
    public.set_section_students(sec, array[s1, s2, s2]) = 2);

  perform pg_temp.act_as(teacher);
  perform pg_temp.refuse('new class refuses an undersized cap',
    format($q$insert into public.classes
      (professor_id, name, initial, code, section, year_level, semester, school_year, student_cap)
      values (%L, 'Too small', 'ZZTS', 'ZZST-0002', 'ZZ ST 9A', '3rd', '1st', '2099-2100', 1)$q$, teacher));
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (teacher, 'Next year', 'ZZNY', 'ZZST-0003', 'ZZ ST 9A', '3rd', '1st', '2098-2099')
  returning id into class2;
  perform pg_temp.check('different school year does not enroll students',
    (select count(*) from public.class_members where class_id = class2) = 0);

  perform pg_temp.act_as(adm);
  perform pg_temp.check('admin clears section roster', public.set_section_students(sec, '{}') = 0);
  perform pg_temp.act_as(teacher);
  perform pg_temp.check('clearing assignment keeps class membership',
    (select count(*) from public.class_members where class_id = class1 and status = 'active') = 2);
end;
$$;

rollback;
