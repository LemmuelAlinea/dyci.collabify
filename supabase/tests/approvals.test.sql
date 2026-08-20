-- Professor approvals — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/approvals.test.sql
--
-- Every refusal is paired with somebody who is allowed the same statement.

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
  v_admin uuid; v_student uuid; v_prof uuid; v_new uuid;
begin
  select id into v_admin from public.profiles where role = 'superadmin' limit 1;
  select id into v_student from public.profiles where role = 'student' limit 1;
  select id into v_prof from public.profiles where role = 'professor' limit 1;

  -- A freshly signed-up professor, waiting.
  v_new := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-pending-prof@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_new, 'Zz', 'Pending', 'zz-pending-prof@example.test', 'professor', 'pending');

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('admin', v_admin), ('student', v_student), ('prof', v_prof), ('new', v_new);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ who may

do $$
declare
  v_student uuid := (select v from fx where k='student');
  v_prof uuid := (select v from fx where k='prof');
  v_new uuid := (select v from fx where k='new');
begin
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot approve a professor',
    format('select public.decide_professor(%L, true)', v_new));

  -- Not even another professor: this is the program admin's alone.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('nor can another professor',
    format('select public.decide_professor(%L, true)', v_new));

  -- And the pending account cannot wave itself through.
  perform pg_temp.act_as(v_new);
  perform pg_temp.must_refuse('nor the account itself',
    format('select public.decide_professor(%L, true)', v_new));
  perform pg_temp.act_as_service();
end $$;

-- The older guard still holds: a direct write pins the columns back rather
-- than raising, so this checks the value, not an error.
do $$
declare
  v_new uuid := (select v from fx where k='new');
begin
  perform pg_temp.act_as(v_new);
  update public.profiles set status = 'active' where id = v_new;
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('a pending account cannot set its own status',
    (select status = 'pending' from public.profiles where id = v_new));
end $$;

-- ---------------------------------------------------------------- approving

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  perform pg_temp.act_as(v_admin);

  select count(*) into n from public.professor_accounts where status = 'pending';
  perform pg_temp.must_be('the admin sees the waiting account', n >= 1);

  perform pg_temp.must_allow('the admin approves it',
    format('select public.decide_professor(%L, true)', v_new));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and it is active',
    (select status = 'active' from public.profiles where id = v_new));
  perform pg_temp.must_be('...recording who let them in',
    (select decided_by = v_admin and decided_at is not null
       from public.profiles where id = v_new));
end $$;

-- Turning down, and undoing it — an account rejected by mistake is otherwise
-- dead, and its owner can do nothing about it.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_new uuid := (select v from fx where k='new');
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin turns it down',
    format('select public.decide_professor(%L, false)', v_new));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is rejected',
    (select status = 'rejected' from public.profiles where id = v_new));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin can put it back',
    format('select public.decide_professor(%L, true)', v_new));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is active again',
    (select status = 'active' from public.profiles where id = v_new));
end $$;

-- Only professors go through approval at all.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_student uuid := (select v from fx where k='student');
  n int;
begin
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse('a student account is not an approval matter',
    format('select public.decide_professor(%L, false)', v_student));

  select count(*) into n from public.professor_accounts where id = v_student;
  perform pg_temp.must_be('...and does not appear in the console', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- A professor cannot browse the whole faculty list through the new view.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.professor_accounts where id = v_new;
  perform pg_temp.must_be('a professor cannot read another professor''s account', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
