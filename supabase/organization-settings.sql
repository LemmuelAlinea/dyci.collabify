-- Collabify — organization settings: four school-wide values the admin changes from one page.
--
--   node scripts/db.mjs supabase/organization-settings.sql supabase/anon-lockdown.sql
--
-- Spec: docs/superpowers/specs/2026-11-15-organization-settings-design.md
--
-- One row holds them: how many days without person-made task events before a project counts
-- as quiet, how many days the trash keeps items, whether a new work project starts Private or
-- Workspace, and the email domain the CSV import accepts. The defaults are the values fixed in
-- code before this file (14 days, 30 days, Private, dyci.edu.ph), so nothing changes until an
-- admin saves.
--
-- Anyone signed in reads the row (directly or through the four org_* helpers). Nobody writes it
-- directly: there is no write policy and no write grant. Only an active admin changes it, through
-- set_organization_settings, which locks the row, refuses a value out of range or a malformed
-- domain, and writes one org_setting_changed audit row per value that actually changed.
--
-- admin_trash_purge_preview counts what purge_trash would delete if the trash kept items for
-- p_days, so the admin sees the cost of shortening it before saving.
--
-- Runs after notice-audience.sql and before anon-lockdown.sql. This task redefines nothing an
-- earlier file owns.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it. So it commits on its own
-- first, as offices.sql does.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'org_setting_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- the domain check

/**
 * A bare domain: lower case, labels of letters, digits and hyphens that neither start nor end
 * with a hyphen, at least one dot, 4 to 253 characters. Used by the table check and the setter.
 */
create or replace function public.org_domain_valid(p_domain text)
returns boolean language sql immutable set search_path = public as $$
  select p_domain is not null
     and char_length(p_domain) between 4 and 253
     and p_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$';
$$;

-- ---------------------------------------------------------------- the row

create table if not exists public.organization_settings (
  id                     boolean primary key default true,
  quiet_days             int not null default 14,
  trash_retention_days   int not null default 30,
  new_project_visibility text not null default 'private',
  school_email_domain    text not null default 'dyci.edu.ph',
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null
);

alter table public.organization_settings
  drop constraint if exists organization_settings_one_row;
alter table public.organization_settings
  add constraint organization_settings_one_row check (id);

alter table public.organization_settings
  drop constraint if exists organization_settings_quiet_days;
alter table public.organization_settings
  add constraint organization_settings_quiet_days check (quiet_days between 3 and 90);

alter table public.organization_settings
  drop constraint if exists organization_settings_trash_retention_days;
alter table public.organization_settings
  add constraint organization_settings_trash_retention_days
  check (trash_retention_days between 7 and 365);

alter table public.organization_settings
  drop constraint if exists organization_settings_new_project_visibility;
alter table public.organization_settings
  add constraint organization_settings_new_project_visibility
  check (new_project_visibility in ('private', 'workspace'));

alter table public.organization_settings
  drop constraint if exists organization_settings_school_email_domain;
alter table public.organization_settings
  add constraint organization_settings_school_email_domain
  check (public.org_domain_valid(school_email_domain));

insert into public.organization_settings (id) values (true) on conflict (id) do nothing;

alter table public.organization_settings enable row level security;

drop policy if exists organization_settings_read on public.organization_settings;
create policy organization_settings_read on public.organization_settings
  for select to authenticated using (true);

-- Signed-out visitors never read it, and nobody signed in writes it directly.
revoke all on table public.organization_settings from public, anon, authenticated;
grant select on table public.organization_settings to authenticated;

-- ---------------------------------------------------------------- read helpers

-- Each falls back to the default should the row ever be missing.

create or replace function public.org_quiet_days()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select quiet_days from public.organization_settings where id), 14);
$$;

create or replace function public.org_trash_retention_days()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select trash_retention_days from public.organization_settings where id), 30);
$$;

create or replace function public.org_new_project_visibility()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select new_project_visibility from public.organization_settings where id),
                  'private');
$$;

create or replace function public.org_school_email_domain()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select school_email_domain from public.organization_settings where id),
                  'dyci.edu.ph');
$$;

-- ---------------------------------------------------------------- the setter

-- The active-admin check is office_admin_reads() from offices.sql: is_admin() checks the role
-- only, so a pending or rejected admin account changes nothing here. An early draft of this
-- file had its own copy, org_settings_admin(); it is dropped.
drop function if exists public.org_settings_admin();

/**
 * Saves the four settings. A null leaves that value as it is, so the page can send only what
 * changed. The domain is trimmed and lower-cased before it is checked.
 *
 * The row is locked before it is read, so when two admins save at once the second waits, then
 * compares against the first's values: its audit rows name only what it actually changed, and
 * a value it left alone keeps the first's. A call that changes nothing writes nothing.
 */
create or replace function public.set_organization_settings(
  p_quiet_days int, p_trash_retention_days int,
  p_new_project_visibility text, p_school_email_domain text)
