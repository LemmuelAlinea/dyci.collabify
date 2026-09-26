-- One workplace, phase 2: classes as spaces — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/one-workplace.test.sql
--
-- A class owns its space. Whatever happens to the class happens to the space,
-- and nothing reaches the space any other way.

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

-- Superuser, but with a caller's claims: RLS steps aside, auth.uid() still names
-- somebody, so a trigger's own rule is what gets tested.
create or replace function pg_temp.act_as_owner_for(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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
  v_teacher  uuid := gen_random_uuid();  -- teaches, owns the class
  v_cot      uuid := gen_random_uuid();  -- faculty, becomes a co-teacher
  v_staff    uuid := gen_random_uuid();  -- faculty, stays a plain member
  v_s1       uuid := gen_random_uuid();
  v_s2       uuid := gen_random_uuid();
  v_s3       uuid := gen_random_uuid();
  v_class    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', jsonb_build_object('first_name', 'Zz', 'last_name', v.ln, 'role', v.r),
         now(), now()
    from (values
      (v_teacher, 'zz-ow-teacher@example.test', 'Teacher',  'professor'),
      (v_cot,     'zz-ow-cot@example.test',     'Coteach',  'professor'),
      (v_staff,   'zz-ow-staff@example.test',   'Staff',    'professor'),
      (v_s1,      'zz-ow-s1@example.test',      'Sone',     'student'),
      (v_s2,      'zz-ow-s2@example.test',      'Stwo',     'student'),
      (v_s3,      'zz-ow-s3@example.test',      'Sthree',   'student')
    ) as v(id, em, ln, r);

  -- Approved faculty; only the teacher may open classes.
  update public.profiles set status = 'active', can_teach = (id = v_teacher)
   where id in (v_teacher, v_cot, v_staff);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('teacher', v_teacher), ('cot', v_cot), ('staff', v_staff),
    ('s1', v_s1), ('s2', v_s2), ('s3', v_s3);

  perform pg_temp.act_as(v_teacher);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_teacher, 'Zz Systems Analysis', 'ZZSA', 'ZZOW-0001', 'BSIT 3A', '3rd', '1st', '2026-2027')
  returning id into v_class;
  perform pg_temp.act_as_service();
  insert into fx values ('class', v_class);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ a class makes its space

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid;
begin
  perform pg_temp.act_as_service();
  select space_id into v_space from public.classes where id = v_class;
  insert into fx values ('space', v_space);

  perform pg_temp.must_be('a new class has a space',
    v_space is not null);
  perform pg_temp.must_be('...of kind education, named for the class and section',
    (select kind = 'education' and name = 'Zz Systems Analysis · BSIT 3A'
       from public.general_spaces where id = v_space));
  perform pg_temp.must_be('...with the professor as its Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_teacher));
end $$;

-- ------------------------------------------------------------------ every class already had one

do $$
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('every class has a space',
    not exists (select 1 from public.classes where space_id is null));
  perform pg_temp.must_be('every class space is of kind education',
    not exists (select 1 from public.classes c join public.general_spaces s on s.id = c.space_id
                 where s.kind <> 'education'));
  perform pg_temp.must_be('every class professor owns the class space',
    not exists (select 1 from public.classes c
                 where not exists (select 1 from public.general_space_members m
                                    where m.space_id = c.space_id and m.user_id = c.professor_id
                                      and m.level = 'owner')));
  perform pg_temp.must_be('every active student is a member of the class space',
    not exists (select 1 from public.class_members cm join public.classes c on c.id = cm.class_id
                 where cm.status = 'active'
                   and not exists (select 1 from public.general_space_members m
                                    where m.space_id = c.space_id and m.user_id = cm.student_id)));
end $$;

-- ------------------------------------------------------------------ the space follows the class

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_cot     uuid := (select v from fx where k = 'cot');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
begin
  perform pg_temp.act_as(v_teacher);
  update public.classes set name = 'Zz Systems Design', section = 'BSIT 3B' where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('renaming the class renames its space',
    (select name = 'Zz Systems Design · BSIT 3B' from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('archiving the class archives its space',
    (select archived_at is not null from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  update public.classes set archived_at = null where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('restoring the class restores its space',
    (select archived_at is null from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('a professor cannot hand the class to somebody else', format(
    'update public.classes set professor_id = %L where id = %L', v_cot, v_class));
  perform pg_temp.must_refuse('a class cannot move to another space', format(
    'update public.classes set space_id = gen_random_uuid() where id = %L', v_class));

  -- Handing a class over is the SQL console's (and so the admin's) job: there is
  -- no admin update policy on classes, so it runs as the service role here.
  perform pg_temp.act_as_service();
  perform pg_temp.must_allow('the console can hand the class over', format(
    'update public.classes set professor_id = %L where id = %L', v_cot, v_class));
  perform pg_temp.must_be('...and the new professor owns the space',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_cot));
  perform pg_temp.must_be('...while the old one leaves it',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_teacher));
  update public.classes set professor_id = v_teacher where id = v_class;
  perform pg_temp.must_be('handing it back restores the first professor as Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_teacher));
end $$;

-- ------------------------------------------------------------------ deleting the class

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_temp    uuid;
  v_space   uuid;
begin
  perform pg_temp.act_as(v_teacher);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_teacher, 'Zz Throwaway', 'ZZTW', 'ZZOW-0002', 'BSIT 3A', '3rd', '1st', '2026-2027')
  returning id, space_id into v_temp, v_space;
  delete from public.classes where id = v_temp;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting a class deletes its space',
    not exists (select 1 from public.general_spaces where id = v_space));
end $$;

-- ------------------------------------------------------------------ the General list can tell kinds apart

do $$
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('general_space_overview carries the kind',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'general_space_overview'
               and column_name = 'kind'));
end $$;

rollback;
