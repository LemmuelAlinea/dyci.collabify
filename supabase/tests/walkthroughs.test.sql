-- supabase/tests/walkthroughs.test.sql
-- First-run walkthroughs: own-row access, the check constraints, rows that stay finished,
-- the grants and the one-time backfill. Rolls back; nothing survives.
--
-- The file under test must already be applied, or spliced in after the opening begin and at
-- the reload marker below (the dry run in the task plan does that):
--   node scripts/db.mjs supabase/tests/walkthroughs.test.sql
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

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

-- Seed: v_a and v_b walk through flows, v_later signed in before the rollout and has no rows.
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, last_sign_in_at)
  values
    ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'zz-wt-a@example.test', '', now(), now(), null),
    ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'zz-wt-b@example.test', '', now(), now(), null),
    ('aaaaaaaa-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'zz-wt-later@example.test', '', now(), now(), now());

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'zz-wt-a@example.test',     'Zz', 'Wta',     'student', 'active', false, false),
    ('aaaaaaaa-0000-4000-8000-000000000002', 'zz-wt-b@example.test',     'Zz', 'Wtb',     'member',  'active', false, false),
    ('aaaaaaaa-0000-4000-8000-000000000003', 'zz-wt-later@example.test', 'Zz', 'Wtlater', 'member',  'active', true,  true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;
end;
$$;

-- @reload

do $$
declare
  v_a     uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_b     uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_later uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  n       int;
  s       text;
  a       text[];
begin
  -- The backfill ran on the reload above and must not have touched v_later.
  perform pg_temp.must_be('the backfill runs once',
    not exists (select 1 from public.user_walkthroughs where user_id = v_later));

  perform pg_temp.act_as(v_a);
  insert into public.user_walkthroughs (user_id, flow, status, done_steps)
  values (v_a, 'account', 'active', array['welcome']);
  select status, done_steps into s, a
    from public.user_walkthroughs where user_id = v_a and flow = 'account';
  perform pg_temp.must_be('a person saves and reads their own row',
    s = 'active' and a = array['welcome']);

  perform pg_temp.act_as(v_b);
  select count(*) into n from public.user_walkthroughs where user_id = v_a;
  perform pg_temp.must_be('another person''s row is invisible', n = 0);

  perform pg_temp.must_refuse_with('saving a row for another person is refused',
    format('insert into public.user_walkthroughs (user_id, flow) values (%L, %L)', v_a, 'student'),
    'row-level security');

  update public.user_walkthroughs set done_steps = array['hijack'] where user_id = v_a;
  get diagnostics n = row_count;
  perform pg_temp.must_be('updating another person''s row changes nothing', n = 0);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_with('an unknown flow is refused',
    format('insert into public.user_walkthroughs (user_id, flow) values (%L, %L)', v_a, 'admin'),
    'check');
  perform pg_temp.must_refuse_with('an unknown status is refused',
    format('insert into public.user_walkthroughs (user_id, flow, status) values (%L, %L, %L)',
           v_a, 'student', 'sleeping'),
    'check');

  -- Skipped stays skipped; done_steps stays writable.
  insert into public.user_walkthroughs (user_id, flow, status) values (v_a, 'student', 'skipped');
  update public.user_walkthroughs set status = 'active', done_steps = array['one']
    where user_id = v_a and flow = 'student';
  select status, done_steps into s, a
    from public.user_walkthroughs where user_id = v_a and flow = 'student';
  perform pg_temp.must_be('a skipped row stays skipped', s = 'skipped' and a = array['one']);

  insert into public.user_walkthroughs (user_id, flow, status) values (v_a, 'member', 'done');
  update public.user_walkthroughs set status = 'paused'
    where user_id = v_a and flow = 'member';
  select status into s from public.user_walkthroughs where user_id = v_a and flow = 'member';
  perform pg_temp.must_be('a done row stays done', s = 'done');

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('anon has no access',
    not has_table_privilege('anon', 'public.user_walkthroughs', 'select'));
  perform pg_temp.must_be('people cannot delete rows',
    not has_table_privilege('authenticated', 'public.user_walkthroughs', 'delete'));
end;
$$;

rollback;