returns public.organization_settings
language plpgsql security definer set search_path = public as $$
declare
  old    public.organization_settings;
  r      public.organization_settings;
  v_quiet  int;
  v_trash  int;
  v_vis    text;
  v_domain text;
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can change organization settings.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.organization_settings (id) values (true) on conflict (id) do nothing;
  select * into old from public.organization_settings where id for update;

  v_quiet  := coalesce(p_quiet_days, old.quiet_days);
  v_trash  := coalesce(p_trash_retention_days, old.trash_retention_days);
  v_vis    := coalesce(p_new_project_visibility, old.new_project_visibility);
  v_domain := coalesce(lower(btrim(p_school_email_domain, E' \t\r\n')), old.school_email_domain);

  if v_quiet not between 3 and 90 then
    raise exception 'Quiet after takes 3 to 90 days. Enter a number in that range.'
      using errcode = 'check_violation';
  end if;
  if v_trash not between 7 and 365 then
    raise exception 'Trash keeps items for 7 to 365 days. Enter a number in that range.'
      using errcode = 'check_violation';
  end if;
  if v_vis not in ('private', 'workspace') then
    raise exception 'New projects start Private or Workspace. Choose one of them.'
      using errcode = 'check_violation';
  end if;
  if not public.org_domain_valid(v_domain) then
    raise exception 'Enter a domain like dyci.edu.ph, with no @ and no spaces.'
      using errcode = 'check_violation';
  end if;

  if v_quiet = old.quiet_days and v_trash = old.trash_retention_days
     and v_vis = old.new_project_visibility and v_domain = old.school_email_domain then
    return old;
  end if;

  update public.organization_settings
     set quiet_days = v_quiet,
         trash_retention_days = v_trash,
         new_project_visibility = v_vis,
         school_email_domain = v_domain,
         updated_at = now(),
         updated_by = auth.uid()
   where id
  returning * into r;

  insert into public.audit_events (action, actor_id, subject_id, subject_label,
                                   before_value, after_value)
  select 'org_setting_changed', auth.uid(), null, c.label, c.before, c.after
    from (values
      ('Quiet after',
       old.quiet_days || ' days', r.quiet_days || ' days',
       old.quiet_days <> r.quiet_days),
      ('Trash keeps items',
       old.trash_retention_days || ' days', r.trash_retention_days || ' days',
       old.trash_retention_days <> r.trash_retention_days),
      ('New projects start',
       initcap(old.new_project_visibility), initcap(r.new_project_visibility),
       old.new_project_visibility <> r.new_project_visibility),
      ('School email domain',
       old.school_email_domain, r.school_email_domain,
       old.school_email_domain <> r.school_email_domain)
    ) as c(label, before, after, changed)
   where c.changed;

  return r;
end;
$$;

-- ---------------------------------------------------------------- the purge preview

/**
 * How many items purge_trash would delete tonight if the trash kept items for p_days. Counts
 * only, for an active admin only.
 *
 * It mirrors purge_trash (final owner archive-page.sql): the four plain deletes (draft files,
 * task files, teaching resources, discussions) count every row trashed before the cut-off. The
 * archive rows count only when purge_trash would delete them: it puts back a row nobody trashed,
 * and deletes the rest as whoever trashed it, putting it back when they could not delete it by
 * hand. So each is asked archive_trash_block as its trasher, the check delete_trashed_item makes
 * first, and the admin's own claims are restored straight after.
 */
create or replace function public.admin_trash_purge_preview(p_days int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_before timestamptz;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  n        int;
  x        int := 0;
  r        record;
  blocked  text;
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can preview the trash clean-up.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days not between 7 and 365 then
    raise exception 'Trash keeps items for 7 to 365 days. Enter a number in that range.'
      using errcode = 'check_violation';
  end if;

  v_before := now() - make_interval(days => p_days);

  n := (select count(*) from public.general_draft_files where trashed_at < v_before)
     + (select count(*) from public.general_task_files where trashed_at < v_before)
     + (select count(*) from public.teaching_resources where trashed_at < v_before)
     + (select count(*) from public.general_discussions where trashed_at < v_before);

  for r in select * from public.archive_trash_rows(null, v_before) loop
    continue when r.trashed_by is null;
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.trashed_by, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', r.trashed_by::text, true);
      blocked := public.archive_trash_block(r.kind, r.id, true);
    exception when others then
      blocked := sqlerrm;
    end;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    if blocked is null then
      x := x + 1;
    end if;
  end loop;

  return n + x;
end;
$$;

-- ---------------------------------------------------------------- grants

-- Internal: the domain check.
revoke all on function public.org_domain_valid(text) from public, anon, authenticated;

revoke all on function public.org_quiet_days() from public, anon;
revoke all on function public.org_trash_retention_days() from public, anon;
revoke all on function public.org_new_project_visibility() from public, anon;
revoke all on function public.org_school_email_domain() from public, anon;
revoke all on function public.set_organization_settings(int, int, text, text) from public, anon;
revoke all on function public.admin_trash_purge_preview(int) from public, anon;

grant execute on function public.org_quiet_days() to authenticated;
grant execute on function public.org_trash_retention_days() to authenticated;
grant execute on function public.org_new_project_visibility() to authenticated;
grant execute on function public.org_school_email_domain() to authenticated;
grant execute on function public.set_organization_settings(int, int, text, text) to authenticated;
grant execute on function public.admin_trash_purge_preview(int) to authenticated;

commit;
