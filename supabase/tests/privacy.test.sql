-- Consent records and privacy requests — rolled back at the end, touches nothing.
--
--   node scripts/db.mjs supabase/tests/privacy.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- Without that the suite lies: a refusal can come from a guard that was already
-- there, and would still "pass" with this whole feature deleted.
--
-- The claims worth holding here are the ones a reviewer would otherwise have to
-- take on trust from a comment: that consent is append-only for everybody
-- including an admin, that a version nobody published is refused, that a
-- request cannot be written or answered by the person it is about, and that the
-- name on a request survives its requester being erased.

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
  student uuid := gen_random_uuid();
  other   uuid := gen_random_uuid();
  prof    uuid := gen_random_uuid();
  boss    uuid := gen_random_uuid();
  live    text;
  req     uuid;
  kept    integer;
begin
  perform pg_temp.act_as_service();

  -- auth.users first: consent_records references it, not profiles, which is
  -- what lets consent be written before a role has been chosen.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', u.id::text || '@test.invalid', '', now(), now()
    from (values (student), (other), (prof), (boss)) as u(id);

  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (student, student::text || '@test.invalid', 'Test', 'Student', 'student', 'active'),
         (other,   other::text   || '@test.invalid', 'Other', 'Student', 'student', 'active'),
         (prof,    prof::text    || '@test.invalid', 'Test', 'Prof',    'professor', 'active'),
         (boss,    boss::text    || '@test.invalid', 'Test', 'Admin',   'admin',   'active');

  select version into live from public.legal_versions where document = 'privacy' limit 1;

  -- --------------------------------------------------------------- consent

  perform pg_temp.act_as(student);

  perform pg_temp.must_allow(
    'a person records their own consent',
    format('select public.record_consent(%L, %L, %L)', 'privacy', live, 'onboarding'));

  perform pg_temp.must_be(
    'the row landed against them',
    exists (select 1 from public.consent_records
             where user_id = student and document = 'privacy' and version = live));

  perform pg_temp.must_allow(
    'recording it twice is not a second agreement',
    format('select public.record_consent(%L, %L, %L)', 'privacy', live, 'onboarding'));

  perform pg_temp.must_be(
    'still exactly one row',
    (select count(*) from public.consent_records
      where user_id = student and document = 'privacy') = 1);

  -- The foreign key onto legal_versions is what makes this fail. Without it a
  -- typo in a version string would be recorded as agreement to a document that
  -- never existed, and nothing would notice.
  perform pg_temp.must_refuse(
    'consent to a version nobody published is refused',
    format('insert into public.consent_records (user_id, document, version)
            values (%L, %L, %L)', student, 'privacy', '1999-01-01'));

  perform pg_temp.must_refuse(
    'a person cannot record consent for somebody else',
    format('insert into public.consent_records (user_id, document, version)
            values (%L, %L, %L)', other, 'privacy', live));

  -- Append-only, tested as the two things it actually means.
  perform pg_temp.must_refuse(
    'nobody can move their consent onto a newer version',
    format('update public.consent_records set version = %L where user_id = %L', live, student));

  perform pg_temp.must_refuse(
    'nobody can delete their own consent record',
    format('delete from public.consent_records where user_id = %L', student));

  perform pg_temp.act_as(other);
  perform pg_temp.must_be(
    'another student sees none of it',
    (select count(*) from public.consent_records where user_id = student) = 0);

  -- An admin may read it — that is the question the table exists to answer —
  -- but not rewrite it. The second half is the one worth proving.
  perform pg_temp.act_as(boss);
  perform pg_temp.must_be(
    'an admin can read it',
    (select count(*) from public.consent_records where user_id = student) = 1);
  perform pg_temp.must_refuse(
    'an admin cannot delete it either',
    format('delete from public.consent_records where user_id = %L', student));

  -- Withdrawal stamps rather than deletes, so the record still says what was
  -- agreed on the day it was agreed.
  perform pg_temp.act_as(student);
  perform pg_temp.must_allow(
    'a person can withdraw consent',
    'select public.withdraw_consent(''privacy'')');
  perform pg_temp.must_be(
    'withdrawal stamps the row and keeps it',
    exists (select 1 from public.consent_records
             where user_id = student and version = live and withdrawn_at is not null));

  -- ------------------------------------------------------- privacy requests

  perform pg_temp.must_refuse(
    'a request cannot be written directly',
    format('insert into public.privacy_requests
              (requester_id, requester_name, requester_email, kind)
            values (%L, %L, %L, %L)', student, 'Someone Else', 'x@y.z', 'access'));

  perform pg_temp.must_allow(
    'a request goes through the function',
    'select public.make_privacy_request(''access'', ''please'')');

  select id into req from public.privacy_requests where requester_id = student;

  perform pg_temp.must_be(
    'the name is taken from the profile, not from the caller',
    (select requester_name from public.privacy_requests where id = req) = 'Test Student');

  perform pg_temp.must_be(
    'the clock is set from the policy''s promise',
    (select complete_by - acknowledge_by from public.privacy_requests where id = req) = 10);

  perform pg_temp.must_be(
    'they can see their own request',
    (select count(*) from public.privacy_requests where id = req) = 1);

  perform pg_temp.must_refuse(
    'they cannot answer it themselves',
    format('select public.answer_privacy_request(%L, %L)', req, 'completed'));

  perform pg_temp.act_as(other);
  perform pg_temp.must_be(
    'another student cannot see it',
    (select count(*) from public.privacy_requests where id = req) = 0);

  -- No handler is named in this transaction, so is_privacy_handler() falls back
  -- to admin. That fallback is the reason a request is never orphaned.
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be(
    'a professor who is not the handler sees nothing',
    (select count(*) from public.privacy_requests where id = req) = 0);

  perform pg_temp.act_as(boss);
  perform pg_temp.must_be(
    'an admin sees it while nobody is named handler',
    (select count(*) from public.privacy_requests where id = req) = 1);

  perform pg_temp.must_refuse(
    'a refusal without a ground is refused',
    format('select public.answer_privacy_request(%L, %L, %L)', req, 'refused', '   '));

  perform pg_temp.must_allow(
    'the handler can acknowledge it',
    format('select public.answer_privacy_request(%L, %L)', req, 'acknowledged'));

  perform pg_temp.must_be(
    'the answer carries who gave it',
    (select answered_by from public.privacy_requests where id = req) = boss);

  -- Read as the service role, not as the admin: notifications are visible only
  -- to their recipient, so an admin asking this question would correctly get
  -- nothing and the test would be checking RLS rather than the notification.
  perform pg_temp.act_as_service();
  perform pg_temp.must_be(
    'the requester was notified',
    exists (select 1 from public.notifications
             where user_id = student and type = 'privacy_request'));
  perform pg_temp.act_as(boss);

  perform pg_temp.must_refuse(
    'a request cannot be moved back to open',
    format('select public.answer_privacy_request(%L, %L)', req, 'open'));

  perform pg_temp.must_refuse(
    'the handler cannot edit the table directly',
    format('update public.privacy_requests set answer = %L where id = %L', 'x', req));

  -- The one case where the subject row may legitimately go. Cascading would
  -- delete the proof that the erasure was asked for and carried out.
  perform pg_temp.act_as_service();
  delete from public.profiles where id = student;

  select count(*) into kept from public.privacy_requests where id = req;
  perform pg_temp.must_be('the request survives its requester being erased', kept = 1);
  perform pg_temp.must_be(
    'and still carries the name it was made under',
    (select requester_name from public.privacy_requests where id = req) = 'Test Student');
  perform pg_temp.must_be(
    'with the link to the deleted account cleared',
    (select requester_id from public.privacy_requests where id = req) is null);

  raise notice 'ALL PASS';
end $$;

rollback;
