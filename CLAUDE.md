# Collabify — working notes

Project management for BSIT programs in the Philippines. Roles: `student`, `member` and
`admin`. Teaching is the `can_teach` switch (members only; admins do not teach), and
creating work spaces is the `can_manage_projects` switch (members and admins). Admins have
it off by default: they create work spaces only once an admin turns it on for them. Every
planned phase has shipped and is live at dyci-collabify.vercel.app from `main`, and company
roles phases 1 (members and the two switches), 2 (project roles) and 3 (stakeholders:
read-only projects, the Feedback tab, the slim sidebar and the stakeholder Home) are live.
Phase 4, QA, is next (`docs/superpowers/specs/2026-10-23-company-roles-design.md`). Other
open work is the
**Deferred** notes in `handoff.md` plus whatever the user asks for next. Read the end of
`handoff.md` for the latest state.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
node scripts/db.mjs supabase/schema.sql
node scripts/set-role.mjs <email> <student|member|admin> [status]
```

Run `npm run build` before claiming anything works — `tsc -b` runs first and catches
most breakage.

## Design system

Do not hardcode colors. Everything reads from tokens in `src/styles/index.css`:

- Surfaces: `surface`, `surface-raised`, `surface-sunken`
- Text: `text-ink`, `text-muted`, `text-faint`
- Lines: `border-line`, `border-line-strong`
- Brand ramps: `navy-*` (600 is the brand), `amber-*` (400 is the accent)
- Status ramps: `success-*` (done), `warning-*` (in progress, needs attention),
  `danger-*` (late, errors), and `pending-soft` / `pending-ink` (not started). Never
  `emerald-*`, `red-*`, or brand amber for a status.
- Personal slots: `banner`, `banner-ink`, `banner-accent`, `banner-glow` (page
  banners; the ground itself is the `.banner-fill` class, its glow and grid carry
  `.banner-deco`, figure cells on it `.banner-cell`), `progress`, `nav-icon`,
  `nav-active`, `nav-marker`, `badge`, `icon-tile` / `icon-glyph` (card icon squares).
- Dark mode's app grounds read `--u-page`, `--u-surface`, `--u-sunken`, `--u-raised`
  first (the person's background depth), then fall back to the defaults.

Status ramps and personal slots can be recolored per person in Settings → Appearance
(`lib/palette.ts` sets them inline on `<html>`). Give them defaults in `:root` / `.dark`
only, never under `.app-ui`, or the person's colors stop reaching the page.

Both light and dark are defined in the same block — a raw hex breaks one of them.

- Display face `font-display` (Outfit), body `font-sans` (Instrument Sans), utility
  `font-mono` (JetBrains Mono) for eyebrows and numerals.
- `.eyebrow` for the small mono uppercase labels, `.shell` for page gutters,
  `.blueprint` for the grid motif.
- Dark mode is the `.dark` class on `<html>`, set pre-paint by the inline script in
  `index.html`. Never switch on a media query alone.
- Motion goes through `components/motion/Reveal.tsx` or Motion's `useReducedMotion`.
  Reduced motion must stay honored.

## Conventions

- Desktop layout first, then tablet, then phone. Not a widened mobile column.
- Auth state comes from `useAuth()`; theme from `useTheme()`. No direct `supabase.auth`
  calls in pages except the one recovery-session check in `ResetPassword`.
- New protected pages go inside `<ProtectedRoute>` + `<AppShell>` in `App.tsx`, and get
  a nav entry in `components/app/nav.ts` (`soon: true` marks an entry not built yet;
  none are today).
- `supabase/schema.sql` must stay idempotent — it gets re-run.
- Copy style: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.

## Project roles (work projects)

- A work project (`general_projects.class_board_id is null`) gives each person one
  `general_members.role`: `pm` (exactly one), `coordinator`, `member`, `qa`,
  `stakeholder`. `role` is the source of truth; `level` is derived from it by the
  `sync_general_member_level` trigger (pm → owner, coordinator → manager, else member)
  so older checks keep working. Write `role`, never `level`, on a work project. A class
  board's hidden Files project keeps the old level model.
- On the frontend, read `myRole`, `can`, `canGrant`, `leadsUser` from `useGeneralProject`
  and the helpers in `lib/general/permissions.ts` (`rolePermissions`, `canAs`, `canGive`,
  and the team-lead task rules `canEditTask`, `canUnassign`, `assignableTo`,
  `canStepRank`), which mirror `general_has`, `general_can_grant` and the task guards in
  SQL.
- The company-roles SQL is six files that run last, in this order: `company-accounts.sql`,
  `project-roles.sql`, `project-visibility.sql`, `project-team-leads.sql`,
  `project-stakeholders.sql`, `project-feedback.sql`. Between them they are the final
  owners of functions, triggers and policies first written in many earlier files
  (`general.sql`, `general-spaces.sql`, `general-tasks.sql`, `general-drafts.sql`,
  `general-repo.sql`, `general-notify.sql`, `general-reports.sql`,
  `general-project-archive-rbac.sql`, `meetings.sql`, `trash.sql`, `access.sql`,
  `storage-sweep.sql` and more). Re-running ANY file one of them supersedes means
  re-running all six in that order, then `anon-lockdown.sql`; re-running one of the six
  means re-running the ones after it, then `anon-lockdown.sql`. Re-running `general-project-archive-rbac.sql` alone reopens every
  work project to its whole space; re-running a file `project-stakeholders.sql`
  supersedes hands stakeholders back a member's writes. `docs/07-backup.md` lists what
  each of the six owns. Always start a redefinition from the live `pg_get_functiondef`.
- Member writes in a work project gate on `general_can_write(project)` (a member (not
  rejected) who isn't a stakeholder); reads keep `is_general_member`. A new member-write path uses
  `general_can_write`.
- A member whose live projects are all stakeholder roles, with no class, no teaching
  switch and no Project manager switch, gets the slim rail (Home, Projects, Inbox,
  Calendar, Account) and `StakeholderHome` (cards from `my_stakeholder_projects()`, which
  `project-feedback.sql` owns). The rule is `isStakeholderOnly` in `lib/access.ts`, from
  `membershipOf(...).allStakeholder`; students and the admin keep their own rails.

## Security invariants

- `role`, `status`, `can_teach` and `can_manage_projects` are only changeable by an
  admin — enforced by the `profiles_guard_privileged` trigger, not just by UI. Its final
  copy lives in `supabase/company-accounts.sql`; re-run that file after any earlier one
  that redefines the guard (see `docs/07-backup.md`).
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend code, in
  Vercel, or in any committed file.
- Avatar uploads are scoped to `avatars/<user-id>/…` by storage policy.

## Agent tooling

Installed under `.claude/` (see `.claude/skills/README.md`):

- **CodeGraph** — MCP server (`.mcp.json`). When `.codegraph/` exists, use
  `codegraph_explore` (or `codegraph explore "<question>"` in the shell) before
  grep/Read to locate code and check blast radius. Re-index with `codegraph init`.
- **Caveman** — `/caveman [lite|full|ultra]` for terse replies; `/caveman-commit`,
  `/caveman-review`, `/caveman-compress`; `cavecrew-*` subagents. Commit messages still
  follow this repo's style, and user-facing copy still follows the copy rules above.
- **Ponytail** — `/ponytail` for the simplest working solution; `/ponytail-review`,
  `/ponytail-audit`, `/ponytail-debt`. Never simplifies away a security invariant.
