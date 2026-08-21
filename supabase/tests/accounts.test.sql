-- The admin's account list — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/accounts.test.sql
--
-- The refusals are the feature here. Every one is paired with a case that is
-- allowed, so a refusal never passes for the wrong reason.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 54);
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

do $$
declare
  v_admin uuid; v_prof uuid; v_stud uuid; v_free uuid; v_class uuid;
begin
  select id into v_admin from public.profiles where role='admin' limit 1;
  select id into v_prof  from public.profiles where role='professor' limit 1;
  select id into v_stud  from public.profiles where role='student' limit 1;
  select id into v_class from public.classes where professor_id = v_prof limit 1;

  -- A professor holding no classes, so the demotion guard can be told apart
  -- from a plain refusal.
  v_free := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_free, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-free@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_free, 'Zz', 'Free', 'zz-free@example.test', 'professor', 'active');

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('admin',v_admin), ('prof',v_prof), ('stud',v_stud), ('free',v_free), ('class',v_class);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ who may

do $$
declare
  v_stud uuid := (select v from fx where k='stud');
  v_prof uuid := (select v from fx where k='prof');
  v_free uuid := (select v from fx where k='free');
begin
  perform pg_temp.act_as(v_stud);
  perform pg_temp.must_refuse('a student cannot change a role',
    format('select public.set_account_role(%L, ''professor''::public.user_role)', v_stud));
  perform pg_temp.must_refuse('a student cannot deactivate anybody',
    format('select public.set_account_active(%L, false)', v_free));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('nor can a professor',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_free));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- the two doors that stay shut

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_stud uuid := (select v from fx where k='stud');
begin
  perform pg_temp.act_as(v_admin);

  -- An admin minting admins has nothing above it to notice.
  perform pg_temp.must_refuse('nobody is promoted to admin from here',
    format('select public.set_account_role(%L, ''admin''::public.user_role)', v_stud));

  perform pg_temp.must_refuse('an admin cannot change their own role',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_admin));

  perform pg_temp.must_refuse('...nor lock themselves out',
    format('select public.set_account_active(%L, false)', v_admin));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and they are untouched',
    (select role = 'admin' and status = 'active' from public.profiles where id = v_admin));
end $$;

-- ------------------------------------------------------------- promoting

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_stud uuid := (select v from fx where k='stud');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('a student is promoted to professor',
    format('select public.set_account_role(%L, ''professor''::public.user_role)', v_stud));
  perform pg_temp.act_as_service();

  -- The whole point: a promotion is not a verification.
  perform pg_temp.must_be('...and lands pending, not active',
    (select role = 'professor' and status = 'pending'
       from public.profiles where id = v_stud));

  perform pg_temp.must_be('the change is in the audit log',
    exists (select 1 from public.audit_events
             where action = 'role_changed' and subject_id = v_stud
               and before_value = 'student' and after_value = 'professor'));
end $$;

-- -------------------------------------------------- demoting, and the guard

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_free uuid := (select v from fx where k='free');
begin
  perform pg_temp.act_as(v_admin);

  -- Holding a live class: refused, because a class with no professor is
  -- unreachable to everyone in it.
  perform pg_temp.must_refuse('a professor holding a class cannot be demoted',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_prof));

  -- Holding none: allowed. Same statement, different circumstance.
  perform pg_temp.must_allow('one holding none can be',
    format('select public.set_account_role(%L, ''student''::public.user_role)', v_free));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and a demoted professor is active, not pending',
    (select role = 'student' and status = 'active' from public.profiles where id = v_free));
end $$;

-- ----------------------------------------------------------- deactivating

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_free uuid := (select v from fx where k='free');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin deactivates an account',
    format('select public.set_account_active(%L, false)', v_free));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and ProtectedRoute would turn them away',
    (select status <> 'active' from public.profiles where id = v_free));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('and can put them back',
    format('select public.set_account_active(%L, true)', v_free));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...to active',
    (select status = 'active' from public.profiles where id = v_free));

  perform pg_temp.must_be('both landed in the audit log',
    (select count(*) >= 2 from public.audit_events
      where action = 'status_changed' and subject_id = v_free));
end $$;

-- ------------------------------------------------------------------ reading

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_stud uuid := (select v from fx where k='stud');
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.account_overview;
  perform pg_temp.must_be('the admin reads every account', n >= 20);

  perform pg_temp.must_be('a professor row carries a class count and nothing inside it',
    (select class_count >= 1 from public.account_overview where id = v_prof));

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.account_overview;
  perform pg_temp.must_be('a professor does not get the roster through it', n < 20);
  perform pg_temp.act_as_service();
end $$;

-- There is no delete on this page, and this is why: one row takes a term with it.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  select count(*) into n from pg_constraint c
   where c.confrelid = 'public.profiles'::regclass and c.contype = 'f'
     and c.confdeltype = 'c';
  perform pg_temp.must_be('deleting a profile still cascades widely — hence no delete', n > 10);

  perform pg_temp.must_be('...including the classes a professor runs',
    exists (select 1 from public.classes where professor_id = v_prof));
end $$;

rollback;
