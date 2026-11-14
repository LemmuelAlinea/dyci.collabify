# Admin upgrade, phase 5: organization settings

Date: 2026-11-15. Status: approved in conversation. Phases 1–4 are live.

## Why

Four organization-wide values are fixed in code. The admin should change them without a deploy:
how long before a project counts as quiet, how long the trash keeps items, whether new work projects
start Private or Workspace, and which email domain the CSV import accepts.

## Goals

- An **Organization settings** page (admin only, in the rail's Organization group) with four
  settings, each range-checked and audited.
- Every rule that uses one of the values reads the setting instead of a fixed number.

## Non-goals

- Sign-in or sign-up domain restrictions (none exist in code today; the domain is used only by the
  CSV import).
- The privacy request deadlines (5 and 15 days), which are commitments in the privacy policy.
- Per-office or per-space overrides.
- Changing the example text on the sign-in and password reset pages (they render before sign-in, and
  `anon-lockdown.sql` keeps settings away from signed-out visitors).

## Anti-goals

- **A value outside its range or a malformed domain gets saved.** The database refuses it.
- **A setting change silently changes behaviour with no record.** Every change writes the audit log
  with old and new values.
- **A default changes on deploy.** The defaults equal today's fixed values (14 days, 30 days,
  Private, `dyci.edu.ph`), so nothing changes until the admin changes it.

## Decisions made with the user

- All four settings are in scope (quiet threshold, trash retention, new-project visibility, import
  email domain).

## Decisions I made (open to overturn)

- Ranges: quiet 3–90 days; trash 7–365 days.
- Trash retention applies to items already in the trash (their purge date is computed from the
  current setting), so shortening it can purge older items on the next sweep. The settings page says
  so beside the field.
- The domain is a bare domain (`dyci.edu.ph`, lower case, at least one dot, letters, digits and
  hyphens per label); the page shows it as `@dyci.edu.ph`.

## Approaches

1. **One settings row, an admin-only setter, and small read helpers the existing rules call
   (chosen).**
2. Environment variables per deploy: needs a deploy per change and can't be audited.
3. A key-value settings table: looser typing, and every reader would cast.

## Design

### Data (`supabase/organization-settings.sql`, new; after `notice-audience.sql`, before `anon-lockdown.sql`)

- `organization_settings` (single row, `id boolean primary key default true check (id)`):
  `quiet_days int not null default 14 check (between 3 and 90)`, `trash_retention_days int not
  null default 30 check (between 7 and 365)`, `new_project_visibility text not null default
  'private' check (in ('private','workspace'))`, `school_email_domain text not null default
  'dyci.edu.ph'` with a format check, `updated_at`, `updated_by`. Seeded with one row. RLS: select
  for authenticated; no write policies.
- Read helpers (stable, security definer, granted to authenticated): `org_quiet_days()`,
  `org_trash_retention_days()`, `org_new_project_visibility()`, `org_school_email_domain()`.
- `set_organization_settings(p_quiet_days int, p_trash_retention_days int, p_new_project_visibility
  text, p_school_email_domain text) returns organization_settings`: active admin only; one audit row
  per changed value (`org_setting_changed`, subject the setting's label, before/after values); a
  call that changes nothing writes nothing.
- **Wiring** (the builder confirms each owner and re-run chain before editing; if a change would
  require re-running a company-roles chain file, stop and report):
  - Quiet: `office_attention_rows()` in `offices.sql` (owner, edited in place) reads
    `org_quiet_days()`.
  - Trash: the purge date and the purge job read `org_trash_retention_days()` in whichever file is
    their final owner.
  - Visibility: work-project creation uses `org_new_project_visibility()` where it sets
    `visibility` today (a column default or the create function, whichever is the final path).
  - Domain: `overwrite_bulk_account`'s check reads `org_school_email_domain()`; the Edge Function's
    shared normalizer takes the domain as a parameter read once per request; the dialog's preview
    and description use the setting.
- Suite `supabase/tests/organization-settings.test.sql`.

### App

- `lib/api/orgSettings.ts`: `getOrganizationSettings()`, `setOrganizationSettings(...)`.
- **Organization settings page** (`pages/app/admin/OrgSettings.tsx`, route `/admin/settings/org`
  — the builder picks a path that doesn't collide with the existing `/admin/settings` redirect),
  rail entry "Settings" in the Organization group (icon `settings`): four fields with their ranges
  and a note per field on what it changes; Save is disabled until something changes; refusals show
  as-is; a success toast.
- Audit log label `org_setting_changed` ("Organization setting changed").
- Bulk import dialog and its preview read the domain from the settings.

### Tests

- SQL: defaults equal today's values; the setter refuses non-admins, inactive admins, each
  out-of-range value and a malformed domain; each change writes one audit row and a no-op writes
  none; the quiet helper changes `office_attention_rows()` (a project quiet at 10 days is flagged
  with quiet 7, not with 14); trash purge dates follow the setting; a new work project's visibility
  follows the setting; `overwrite_bulk_account` accepts the new domain and refuses the old one after
  a change.
- Frontend: the page loads, validates ranges, saves, shows refusals; the import preview uses the
  configured domain.

## Left to the builder

- The exact rail position of the new Settings entry within Organization.
- The page layout, within the admin page patterns.
