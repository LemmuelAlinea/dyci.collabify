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
-- admin_trash_purge_preview counts the trashed items past the limit if the trash kept items for
-- p_days, an upper bound on what purge_trash would delete, so the admin sees the cost of
-- shortening it before saving.
--
-- The rules that used fixed values read the helpers instead. This file is the final owner of
-- office_attention_rows (first written in offices.sql), list_my_trash (work-task-handoff.sql),
-- purge_trash (archive-page.sql) and overwrite_bulk_account (company-accounts.sql), each with only
-- its fixed value replaced, and of the general_projects_org_visibility trigger.
--
-- Runs after notice-audience.sql and before anon-lockdown.sql. Re-running offices.sql, trash.sql,
-- archive-page.sql, project-stakeholders.sql, work-task-handoff.sql or company-accounts.sql
-- means re-running this file afterwards, then anon-lockdown.sql.
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
-- only, so a pending or rejected admin account changes nothing here.

-- Drops the retired org_settings_admin().
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
 * How many trashed items are past the limit if the trash kept items for p_days: an upper bound
 * on what purge_trash would delete tonight, so the page says "up to N items". Counts only, for
 * an active admin only, and it never acts as anyone else.
 *
 * It uses purge_trash's date predicates only (final owner archive-page.sql), with p_days in place
 * of 30: the four plain deletes (draft files, task files, teaching resources, discussions) and
 * archive_trash_rows, each trashed before the cut-off. purge_trash puts back some archive rows
 * instead of deleting them (nobody trashed it, or whoever did cannot delete it by hand), so the
 * real count can be lower, never higher.
 */
create or replace function public.admin_trash_purge_preview(p_days int)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  v_before timestamptz;
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

  return (select count(*) from public.general_draft_files where trashed_at < v_before)
       + (select count(*) from public.general_task_files where trashed_at < v_before)
       + (select count(*) from public.teaching_resources where trashed_at < v_before)
       + (select count(*) from public.general_discussions where trashed_at < v_before)
       + (select count(*) from public.archive_trash_rows(null, v_before));
end;
$$;

-- ---------------------------------------------------------------- the rules that read them

-- Each of the four below is the live pg_get_functiondef of its last owner with only the fixed
-- value replaced by its helper. Signature, security, search path and grants stay as they were:
-- create or replace keeps the grants.

