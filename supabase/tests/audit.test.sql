-- The audit log — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/audit.test.sql
--
-- Half of these assert what the log does NOT hold. A log that quietly widens
-- what an admin can see is worse than no log, so the boundary is checked as
-- carefully as the contents.

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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_admin uuid; v_student uuid; v_prof uuid; v_new uuid; v_class uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_student from public.profiles where role = 'student' limit 1;
  select id into v_prof from public.profiles where role = 'professor' limit 1;
  -- Live, and ordered. An unordered pick handed back an already-archived
  -- class, and setting archived_at on one that is already set is not a
  -- transition — so the trigger correctly logged nothing and the test blamed
  -- the trigger.
  select id into v_class from public.classes
   where archived_at is null order by created_at limit 1;

  v_new := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-audit@example.test', '', now(), now());

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('admin', v_admin), ('student', v_student), ('prof', v_prof),
    ('new', v_new), ('class', v_class);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------ what it holds

do $$
declare
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_new, 'Zz', 'Audit', 'zz-audit@example.test', 'professor', 'pending');

  select count(*) into n from public.audit_events
   where action = 'account_created' and subject_id = v_new;
  perform pg_temp.must_be('a new account is recorded', n = 1);

  perform pg_temp.must_be('...with the name it had at the time',
    (select subject_label = 'Zz Audit' from public.audit_events
      where action = 'account_created' and subject_id = v_new));
end $$;

-- An approval is a status change, and the log watches the column rather than
-- the console — so the CLI and a hand-written update land here too.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  perform pg_temp.act_as(v_admin);
  perform public.decide_professor(v_new, true);
  perform pg_temp.act_as_service();

  select count(*) into n from public.audit_events
   where action = 'status_changed' and subject_id = v_new
     and before_value = 'pending' and after_value = 'active';
  perform pg_temp.must_be('an approval is recorded, before and after', n = 1);

  perform pg_temp.must_be('...naming who did it',
    (select actor_id = v_admin from public.audit_events
      where action = 'status_changed' and subject_id = v_new limit 1));
end $$;

-- A change the older guard pins back never happened, so it is not logged.
do $$
declare
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  perform pg_temp.act_as(v_new);
  update public.profiles set role = 'admin' where id = v_new;
  perform pg_temp.act_as_service();

  select count(*) into n from public.audit_events
   where action = 'role_changed' and subject_id = v_new;
  perform pg_temp.must_be('a blocked promotion is not logged as one', n = 0);
  perform pg_temp.must_be('...and the role really did not change',
    (select role = 'professor' from public.profiles where id = v_new));
end $$;

-- Class lifecycle, metadata only.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
  before_archived int;
  before_restored int;
begin
  -- Counted as a *change*, not a total. The log is append-only and this class
  -- is a real one, so it already carries whatever was done to it before today;
  -- asserting the total is 1 was really asserting the class had no history,
  -- which stopped being true the moment one was archived through the UI.
  select count(*) into before_archived from public.audit_events
   where action = 'class_archived' and class_id = v_class;
  select count(*) into before_restored from public.audit_events
   where action = 'class_restored' and class_id = v_class;

  update public.classes set archived_at = now() where id = v_class;
  select count(*) into n from public.audit_events
   where action = 'class_archived' and class_id = v_class;
  perform pg_temp.must_be('archiving a class is recorded', n = before_archived + 1);

  update public.classes set archived_at = null where id = v_class;
  select count(*) into n from public.audit_events
   where action = 'class_restored' and class_id = v_class;
  perform pg_temp.must_be('...and so is putting it back', n = before_restored + 1);

  -- Every entry, not "the" entry: a class with history has more than one, and
  -- a subquery expecting a single row simply raised. Asserting all of them
  -- carry a label is both deterministic and the stronger claim.
  perform pg_temp.must_be('every entry carries the class label, not its contents',
    not exists (
      select 1 from public.audit_events
       where action = 'class_archived' and class_id = v_class
         and coalesce(class_label, '') = ''
    ));
end $$;

-- --------------------------------------------------- what it must not hold

do $$
declare n int;
begin
  -- The whole point of the boundary: no academic content reaches this table.
  select count(*) into n from public.audit_events
   where action::text like '%task%' or action::text like '%project%'
      or action::text like '%comment%' or action::text like '%grade%'
      or action::text like '%result%' or action::text like '%file%';
  perform pg_temp.must_be('no action names academic work', n = 0);

  select count(*) into n
    from pg_enum where enumtypid = 'public.audit_action'::regtype
     and (enumlabel like '%task%' or enumlabel like '%project%'
       or enumlabel like '%submission%' or enumlabel like '%result%');
  perform pg_temp.must_be('...and none can, the enum has no such label', n = 0);
end $$;

-- ------------------------------------------------------------- who reads it

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_student uuid := (select v from fx where k='student');
  v_prof uuid := (select v from fx where k='prof');
  v_new uuid := (select v from fx where k='new');
  n int;
begin
  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.audit_events;
  perform pg_temp.must_be('the admin reads the log', n > 0);

  select count(*) into n from public.audit_log where actor_name is not null;
  perform pg_temp.must_be('...through the view, with the actor named', n > 0);

  perform pg_temp.act_as(v_student);
  select count(*) into n from public.audit_events;
  perform pg_temp.must_be('a student reads nothing of it', n = 0);

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.audit_events;
  perform pg_temp.must_be('a professor reads nothing of it', n = 0);

  -- Decided with the user: the subject does not see entries about themselves.
  perform pg_temp.act_as(v_new);
  select count(*) into n from public.audit_events where subject_id = v_new;
  perform pg_temp.must_be('nor does the person an entry is about', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ immutability

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_student uuid := (select v from fx where k='student');
  target uuid;
begin
  select id into target from public.audit_events limit 1;

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot forge an entry',
    'insert into public.audit_events (action, after_value) values (''role_changed'', ''admin'')');

  -- Not even the admin. A log its own subject can rewrite is worth nothing.
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse('the admin cannot forge one either',
    'insert into public.audit_events (action, after_value) values (''role_changed'', ''admin'')');

  update public.audit_events set after_value = 'tampered' where id = target;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the admin cannot edit an entry',
    (select after_value <> 'tampered' from public.audit_events where id = target));

  perform pg_temp.act_as(v_admin);
  delete from public.audit_events where id = target;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...nor delete one',
    exists (select 1 from public.audit_events where id = target));
end $$;

-- ------------------------------------------- the preferences read is closed

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_student uuid := (select v from fx where k='student');
  n int;
begin
  insert into public.notification_prefs (user_id) values (v_student)
  on conflict (user_id) do nothing;

  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.notification_prefs where user_id = v_student;
  perform pg_temp.must_be('an admin no longer reads somebody''s notification settings', n = 0);

  perform pg_temp.act_as(v_student);
  select count(*) into n from public.notification_prefs where user_id = v_student;
  perform pg_temp.must_be('...and the owner still reads their own', n = 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
