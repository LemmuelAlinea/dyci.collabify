-- Section faculty — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/section-faculty.test.sql

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  adm uuid := gen_random_uuid();
  f1  uuid := gen_random_uuid();
  f2  uuid := gen_random_uuid();
  nt  uuid := gen_random_uuid();
  st  uuid := gen_random_uuid();
  sec uuid;
  old uuid;
  n   int;
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (adm), (f1), (f2), (nt), (st)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (adm, adm::text || '@test.invalid', 'Sec', 'Admin',   'admin',   'active', false),
         (f1,  f1::text  || '@test.invalid', 'Sec', 'One',     'faculty', 'active', true),
         (f2,  f2::text  || '@test.invalid', 'Sec', 'Two',     'faculty', 'active', true),
         (nt,  nt::text  || '@test.invalid', 'Sec', 'NoTeach', 'faculty', 'active', false),
         (st,  st::text  || '@test.invalid', 'Sec', 'Student', 'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.program_sections (name, year_level, school_year)
  values ('ZZ SEC 9A', '3rd', '2099-2100') returning id into sec;
  insert into public.program_sections (name, year_level, school_year, archived_at)
  values ('ZZ SEC 9B', '2nd', '2099-2100', now()) returning id into old;

  -- Only the chair assigns.
  perform pg_temp.act_as(f1);
  perform pg_temp.must_refuse('faculty cannot assign a section',
    format('select public.set_section_faculty(%L, array[%L]::uuid[])', sec, f1));
  perform pg_temp.must_refuse('faculty cannot write the table directly',
    format('insert into public.program_section_faculty (section_id, faculty_id) values (%L, %L)', sec, f1));

  perform pg_temp.act_as(adm);
  n := public.set_section_faculty(sec, array[f1, f2]);
  perform pg_temp.must_be('admin assigns one section to two faculty', n = 2);
  n := public.set_section_faculty(sec, array[f1, f2, f2]);
  perform pg_temp.must_be('assigning again is idempotent', n = 2);

  perform pg_temp.must_refuse('faculty who do not teach cannot be assigned',
    format('select public.set_section_faculty(%L, array[%L]::uuid[])', sec, nt));
  perform pg_temp.must_refuse('a student cannot be assigned',
    format('select public.set_section_faculty(%L, array[%L]::uuid[])', sec, st));
  perform pg_temp.must_refuse('an archived section cannot be assigned',
    format('select public.set_section_faculty(%L, array[%L]::uuid[])', old, f1));
  perform pg_temp.must_be('a refused call changed nothing',
    (select count(*) from public.program_section_faculty where section_id = sec) = 2);

  -- Faculty read only their own rows.
  perform pg_temp.act_as(f1);
  perform pg_temp.must_be('faculty see their own assignment',
    (select count(*) from public.program_section_faculty where section_id = sec) = 1);
  perform pg_temp.must_be('faculty see the assigned section through the join',
    (select count(*) from public.program_sections s
       join public.program_section_faculty a on a.section_id = s.id
      where a.faculty_id = f1 and s.id = sec) = 1);
  perform pg_temp.act_as(st);
  perform pg_temp.must_be('a student sees no assignments',
    (select count(*) from public.program_section_faculty where section_id = sec) = 0);

  -- Replacing the list takes people off.
  perform pg_temp.act_as(adm);
  n := public.set_section_faculty(sec, array[f2]);
  perform pg_temp.must_be('replacing the list drops whoever is left out',
    n = 1 and not exists (select 1 from public.program_section_faculty where section_id = sec and faculty_id = f1));
  n := public.set_section_faculty(sec, '{}');
  perform pg_temp.must_be('an empty list clears the section', n = 0);

  -- Archive, restore and delete for good, as the Archive page does them.
  n := public.set_section_faculty(sec, array[f1]);
  update public.program_sections set archived_at = now() where id = sec;
  perform pg_temp.must_be('admin archives a section',
    (select archived_at is not null from public.program_sections where id = sec));
  perform pg_temp.must_be('an archived section keeps its faculty',
    (select count(*) from public.program_section_faculty where section_id = sec) = 1);
  update public.program_sections set archived_at = null where id = sec;
  perform pg_temp.must_be('admin restores a section',
    (select archived_at is null from public.program_sections where id = sec));

  perform pg_temp.act_as(f1);
  update public.program_sections set archived_at = now() where id = sec;
  delete from public.program_sections where id = sec;
  perform pg_temp.act_as(adm);
  perform pg_temp.must_be('faculty cannot archive or delete a section',
    (select archived_at is null from public.program_sections where id = sec));

  delete from public.program_sections where id = sec;
  perform pg_temp.must_be('deleting a section for good takes its assignments with it',
    not exists (select 1 from public.program_section_faculty where section_id = sec));
end $$;

rollback;
