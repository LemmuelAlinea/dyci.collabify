-- Do the ceilings hold, and do they let ordinary work through — rolled back.
--
--   node scripts/db.mjs supabase/tests/rate-limit.test.sql
--
-- Every limit is asserted twice: the last allowed action goes through, and the
-- next one is refused. A limit set to zero would pass the refusal half on its
-- own, and a limit that never fired would pass the allowance half — only the
-- pair says the number is where it is meant to be.

begin;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 52);
    return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_me uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_me, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-rate@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_me, 'Zz', 'Rate', 'zz-rate@example.test', 'student', 'active');

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values ('me', v_me);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------- the counter itself

do $$
declare
  v_me uuid := (select v from fx where k='me');
  n int;
begin
  perform pg_temp.act_as(v_me);

  -- Three allowed, the fourth refused.
  perform public.rate_limit('zz_test', 3, interval '1 hour', 'zz over');
  perform public.rate_limit('zz_test', 3, interval '1 hour', 'zz over');
  perform public.rate_limit('zz_test', 3, interval '1 hour', 'zz over');
  perform pg_temp.must_be('three of three go through', true);

  perform pg_temp.must_refuse('...and the fourth is refused',
    $sql$ select public.rate_limit('zz_test', 3, interval '1 hour', 'zz over') $sql$);

  perform pg_temp.act_as_service();
  select count into n from public.rate_limits where user_id = v_me and bucket = 'zz_test';
  -- The refusal raised, so its own increment rolled back with the statement.
  -- That is the documented behaviour, and it is why joining a class is limited
  -- inside `join_class` — which answers instead of raising — rather than here.
  perform pg_temp.must_be('a refused attempt leaves the count at the ceiling', n = 3);
end $$;

/**
 * The window reopens. Asserted by ageing the row rather than waiting an hour —
 * a test that sleeps is a test nobody runs.
 */
do $$
declare
  v_me uuid := (select v from fx where k='me');
  n int;
begin
  update public.rate_limits set window_start = now() - interval '2 hours'
   where user_id = v_me and bucket = 'zz_test';

  perform pg_temp.act_as(v_me);
  perform public.rate_limit('zz_test', 3, interval '1 hour', 'zz over');
  perform pg_temp.act_as_service();

  select count into n from public.rate_limits where user_id = v_me and bucket = 'zz_test';
  perform pg_temp.must_be('a lapsed window starts again at one', n = 1);
end $$;

-- Buckets are independent: filling one must not close another.
do $$
declare
  v_me uuid := (select v from fx where k='me');
begin
  perform pg_temp.act_as(v_me);
  perform public.rate_limit('zz_other', 1, interval '1 hour', 'zz other over');
  perform pg_temp.must_refuse('one bucket fills',
    $sql$ select public.rate_limit('zz_other', 1, interval '1 hour', 'zz other over') $sql$);
  -- ...and a different one is untouched
  perform public.rate_limit('zz_third', 5, interval '1 hour', 'zz third over');
  perform pg_temp.must_be('...and a different bucket still lets you through', true);
  perform pg_temp.act_as_service();
end $$;

-- The service role is not limited, or migrations could not run.
do $$
begin
  perform pg_temp.act_as_service();
  for i in 1..50 loop
    perform public.rate_limit('zz_service', 2, interval '1 hour', 'zz service over');
  end loop;
  perform pg_temp.must_be('the service role is never limited', true);
end $$;

-- Nobody may reach the table to raise their own allowance.
do $$
declare
  v_me uuid := (select v from fx where k='me');
begin
  perform pg_temp.act_as(v_me);
  perform pg_temp.must_refuse('a person cannot read the counter table',
    $sql$ select count(*) from public.rate_limits $sql$);
  perform pg_temp.must_refuse('...nor reset their own count',
    $sql$ update public.rate_limits set count = 0 where user_id = auth.uid() $sql$);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------ a real ceiling

/**
 * Guessing a class code, end to end and through the real RPC — the one limit
 * here that is about an attack rather than about load.
 *
 * Every guess below is wrong, which is the whole point: a wrong code returns a
 * verdict rather than raising, so the transaction commits and the attempt is
 * counted. A trigger on `class_members` could never have seen these.
 */
do $$
declare
  v_me uuid := (select v from fx where k='me');
  r jsonb;
  n int;
begin
  perform pg_temp.act_as(v_me);

  for i in 1..10 loop
    r := public.join_class('ZZ-NO-' || i);
    if r->>'result' <> 'not_found' then
      raise exception 'FAIL  guess % was answered %, expected not_found', i, r->>'result';
    end if;
  end loop;
  perform pg_temp.must_be('ten wrong codes are answered normally', true);

  r := public.join_class('ZZ-NO-11');
  perform pg_temp.must_be('...and the eleventh is refused outright',
    r->>'result' = 'too_many');

  perform pg_temp.act_as_service();
  select count into n from public.rate_limits
   where user_id = v_me and bucket = 'class_join';
  -- Ten, not eleven: `rate_limit_ok` swallows the refusal in an exception
  -- block, and that subtransaction takes its own increment back. The count
  -- therefore rests at the ceiling and every further guess is refused from
  -- there, which is the behaviour wanted — it cannot be pushed higher, and it
  -- cannot be walked back down.
  perform pg_temp.must_be('the counter rests at the ceiling', n = 10);

  -- Still refused a second time, so the cap holds rather than leaking one
  -- attempt per call.
  perform pg_temp.act_as(v_me);
  r := public.join_class('ZZ-NO-12');
  perform pg_temp.must_be('...and stays refused', r->>'result' = 'too_many');
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------- ordinary work passes

/**
 * The half that matters most. A limit a student meets while doing their
 * coursework is a bug, so this asserts the everyday volumes go through
 * untouched: a burst of comments, a handful of messages, a few claims.
 */
do $$
declare
  v_me uuid := (select v from fx where k='me');
begin
  perform pg_temp.act_as(v_me);

  for i in 1..25 loop
    perform public.rate_limit('task_comment', 30, interval '1 minute', 'zz over');
  end loop;
  perform pg_temp.must_be('25 comments in a minute is ordinary and passes', true);

  for i in 1..35 loop
    perform public.rate_limit('message_send', 40, interval '1 minute', 'zz over');
  end loop;
  perform pg_temp.must_be('35 messages in a minute passes', true);

  for i in 1..100 loop
    perform public.rate_limit('task_claim', 120, interval '1 minute', 'zz over');
  end loop;
  perform pg_temp.must_be('100 task claims in a minute passes', true);

  for i in 1..10 loop
    perform public.rate_limit('ai_generate_tasks_hour', 12, interval '1 hour', 'zz over');
  end loop;
  perform pg_temp.must_be('10 AI drafts in an hour passes', true);

  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- the triggers are on

do $$
declare
  n int;
begin
  select count(*) into n from pg_trigger
   where not tgisinternal and tgname like '%_rate_limit';
  perform pg_temp.must_be('every table with a ceiling has its trigger', n >= 10);

  select count(*) into n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where not t.tgisinternal
     and ns.nspname = 'storage'
     and t.tgname = 'storage_objects_rate_limit';
  perform pg_temp.must_be('uploads are limited where every bucket arrives', n = 1);
end $$;

rollback;
