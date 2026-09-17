-- Two workplaces — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/workplaces.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.

begin;

-- ------------------------------------------------------------------ helpers

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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_gen uuid := gen_random_uuid();   -- registered for General
  v_gen2 uuid := gen_random_uuid();  -- registered for General, never enters Education
  v_prof uuid := gen_random_uuid();  -- registered for Education as a professor
  v_bare uuid := gen_random_uuid();  -- a Google account with no profile yet
  v_bare2 uuid := gen_random_uuid(); -- another one, for the control
  v_admin uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values
    (v_gen, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-gen@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'General', 'workplace', 'general'),
     now(), now()),
    (v_gen2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-gen2@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'Generaltwo', 'workplace', 'general'),
     now(), now()),
    (v_prof, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-prof@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'Prof', 'role', 'professor'),
     now(), now()),
    (v_bare, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-bare@example.test', '', '{}'::jsonb, now(), now()),
    (v_bare2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-bare2@example.test', '', '{}'::jsonb, now(), now());

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values ('gen', v_gen), ('gen2', v_gen2), ('prof', v_prof),
                        ('bare', v_bare), ('bare2', v_bare2), ('admin', v_admin);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ signup

do $$
declare
  v_gen uuid := (select v from fx where k = 'gen');
  v_prof uuid := (select v from fx where k = 'prof');
  v_bare uuid := (select v from fx where k = 'bare');
begin
  perform pg_temp.must_be('a General signup gets no role',
    (select role is null from public.profiles where id = v_gen));
  perform pg_temp.must_be('a General signup is active straight away',
    (select status = 'active' from public.profiles where id = v_gen));
  perform pg_temp.must_be('a General signup lands in General',
    (select home_workplace = 'general' from public.profiles where id = v_gen));

  perform pg_temp.must_be('an Education professor signup is still pending',
    (select role = 'professor' and status = 'pending' and home_workplace = 'education'
       from public.profiles where id = v_prof));

  perform pg_temp.must_be('a Google account still gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ inserting your own profile

do $$
declare
  v_bare uuid := (select v from fx where k = 'bare');
  v_bare2 uuid := (select v from fx where k = 'bare2');
begin
  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_refuse('onboarding cannot make you an admin', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-ws-bare@example.test', 'Zz', 'Bare', 'admin', 'active')$q$, v_bare));

  perform pg_temp.act_as(v_bare2);
  perform pg_temp.must_allow('onboarding as a professor is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-ws-bare2@example.test', 'Zz', 'Baretwo', 'professor', 'active')$q$, v_bare2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...but claiming active does not skip approval',
    (select status = 'pending' from public.profiles where id = v_bare2));

  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_allow('onboarding into General with no role is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status, home_workplace)
       values (%L, 'zz-ws-bare@example.test', 'Zz', 'Bare', null, 'pending', 'general')$q$, v_bare));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is active, whatever status was sent',
    (select status = 'active' and role is null from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ Education needs a role

do $$
declare
  v_gen uuid := (select v from fx where k = 'gen');
  v_gen2 uuid := (select v from fx where k = 'gen2');
  v_admin uuid := (select v from fx where k = 'admin');
  v_prof uuid := (select v from fx where k = 'prof');
  v_code text := (select code from public.classes where archived_at is null order by created_at limit 1);
  v_student uuid := (select id from public.profiles where role = 'student' and status = 'active'
                      order by created_at limit 1);
  v_result text;
begin
  perform pg_temp.act_as(v_gen);
  select public.join_class(v_code) ->> 'result' into v_result;
  perform pg_temp.must_be('an account with no role cannot join a class', v_result = 'not_student');

  perform pg_temp.act_as(v_student);
  select public.join_class(v_code) ->> 'result' into v_result;
  perform pg_temp.must_be('...while a student gets past the role check', v_result <> 'not_student');

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse('an admin cannot approve an account with no role as a professor',
    format('select public.decide_professor(%L, true)', v_gen2));
  perform pg_temp.must_allow('...but still approves a real professor',
    format('select public.decide_professor(%L, true)', v_prof));

  perform pg_temp.act_as(v_gen);
  update public.profiles set role = 'professor', status = 'active' where id = v_gen;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('writing your own role directly is pinned back',
    (select role is null and status = 'active' from public.profiles where id = v_gen));

  perform pg_temp.act_as(v_gen);
  perform pg_temp.must_refuse('enter_education refuses admin', $q$select public.enter_education('admin')$q$);
  perform pg_temp.must_allow('enter_education accepts professor', $q$select public.enter_education('professor')$q$);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the new professor waits for approval',
    (select role = 'professor' and status = 'pending' and home_workplace = 'general'
       from public.profiles where id = v_gen));

  perform pg_temp.act_as(v_gen);
  perform pg_temp.must_refuse('enter_education only works once', $q$select public.enter_education('student')$q$);

  -- enter_education raised a transaction-local flag above. If it forgot to lower
  -- it, this write would slip through, because it is the same transaction.
  perform pg_temp.act_as(v_gen2);
  update public.profiles set role = 'student', status = 'active' where id = v_gen2;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the bypass flag does not leak into a later statement',
    (select role is null from public.profiles where id = v_gen2));
end $$;

rollback;
