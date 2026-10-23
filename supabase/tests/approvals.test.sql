-- Professor approvals, retired — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/approvals.test.sql
--
-- Sign-up no longer produces a pending account, so there is nothing to approve:
-- decide_faculty is gone (supabase/company-accounts.sql). What is left of the
-- page is the teachers list, and the rules around it still hold. Every refusal
-- is paired with somebody who is allowed the same statement.

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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_admin uuid; v_student uuid; v_teach uuid; v_off uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' and status = 'active' limit 1;
  select id into v_student from public.profiles where role = 'student' limit 1;

  -- A member who teaches, and a deactivated one.
  v_teach := gen_random_uuid();
  v_off := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_teach, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-ap-teach@example.test', '', now(), now()),
         (v_off, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-ap-off@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status, can_teach)
  values (v_teach, 'Zz', 'Apteach', 'zz-ap-teach@example.test', 'member', 'active', true),
         (v_off, 'Zz', 'Apoff', 'zz-ap-off@example.test', 'member', 'rejected', true);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('admin', v_admin), ('student', v_student), ('teach', v_teach), ('off', v_off);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ retired

do $$
begin
  perform pg_temp.must_be('decide_faculty is gone',
    to_regprocedure('public.decide_faculty(uuid, boolean, boolean)') is null);
  perform pg_temp.must_be('...while set_account_active, which reactivates, is here',
    to_regprocedure('public.set_account_active(uuid, boolean)') is not null);
end $$;

-- The older guard still holds: a direct write pins the columns back rather
-- than raising, so this checks the value, not an error.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_off uuid := (select v from fx where k='off');
begin
  perform pg_temp.act_as(v_off);
  update public.profiles set status = 'active' where id = v_off;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a deactivated account cannot set its own status',
    (select status = 'rejected' from public.profiles where id = v_off));

  perform pg_temp.act_as(v_off);
  perform pg_temp.must_refuse('...nor reactivate itself',
    format('select public.set_account_active(%L, true)', v_off));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin can put it back',
    format('select public.set_account_active(%L, true)', v_off));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is active again',
    (select status = 'active' from public.profiles where id = v_off));
end $$;

-- ------------------------------------------------------------- the teachers list

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_teach uuid := (select v from fx where k='teach');
  v_student uuid := (select v from fx where k='student');
  n int;
begin
  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.professor_accounts where id = v_teach;
  perform pg_temp.must_be('the admin sees a member who teaches', n = 1);

  select count(*) into n from public.professor_accounts where id = v_student;
  perform pg_temp.must_be('...and not a student', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- A teacher cannot browse the whole list through the view.
do $$
declare
  v_teach uuid := (select v from fx where k='teach');
  v_off uuid := (select v from fx where k='off');
  n int;
begin
  perform pg_temp.act_as(v_teach);
  select count(*) into n from public.professor_accounts where id = v_teach;
  perform pg_temp.must_be('a teacher reads their own row', n = 1);
  select count(*) into n from public.professor_accounts where id = v_off;
  perform pg_temp.must_be('...but not another teacher''s', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
