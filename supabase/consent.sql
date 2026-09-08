-- Collabify — what a person agreed to, and when.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/consent.sql

/**
 * RA 10173 §3(b) wants consent that is "freely given, specific, informed" and
 * **evidenced**. Almost everything in Collabify is coursework, which §3(l)
 * makes sensitive personal information, so the evidence is not optional here
 * the way it might be for a mailing list.
 *
 * Two tables and one rule.
 *
 * `legal_versions` is what has been published. `consent_records` is who agreed
 * to what. A foreign key from the second to the first means consent to a
 * version that was never published is rejected by the database rather than
 * caught by a reviewer later.
 *
 * **The rule is append-only.** A row is never updated to point at a newer
 * version, and nothing may delete one. The whole value of the record is that
 * it still says what was agreed on the day it was agreed; a row that moves
 * with the document is a record of the present, which is exactly what nobody
 * needs. Withdrawal therefore stamps `withdrawn_at` through a function rather
 * than deleting anything, and re-consent writes a new row.
 *
 * What this deliberately is not:
 *
 *   - **Not a boolean on `profiles`.** That answers "did they" and not "to
 *     what", which is the only question that matters when a policy changes.
 *   - **Not IP-stamped.** `auth.audit_log_entries` already holds the address
 *     of every sign-in. A column here would make this the only table in
 *     `public.*` storing IP addresses, and the privacy policy would then have
 *     to say so — collecting more to prove you collect carefully.
 *
 * Referencing `auth.users` rather than `profiles` is deliberate too. On the
 * Google path there is no profile row when the box is ticked: the account
 * exists, the role does not yet, and `Onboarding` writes consent before the
 * profile upsert. `profiles` would fail that insert.
 */

begin;

-- ------------------------------------------------------------- what exists

create table if not exists public.legal_versions (
  document     text not null check (document in ('privacy', 'terms')),
  version      text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  effective_on date not null,
  /**
   * Whether this version changes what a person is agreeing to.
   *
   * A clearer sentence or a corrected typo is not material and must not ask a
   * whole cohort to agree again mid-term; a new recipient, a new purpose or a
   * new category of data is. Without this column the only safe response to any
   * edit would be to re-prompt everybody, which trains people to click through
   * the prompt — the same failure as a cookie banner on a site with no
   * cookies.
   */
  material     boolean not null default true,
  published_at timestamptz not null default now(),
  primary key (document, version)
);

alter table public.legal_versions enable row level security;

-- Readable by anyone, signed in or not: the register page shows the version
-- beside the checkbox, and a visitor deciding whether to register has not
-- signed in yet.
drop policy if exists legal_versions_read on public.legal_versions;
create policy legal_versions_read on public.legal_versions
  for select to anon, authenticated using (true);

-- Written only by a migration. No insert, update or delete policy exists, so
-- publishing a version is a deliberate act through the service role.
comment on table public.legal_versions is
  'Published versions of the legal documents. Written by migration only.';

-- ------------------------------------------------------------ who agreed

create table if not exists public.consent_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  document     text not null,
  version      text not null,
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz,
  /** Where it was ticked: 'register', 'onboarding', 're-consent'. */
  surface      text not null default 'register',
  foreign key (document, version)
    references public.legal_versions (document, version),
  unique (user_id, document, version)
);

create index if not exists consent_records_user_idx
  on public.consent_records (user_id, document, granted_at desc);

alter table public.consent_records enable row level security;

/**
 * Read your own, or everything if you are an admin.
 *
 * An admin needs this to answer "did this student consent, and to which
 * version" when somebody asks — which is the question the table exists for.
 */
drop policy if exists consent_records_select on public.consent_records;
create policy consent_records_select on public.consent_records
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists consent_records_insert on public.consent_records;
create policy consent_records_insert on public.consent_records
  for insert to authenticated
  with check (user_id = auth.uid());

/**
 * There is no update policy and no delete policy, for anybody, including
 * admins. That is the append-only rule, enforced where it cannot be argued
 * with. `withdraw_consent` below is the only way a row ever changes, and it is
 * `security definer` precisely because the caller has no such grant.
 */
revoke update, delete on public.consent_records from anon, authenticated;

comment on table public.consent_records is
  'Append-only. One row per person per document version. Never updated to point at a newer version.';