-- Quiet: office_attention_rows() from offices.sql. It is language sql, so it cannot read a
-- helper defined after offices.sql. It is redefined here, not edited there.
CREATE OR REPLACE FUNCTION public.office_attention_rows()
 RETURNS TABLE(project_id uuid, project_name text, space_name text, office_id uuid, office_name text, no_pm boolean, quiet_since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with running as (
    select r.id, r.name, r.space_id, r.created_at
      from public.office_running_projects() r
  ),
  flagged as (
    select r.id, r.name, r.space_id,
           not exists (select 1 from public.general_members gm
                         join public.profiles pr on pr.id = gm.user_id
                        where gm.project_id = r.id and gm.role = 'pm'
                          and pr.status = 'active' and pr.can_manage_projects) as no_pm,
           coalesce((select max(e.created_at) from public.general_task_events e
                      where e.project_id = r.id and e.actor_id is not null),
                    r.created_at) as last_at,
           exists (select 1 from public.general_tasks t
                    where t.project_id = r.id and t.trashed_at is null
                      and t.archived_at is null and t.status <> 'done') as open_work,
           exists (select 1 from public.general_tasks t
                    where t.project_id = r.id and t.trashed_at is null
                      and t.archived_at is null) as any_work
      from running r
  ),
  marked as (
    select f.*,
           case when f.last_at < now() - make_interval(days => public.org_quiet_days())
                     and (f.open_work or not f.any_work)
                then f.last_at end as quiet_at
      from flagged f
  )
  select m.id, m.name, s.name, o.id, coalesce(o.name, ''), m.no_pm, m.quiet_at
    from marked m
    join public.general_spaces s on s.id = m.space_id
    left join public.office_spaces os on os.space_id = m.space_id
    left join public.offices o on o.id = os.office_id and o.archived_at is null
   where m.no_pm or m.quiet_at is not null
   order by m.no_pm desc, m.quiet_at asc nulls last, lower(m.name), m.id;
$function$;

-- Trash: list_my_trash() (last owner work-task-handoff.sql), the date each item goes.
CREATE OR REPLACE FUNCTION public.list_my_trash()
 RETURNS TABLE(kind text, id uuid, repo_id uuid, root text, name text, is_folder boolean, file_count integer, size_bytes bigint, trashed_at timestamp with time zone, purge_at timestamp with time zone, project_id uuid, project_name text, class_project_id uuid, task_title text, frozen boolean, resource_kind text, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with drafts as (
    select d.repo_id, d.project_id, f.trash_root,
           max(f.trashed_at) as trashed_at,
           bool_or(f.path <> f.trash_root) as is_folder,
           count(*) filter (where f.path !~ '(^|/)\.keep$')::int as file_count,
           sum(case when f.kind = 'binary'
                    then coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                    where o.bucket_id = 'general-files' and o.name = f.storage_path), 0)
                    else octet_length(f.content) end)::bigint as size_bytes
      from public.general_drafts d
      join public.general_draft_files f on f.draft_id = d.id
     where d.user_id = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(d.project_id)
     group by d.repo_id, d.project_id, f.trash_root
  ),
  rows as (
    select 'draft'::text as kind, null::uuid as id, x.repo_id, x.trash_root as root,
           regexp_replace(x.trash_root, '^.*/', '') as name,
           x.is_folder, x.file_count, x.size_bytes, x.trashed_at, x.project_id,
           null::text as task_title, null::text as resource_kind,
           null::text as label, null::uuid as place_id
      from drafts x
    union all
    select 'task_file', f.id, null, null, f.file_name, false, 1, f.size_bytes, f.trashed_at,
           f.project_id, t.title, null, null, null
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
     where public.general_task_child_readable(t.id) and f.trashed_by = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(f.project_id)
    union all
    select 'resource', tr.id, null, null, tr.title, false, 1, tr.size_bytes, tr.trashed_at,
           null, null, tr.kind::text, null, null
      from public.teaching_resources tr
     where tr.professor_id = auth.uid()
       and tr.trashed_at is not null
    union all
    select 'discussion', gd.id, null, null, gd.topic, false, 1, octet_length(gd.content_html)::bigint,
           gd.trashed_at, gd.project_id, null, null, null, null
      from public.general_discussions gd
     where gd.trashed_by = auth.uid()
       and gd.trashed_at is not null
       and public.general_can_write(gd.project_id)
    union all
    select 'class', c.id, null, null, c.name, false, 1, null, c.trashed_at,
           null, null, null, c.initial || ' · ' || c.section, null
      from public.classes c
     where c.trashed_by = auth.uid() and c.trashed_at is not null
    union all
    select 'group', g.id, null, null, g.name, false, 1, null, g.trashed_at,
           null, null, null, c.name, c.id
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.trashed_by = auth.uid() and g.trashed_at is not null
    union all
    select 'class_project', p.id, null, null, p.title, false, 1, null, p.trashed_at,
           null, null, null, c.name, c.id
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'class_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           null, null, null, p.title, p.id
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'space', s.id, null, null, s.name, false, 1, null, s.trashed_at,
           null, null, null, 'Spaces', null
      from public.general_spaces s
     where s.kind = 'work' and s.trashed_by = auth.uid() and s.trashed_at is not null
    union all
    select 'team', t.id, null, null, t.name, false, 1, null, t.trashed_at,
           null, null, null, s.name, s.id
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'project', p.id, null, null, p.name, false, 1, null, p.trashed_at,
           null, null, null, coalesce(s.name, 'Projects'), s.id
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'work_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           t.project_id, null, null, null, null
      from public.general_tasks t
     where public.general_task_child_readable(t.id) and t.trashed_by = auth.uid() and t.trashed_at is not null
  )
  select r.kind, r.id, r.repo_id, r.root, r.name, r.is_folder, r.file_count, r.size_bytes,
         r.trashed_at, r.trashed_at + make_interval(days => public.org_trash_retention_days()),
         r.project_id,
         coalesce(r.label,
                  case r.resource_kind when 'syllabus' then 'Syllabi' when 'curriculum' then 'Curriculum' end,
                  cp.title, gp.name),
         b.project_id,
         r.task_title,
         coalesce(gp.archived_at is not null or public.class_board_frozen(gp.class_board_id), false),
         r.resource_kind,
         r.place_id
    from rows r
    left join public.general_projects gp on gp.id = r.project_id
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.projects cp on cp.id = b.project_id
   order by r.trashed_at desc, r.name;
$function$;

-- Trash: purge_trash() (last owner archive-page.sql), all five cut-offs. The nightly cron job
-- only calls it, so it needs no change.
CREATE OR REPLACE FUNCTION public.purge_trash()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int;
  m int;
  k int;
  j int;
  x int := 0;
  r record;
