-- supabase/tests/class-look.test.sql
-- A class's color and icon: who sets them, what they accept, who reads them.
-- Rolls back; nothing survives.
--
-- The file under test must already be applied, or spliced in after the opening begin:
--   node scripts/db.mjs supabase/tests/class-look.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_t   uuid := gen_random_uuid();  -- teaches the class
  v_u   uuid := gen_random_uuid();  -- teaches another class
  v_s   uuid := gen_random_uuid();  -- a student in the class
  cls   uuid;
  n     int;
  refused boolean;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_t), (v_u), (v_s)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (v_t, v_t::text || '@test.invalid', 'Zz', 'Look teacher', 'member',  'active', true),
         (v_u, v_u::text || '@test.invalid', 'Zz', 'Look other',   'member',  'active', true),
         (v_s, v_s::text || '@test.invalid', 'Zz', 'Look student', 'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_t, 'Zz Look class', 'ZZLK', 'ZZ-LOOK-' || left(v_t::text, 8), 'BSIT 9L', '3rd', '1st', '2026-2027')
  returning id into cls;
  insert into public.class_members (class_id, student_id, status) values (cls, v_s, 'active');

  perform pg_temp.must_be('a new class has no look',
    (select color is null and icon is null from public.classes where id = cls));

  ------------------------------------------------------------ 1. the teacher sets it
  perform pg_temp.act_as(v_t);
  update public.classes set color = 'teal', icon = 'code' where id = cls;
  get diagnostics n = row_count;
  perform pg_temp.must_be('the teacher sets a swatch and an icon', n = 1);
  update public.classes set color = '#3a6ff7' where id = cls;
  perform pg_temp.must_be('...and a custom color',
    (select color = '#3a6ff7' from public.classes where id = cls));
  update public.classes set color = null, icon = null where id = cls;
  perform pg_temp.must_be('...and clears both back to the plain tile',
    (select color is null and icon is null from public.classes where id = cls));

  ------------------------------------------------------------ 2. only the fixed sets
  begin
    update public.classes set icon = 'rocket' where id = cls;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('an icon outside the set is refused', refused);
  begin
    update public.classes set color = 'pink' where id = cls;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('a color outside the swatches is refused', refused);
  begin
    update public.classes set color = '#3A6FF7' where id = cls;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('an upper-case hex is refused', refused);

  update public.classes set color = 'violet', icon = 'flask' where id = cls;

  ------------------------------------------------------------ 3. nobody else writes it
  perform pg_temp.act_as(v_s);
  update public.classes set icon = 'book' where id = cls;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a student cannot change it', n = 0);
  perform pg_temp.must_be('...but reads it',
    (select color = 'violet' and icon = 'flask' from public.classes where id = cls));

  perform pg_temp.act_as(v_u);
  update public.classes set icon = 'book' where id = cls;
  get diagnostics n = row_count;
  perform pg_temp.must_be('another class''s teacher cannot change it', n = 0);

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the look is as the teacher left it',
    (select color = 'violet' and icon = 'flask' from public.classes where id = cls));
end;
$$;

rollback;
