# Organization settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin change the quiet threshold, trash retention, new-project visibility and the
import's email domain from one Organization settings page, with every rule reading the setting.

**Architecture:** `supabase/organization-settings.sql` adds a single-row settings table, read
helpers, an audited admin setter and a purge preview, then takes ownership of four functions
(`office_attention_rows`, `list_my_trash`, `purge_trash`, `overwrite_bulk_account`) with only their
fixed value replaced, plus a new-project visibility trigger. The app adds the settings page, a
retention hook for "30 days" copy, and passes the domain into the bulk import.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), React 19 + TypeScript + Vite, Deno Edge Function, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-organization-settings-design.md`

## Global Constraints

- Defaults equal today's values: quiet 14, trash 30, visibility `private`, domain `dyci.edu.ph`.
  Nothing changes until the admin saves.
- Ranges: quiet 3–90; trash 7–365; visibility `private` | `workspace`; domain lower case, labels of
  letters/digits/hyphens, at least one dot, 4–253 characters.
- Only an active admin writes; every changed value writes one `org_setting_changed` audit row; a
  no-op writes none.
- The four taken-over functions start from the live `pg_get_functiondef` and change only the fixed
  value. No company-roles chain file is edited.
- The visibility trigger applies only when `class_board_id is null`.
- `supabase/organization-settings.sql` runs after `notice-audience.sql`, before `anon-lockdown.sql`.
  Apply with `node scripts/db.mjs supabase/organization-settings.sql supabase/anon-lockdown.sql <suites>`
  (live project; approved; suites roll back).
- Supabase errors reach the person via `authErrorMessage`. Tokens only; sentence case, no "please",
  "successfully" or exclamation marks; desktop first; no semicolons, single quotes; never run a
  formatter over whole files. `npm run build` passes before a task is done.

## Review Focus

1. **A class teacher opens a group's Files for the first time with the setting at Workspace**: the
   hidden Files project is still created Private. Test in Task 2.
2. **Shortening retention**: the purge preview count equals what `purge_trash` would delete. Test in
   Task 1/2.
3. **The trash list's "deleted in N days"** follows the setting after a change. Test in Task 2 (SQL)
   and Task 4 (copy).
4. **Two admins saving at once**: the second save sees the first's values (row lock); audit rows
   name each actual change. Test in Task 1.
5. **The import after a domain change**: preview, Edge Function and overwrite all use the new
   domain; the old one is refused. Test in Tasks 2 and 4.

---

### Task 1: Settings table, helpers, setter, purge preview

**Files:** Create `supabase/organization-settings.sql`, `supabase/tests/organization-settings.test.sql`.

**Interfaces:**
- Produces: table `organization_settings` (single row, columns as in the spec); helpers
  `org_quiet_days() returns int`, `org_trash_retention_days() returns int`,
  `org_new_project_visibility() returns text`, `org_school_email_domain() returns text` (stable,
  security definer, granted to authenticated); `set_organization_settings(p_quiet_days int,
  p_trash_retention_days int, p_new_project_visibility text, p_school_email_domain text) returns
  organization_settings`; `admin_trash_purge_preview(p_days int) returns int`; audit value
  `org_setting_changed` (labels: "Quiet after", "Trash keeps items", "New projects start",
  "School email domain").
- [ ] **Step 1: Failing suite:** defaults; RLS (authenticated reads, nobody writes directly);
  the setter refuses a member, an inactive admin, each out-of-range value and each malformed domain
  (`dyci`, `-x.ph`, `UPPER.PH` normalized or refused — normalize to lower case, refuse the rest);
  each changed value writes one audit row with old/new; a no-op writes none; Review Focus 4 via two
  sequential saves under the lock; `admin_trash_purge_preview` refuses non-admins and counts.
- [ ] **Step 2–4:** run `node scripts/db.mjs supabase/organization-settings.sql supabase/anon-lockdown.sql supabase/tests/organization-settings.test.sql` (FAIL), implement, run twice (PASS).
- [ ] **Step 5: Commit** — "Keep organization settings in one row".

### Task 2: Wire the four values in the database

**Files:** Modify `supabase/organization-settings.sql`, its suite.

**Interfaces:** redefined `office_attention_rows()`, `list_my_trash(...)`, `purge_trash()`,
`overwrite_bulk_account(...)` (same signatures; read the helpers); trigger
`general_projects_org_visibility` (`before insert`, work projects only).
- [ ] **Step 1: Failing assertions:** quiet 7 flags a project idle 10 days, 14 doesn't; the purge
  date in `list_my_trash` and what `purge_trash` deletes follow a changed retention, and the preview
  count equals the purge count (Review Focus 2); a new work project follows `workspace`, a class-board
  Files project stays `private` (Review Focus 1); `overwrite_bulk_account` accepts the new domain and
  refuses the old after a change; with defaults, every redefined function behaves exactly as before
  (run `offices.test.sql`, `office-heads.test.sql`, and any trash/accounts suites that exist).
- [ ] **Step 2–4:** run with `supabase/tests/offices.test.sql supabase/tests/office-heads.test.sql`
  and the trash/accounts suites added to the command (FAIL), implement, run twice (PASS).
- [ ] **Step 5: Commit** — "Read organization settings where the fixed values were".

### Task 3: Organization settings page

**Files:** Create `src/lib/api/orgSettings.ts`, `src/pages/app/admin/OrgSettings.tsx`, its test;
modify `src/lib/paths.ts`, `src/App.tsx`, `src/components/app/nav.ts` (+ test), `src/lib/types.ts`
+ `src/pages/app/admin/AuditLog.tsx` (audit label "Organization setting changed", icon `settings`).

**Interfaces:** `getOrganizationSettings(): Promise<OrgSettings>`,
`setOrganizationSettings(s: OrgSettings): Promise<OrgSettings>`, `trashPurgePreview(days): Promise<number>`;
`type OrgSettings = { quiet_days: number; trash_retention_days: number; new_project_visibility:
'private' | 'workspace'; school_email_domain: string }`; path `paths.admin.orgSettings` (pick one not
colliding with the `/admin/settings` redirect); rail "Settings" (icon `settings`) last in Organization.
- Page: four fields with ranges and a one-line note each; when retention goes down, "N trashed items
  would be deleted at the next nightly clean-up." from the preview; Save disabled until changed or
  invalid; refusals as-is; toast on save.
- [ ] **Step 1: Failing tests:** loads values; refuses out-of-range input before saving; shows the
  purge count when retention is lowered; saves only changed values; shows a database refusal; the
  rail has Settings in Organization.
- [ ] **Step 2–4:** FAIL, implement, PASS + `npm run build`.
- [ ] **Step 5: Commit** — "Change organization settings from one page".

### Task 4: Retention copy and the import's domain

**Files:** Create `src/hooks/useOrgSettings.ts` (reads `organization_settings` once, defaults to
today's values while loading or on error); modify `Trash.tsx`, `Archive.tsx`, `DraftPanel.tsx`,
`TaskDialog.tsx`, `DiscussionTab.tsx`, `ResourceLibrary.tsx` (every "30 days" from the hook);
`supabase/functions/_shared/bulkAccounts.ts` (`normalizeBulkUser(value, domain)`),
`supabase/functions/bulk-register-users/index.ts` (read the domain with the caller client once),
`src/lib/bulkAccounts.ts` (`parseBulkCsv(source, domain)`), `BulkRegisterDialog.tsx` (description
and preview use the setting).
- [ ] **Step 1: Failing tests:** each copy site renders the configured number (one representative
  test per file family is enough where the copy is shared); `parseBulkCsv` refuses the default
  domain when another is passed and accepts the configured one; the dialog shows the configured
  domain.
- [ ] **Step 2–4:** FAIL, implement, PASS + `npm run build` + `deno check` on the Edge Function.
- [ ] **Step 5: Commit** — "Read retention and the import domain from settings".

### Task 5: Docs and checks

- `docs/07-backup.md` (run lines; an entry listing the four taken-over functions, their previous
  owners and the re-run rules), `CLAUDE.md` (an "Organization settings" bullet incl. the re-run
  rules for offices.sql, trash.sql, archive-page.sql, project-stakeholders.sql,
  work-task-handoff.sql and company-accounts.sql), `handoff.md` (dated section, the Edge Function
  redeploy, Deferred, "Browser walk: pending").
- [ ] `npm run build`, `npm test`, every touched SQL suite. Commit "Document organization settings".
- [ ] The controller walks the page (changes nothing unless asked) and stops for review before push;
  shipping needs the `bulk-register-users` redeploy.