begin
  perform set_config('collabify.trash_purge', 'on', true);
  delete from public.general_draft_files where trashed_at < now() - make_interval(days => public.org_trash_retention_days());
  get diagnostics n = row_count;
  perform set_config('collabify.trash_purge', 'off', true);

  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files where trashed_at < now() - make_interval(days => public.org_trash_retention_days());
  get diagnostics m = row_count;
  perform set_config('collabify.general_archive_op', 'off', true);

  delete from public.teaching_resources where trashed_at < now() - make_interval(days => public.org_trash_retention_days());
  get diagnostics k = row_count;

  delete from public.general_discussions where trashed_at < now() - make_interval(days => public.org_trash_retention_days());
  get diagnostics j = row_count;

  for r in select * from public.archive_trash_rows(null, now() - make_interval(days => public.org_trash_retention_days())) loop
    if r.trashed_by is null then
      perform public.archive_untrash(r.kind, r.id);
      continue;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.trashed_by, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.trashed_by::text, true);
    begin
      perform public.delete_trashed_item(r.kind, r.id);
      x := x + 1;
    exception when others then
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform public.archive_untrash(r.kind, r.id);
    end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
  end loop;
  return n + m + k + j + x;
end;
$function$;

-- Domain: overwrite_bulk_account (from company-accounts.sql, a company-roles chain file, so it is
-- redefined here, not edited there). A saved domain holds only lower-case letters, digits,
-- hyphens and dots (org_domain_valid), so escaping the dots makes it match itself and nothing else.
CREATE OR REPLACE FUNCTION public.overwrite_bulk_account(p_email text, p_first_name text, p_middle_name text, p_last_name text, p_role user_role)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.profiles%rowtype;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin' and status = 'active'
  ) then
    raise exception 'Only an active admin can overwrite an account'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or greatest(length(p_first_name), length(coalesce(p_middle_name, '')),
                 length(p_last_name)) > 80 then
    raise exception 'Enter valid names of at most 80 characters'
      using errcode = 'check_violation';
  end if;
  if p_email is null or lower(btrim(p_email)) !~ ('^[a-z0-9._%+-]+@' || replace(public.org_school_email_domain(), '.', '\.') || '$') then
    raise exception 'Use a valid @% email', public.org_school_email_domain()
      using errcode = 'check_violation';
  end if;

  select * into strict target from public.profiles
   where lower(email) = lower(btrim(p_email)) for update;
  perform public.set_account_role(target.id, p_role);
  update public.profiles
     set first_name = btrim(p_first_name),
         middle_name = nullif(btrim(p_middle_name), ''),
         last_name = btrim(p_last_name)
   where id = target.id
  returning * into target;
  return target;
exception
  when no_data_found then
    raise exception 'Account no longer exists. Upload the CSV again.'
      using errcode = 'no_data_found';
  when too_many_rows then
    raise exception 'More than one account uses this email. Resolve it before importing.'
      using errcode = 'unique_violation';
end;
$function$;

-- Visibility: not the column default. A class board's Files project relies on that default, and
-- general_projects_visibility_work refuses Workspace for one. So a before insert trigger moves a
-- new work project (class_board_id is null) that did not name a visibility other than the
-- default onto the setting. An insert that names Workspace keeps it.
create or replace function public.general_projects_org_visibility()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.visibility := public.org_new_project_visibility();
  return new;
end;
$$;

drop trigger if exists general_projects_org_visibility on public.general_projects;
create trigger general_projects_org_visibility
  before insert on public.general_projects
  for each row
  when (new.class_board_id is null and new.visibility = 'private')
  execute function public.general_projects_org_visibility();

-- ---------------------------------------------------------------- grants

-- Internal: the domain check.
revoke all on function public.org_domain_valid(text) from public, anon, authenticated;

revoke all on function public.org_quiet_days() from public, anon;
revoke all on function public.org_trash_retention_days() from public, anon;
revoke all on function public.org_new_project_visibility() from public, anon;
revoke all on function public.org_school_email_domain() from public, anon;
revoke all on function public.set_organization_settings(int, int, text, text) from public, anon;
revoke all on function public.admin_trash_purge_preview(int) from public, anon;

-- A trigger function: PostgreSQL never checks EXECUTE on one, so nobody needs it.
revoke all on function public.general_projects_org_visibility() from public, anon, authenticated;

grant execute on function public.org_quiet_days() to authenticated;
grant execute on function public.org_trash_retention_days() to authenticated;
grant execute on function public.org_new_project_visibility() to authenticated;
grant execute on function public.org_school_email_domain() to authenticated;
grant execute on function public.set_organization_settings(int, int, text, text) to authenticated;
grant execute on function public.admin_trash_purge_preview(int) to authenticated;

commit;
