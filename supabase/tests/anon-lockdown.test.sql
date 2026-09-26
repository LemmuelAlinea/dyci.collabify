-- The signed-out role runs nothing in public — rolled back, touches nothing
-- permanently.
--
--   node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
--
-- supabase/anon-lockdown.sql takes EXECUTE away from anon on every
-- non-extension function in public, while leaving authenticated exactly as
-- it was. This asserts the sweep is total, that signed-in access to the
-- functions the two workplaces actually call is untouched, that the two
-- functions withheld from authenticated stay withheld, and that a signed-out
-- caller is refused end to end while a signed-in one still gets through.

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

-- ------------------------------------------------------------- total sweep

do $$
declare
  f record;
  n int := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
  loop
    if has_function_privilege('anon', f.oid, 'execute') then
      n := n + 1;
      raise notice 'still executable by anon: %', f.sig;
    end if;
  end loop;
  perform pg_temp.must_be('no non-extension function in public is executable by anon', n = 0);
end $$;

-- --------------------------------------------------- authenticated, kept

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.join_class(text)',
    'public.class_join_preview(text)',
    'public.am_i_admitted()',
    'public.is_class_professor(uuid)',
    'public.list_general_space_members(uuid)',
    'public.create_general_space(text,text)',
    'public.start_direct_conversation(uuid)',
    'public.decide_faculty(uuid,boolean,boolean)',
    'public.rate_limit_ok(text,integer,interval)',
    'public.rate_limit(text,integer,interval,text)'
  ] loop
    perform pg_temp.must_be('authenticated can still execute ' || fn,
      has_function_privilege('authenticated', fn::regprocedure, 'execute'));
  end loop;
end $$;

-- ------------------------------------------------ authenticated, withheld

do $$
begin
  perform pg_temp.must_be('authenticated still cannot execute class_sync_on()',
    not has_function_privilege('authenticated', 'public.class_sync_on()'::regprocedure, 'execute'));
  perform pg_temp.must_be('authenticated still cannot execute class_sync_restore(text)',
    not has_function_privilege('authenticated',
      'public.class_sync_restore(text)'::regprocedure, 'execute'));
end $$;

-- --------------------------------------------------------------- behaviour

do $$
declare
  v_student uuid := gen_random_uuid();
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values (v_student, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-anon-lockdown-student@example.test', '',
          jsonb_build_object('first_name', 'Zz', 'last_name', 'Anon', 'role', 'student'),
          now(), now());

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform pg_temp.must_refuse('a signed-out caller cannot call join_class',
    $q$select public.join_class('X')$q$);

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_allow('a signed-in student can still call am_i_admitted',
    'select public.am_i_admitted()');
end $$;

rollback;