-- --------------------------------------------------------------- writing it

/**
 * Record consent for the caller.
 *
 * Used by the Google path, where the box is ticked at onboarding rather than
 * at signup, and by the re-consent gate when a material version lands.
 *
 * `on conflict do nothing` because a double submit is a double submit, not a
 * second agreement — and because the unique key is what makes that safe.
 */
create or replace function public.record_consent(
  p_document text,
  p_version  text,
  p_surface  text default 'onboarding'
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before recording consent.' using errcode = 'P0001';
  end if;

  insert into public.consent_records (user_id, document, version, surface)
  values (auth.uid(), p_document, p_version, p_surface)
  on conflict (user_id, document, version) do nothing;
end;
$$;

/**
 * Withdraw consent to a document.
 *
 * Stamps the newest live row rather than deleting it, so the record still says
 * that consent was given and when it ended. Withdrawal does not undo the
 * processing that already happened, and it does not delete anything — erasure
 * is a separate request, which is why the two are different rows in
 * `privacy_requests`.
 */
create or replace function public.withdraw_consent(p_document text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'P0001';
  end if;

  update public.consent_records
     set withdrawn_at = now()
   where id = (
     select id from public.consent_records
      where user_id = auth.uid()
        and document = p_document
        and withdrawn_at is null
      order by granted_at desc
      limit 1
   );
end;
$$;

revoke all on function public.withdraw_consent(text) from public;
grant execute on function public.withdraw_consent(text) to authenticated;

-- --------------------------------------------------------- the signup path

/**
 * `handle_new_user`, redefined as a superset of the one in `schema.sql`.
 *
 * ⚠ **This function is defined in two files.** `schema.sql` has the original;
 * this is the same body plus the consent insert. `scripts/schema-drift.mjs`
 * will report the double definition, and that is expected — but the order
 * matters: whichever file runs last wins, so running `schema.sql` after this
 * one silently stops recording consent at signup, and nothing would fail. The
 * comment in `schema.sql` points back here for the same reason.
 *
 * The consent versions ride in on `raw_user_meta_data`, put there by
 * `signUpWithEmail` from `consentVersions()` in `src/lib/legal/consent.ts`. At
 * this moment there is no session, so the RLS insert policy could not be
 * satisfied by the client — the trigger is `security definer` and writes it in
 * the same transaction as the account itself. Consent and account therefore
 * both exist or neither does.
 *
 * A version the database has never published raises rather than being skipped.
 * Silently unrecorded consent is the one failure this whole file exists to
 * prevent, and the message names the fix.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  resolved_role public.user_role;
  doc text;
  ver text;
begin
  /**
   * Consent first, and outside the role check.
   *
   * A Google account arrives with no role and returns early below, but it can
   * still carry consent versions if it ever comes through a path that collects
   * them. Putting this after the early return would make that silently do
   * nothing.
   */
  foreach doc in array array['privacy', 'terms'] loop
    ver := nullif(new.raw_user_meta_data ->> ('consent_' || doc), '');
    if ver is not null then
      if not exists (
        select 1 from public.legal_versions
         where document = doc and version = ver
      ) then
        raise exception
          'Consent to unpublished % version %. Add it to legal_versions in supabase/consent.sql.',
          doc, ver
          using errcode = 'foreign_key_violation';
      end if;

      insert into public.consent_records (user_id, document, version, surface)
      values (new.id, doc, ver, 'register')
      on conflict (user_id, document, version) do nothing;
    end if;
  end loop;

  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles (id, email, first_name, middle_name, last_name, role, status, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- published

/**
 * Publishing a version.
 *
 * Add a row here whenever `version` changes in `src/lib/legal/privacy.ts` or
 * `terms.ts`, in the same commit. Consent to a version missing from this table
 * is refused, so forgetting breaks registration on the first attempt rather
 * than quietly recording nothing — which is the trade this file wants.
 *
 * Set `material` to false for a correction or a clearer sentence, true for a
 * change to what is being agreed to.
 */
insert into public.legal_versions (document, version, effective_on, material)
values
  ('privacy', '2026-09-08', '2026-09-08', true),
  ('terms',   '2026-09-08', '2026-09-08', true)
on conflict (document, version) do nothing;

commit;
