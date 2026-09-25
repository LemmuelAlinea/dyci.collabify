# Collabify — session handoff (2)

**As of** 2026-09-25 · this file covers **only this session**. The full project
history lives in `handoff.md`, which this session did not touch.

**Model note:** most of this session ran on Opus 5.5; the last part (this file)
runs on Sonnet 5, at the user's request via `/model`.

---

## How work left this session

Two different paths, because the user changed the ground rules partway through:

1. **Pushed to GitHub, branch `main-13uyn0`** — everything up through the
   sidebar Dashboard row (items 1–4 below). This was before the user said to
   stop pushing.
2. **Delivered as unapplied `.patch` files, nothing committed or pushed** —
   everything after that point (items 5–7 below), per explicit instruction.
   The user runs `git apply <name>.patch` on their own local `main`, then the
   listed `node scripts/db.mjs` commands against their own database.

`handoff.md` itself was appended to mid-session (see item 6); that edit is
still sitting in the working tree, uncommitted, along with everything in items
5–7 — none of it has reached GitHub.

---

## 1. Vendored agent tooling (`.claude/`) — pushed

Installed three third-party tools so they load in every future session,
including fresh cloud containers:

- **`caveman`** (JuliusBrussee/caveman, commit `2fd153c`) — terse-reply mode
  and code-review/commit-message skills. Mode hooks left out; opt-in via
  `/caveman`.
- **`ponytail`** (DietrichGebert/ponytail, commit `e3ba2aa`) — "simplest
  solution" mode and audit/review skills. Same opt-in treatment.
- **CodeGraph** (colbymchenry/codegraph, CLI 1.6.0) — not a skill, an MCP
  server (`.mcp.json`) that indexes the repo for `codegraph_explore` /
  `codegraph_node` lookups. Telemetry off. A `SessionStart` hook
  (`.claude/hooks/session-start.sh`) reinstalls the CLI and rebuilds
  `.codegraph/` (gitignored) on every fresh cloud container.

Left out on purpose and recorded in `.claude/skills/README.md`:
`caveman-setup` (routes app LLM calls through a third-party gateway — refused
for privacy reasons under RA 10173), and five caveman skills that need its
separate CLI/engine.

Files: `.mcp.json`, `.claude/settings.json`, `.claude/hooks/session-start.sh`,
`.claude/skills/*`, `.claude/agents/cavecrew-*.md`, `.claude/skills/README.md`,
a new "Agent tooling" section in `CLAUDE.md`.

**Also produced, not committed:** an interactive D3 force-directed graph of
the whole repo's file dependencies, built from the CodeGraph SQLite index and
published as a Claude Artifact (377 files, colored by layer, click-through
detail panel). Static — doesn't update as code changes.

---

## 2. General workplace dashboard — pushed

Turned each space's home page (`/general/spaces/:spaceId`,
`src/pages/general/GeneralHome.tsx`) from a plain project list into a real
dashboard:

- **Masthead** (reusing `DashboardSummary`): greeting, a status line, and four
  live tiles — my open tasks, due this week, overdue, waiting on you.
- **Quick-action cards** (new `QuickActions.tsx`): New project, Join with
  code, Members, Teams, Messages (unread count), Archive. Owner-only Archive
  space / Delete space moved to their own row below the cards.
- **Four panels** (new `DashboardPanels.tsx`): Waiting on you (invitations +
  reviews assigned to me + access requests on projects I own), My tasks
  (overdue-first, opens the task dialog directly), Coming up (next 14 days of
  deadlines and project end dates), Jump back in (4 most recently updated
  projects).
- Existing project grid and filters kept, moved below the panels.

New files: `src/lib/general/dashboard.ts` (+ `dashboard.test.ts`, 6 tests),
`src/hooks/useGeneralDashboard.ts`, `src/components/general/QuickActions.tsx`,
`src/components/general/DashboardPanels.tsx`. Two new read-only functions in
`src/lib/api/general.ts` (`listSpaceOpenTasks`, `listMyOpenReviews`) — no
migration, they read existing views under existing RLS.

Checked with a mocked local Vite harness (real page code, fake data) at
desktop/tablet/phone, light and dark, since this container has no Supabase
credentials to sign in for real.

## 3. Sidebar Dashboard row — pushed

Added a **Dashboard** row to the General sidebar, first under Workplace, above
Projects — it wasn't there when item 2 shipped, and the user caught the gap
from a screenshot of the *old* page on `main` (the new one was only on the
branch). Points at the current space; lit only on the space home, not its
Members/Teams/Archive pages. `src/components/app/nav.ts`,
`src/components/app/SideNav.tsx`.

---

## 4. Everything below: delivered as patch files, not committed/pushed

From here on the user asked that nothing reach GitHub. Each feature was sent
as a `git diff`-format `.patch` file for the user to `git apply` locally, plus
the exact `node scripts/db.mjs` commands to run its SQL. The database work was
verified against a **throwaway local Postgres 16** this session provisioned
in-container (with hand-written stand-ins for Supabase's `auth`/`storage`/
`cron` schemas), since the container has no real database — that's the only
reason any of this session's SQL was actually *run* rather than just read.

### 4a. Bring back declined/withdrawn requests to draft
**Patch: `collabify-restore-requests.patch`**

A General project's file-review request (`general_repo_changes`), once
declined or withdrawn, used to strand its files — nothing returned them to the
author's draft. Added:

- `restore_general_repo_change(p_change, p_path)` RPC — whole request or one
  file/folder; refuses on a path clash with what's already in the draft
  (names the clashing paths) rather than overwriting; refuses if Main changed
  a path since the request's base commit and the draft has moved past it.
- `restoreRepoChange()` API wrapper.
- UI in `RepoChangeRow.tsx`: "Bring back to draft" in the ⋮ menu on a
  declined/withdrawn request, plus a per-file/per-folder "Bring back" button
  in the expanded view. Withdraw dialog copy updated to say files can come
  back later.

Files: `supabase/general-draft-restore.sql` (new),
`supabase/tests/general-draft-restore.test.sql` (new, **15/15 pass**),
`src/lib/api/general.ts`, `src/components/general/RepoChangeRow.tsx`.

```
git apply collabify-restore-requests.patch
node scripts/db.mjs supabase/general-draft-restore.sql
node scripts/db.mjs supabase/tests/general-draft-restore.test.sql
```

### 4b. Archive page RBAC fix + real project delete
**Patch: `collabify-archive-rbac.patch`**

User-reported bug: a project archived from one account showed up in the
Archive of *another* account in the same space, because any space member
could read any project in it, archived or not. Fixed at the database layer —
`can_read_general_project` now checks `general_sees_archived` (archiver, or
that project's Owners/Managers) once a project is archived, so every
view/policy built on it (project row, tasks, files, repo, chat) follows
automatically.

Also added:
- `delete_general_project()` RPC — Owner-only, archived-projects-only, cascades
  everything (tasks, files, repo, drafts, changes, members, chat), returns the
  storage object paths to clean up. Had to special-case the "commits are
  frozen forever" trigger to allow deletion *only* while that project's own
  delete is in progress.
- A storage policy letting orphaned `general-files` objects (project row
  already gone) be removed by anyone — the only way they're ever reachable.
- `SpaceArchive.tsx` rewritten: Restore and Delete moved into an `ActionMenu`
  (⋮), Delete requires typing the exact project name to confirm.

Files: `supabase/general-project-archive-rbac.sql` (new),
`supabase/tests/general-project-archive-rbac.test.sql` (new, **22/22 pass**),
`src/lib/api/general.ts` (`deleteGeneralProject`),
`src/pages/general/SpaceArchive.tsx`,
`src/pages/general/GeneralProject.tsx` (not-found copy tweak).

```
git apply collabify-archive-rbac.patch
node scripts/db.mjs supabase/general-project-archive-rbac.sql
node scripts/db.mjs supabase/tests/general-project-archive-rbac.test.sql
```

### 4c. General workplace Reports (built from a supplied spec)
**Patch: `collabify-general-reports.patch`**

The user handed over a full implementation spec
(`6279608f-2026-09-25-general-reports-design.md`) for a Reports feature and
asked for it built, tested, and delivered whole. Built end to end:

**Database — `supabase/general-reports.sql`** (last in the migration chain):
- Access rule, once, in the functions: a *lead* (project Owner/Manager, or
  Owner/Manager of the project's space) sees everyone; anyone else gets
  project-wide totals plus only their own rows — enforced server-side, not by
  hiding UI.
- `general_project_events` + 3 triggers — a new history table recording task
  archive/restore, project status/archive, and member join/leave/remove/level
  changes, which nothing previously logged. Recorded only from install time
  forward.
- `general_report_templates` — saved report configs, private-by-default,
  optionally shared with the space, 50-per-person-per-space cap, RLS.
- **9 report RPCs**: scope, summary, progress-over-time series, per-person
  breakdown, a unified activity feed (paginated), tasks, time logs, commits,
  reviews. Every one takes the same common filter args (space, projects,
  date range, people, teams, include-archived, timezone).
- Performance: the first version measured 0.9–1.8s per call on a synthetic
  5,000-task project — turned out to be Postgres JIT-compiling the query plan
  costing more than running it. Pinned `set jit = off` on each report function
  (`set search_path = public set jit = off`); with that, everything ran under
  ~160ms server-side even with JIT on globally.
- `supabase/tests/general-reports.test.sql` — **47/47 pass**, covering the
  lead/member visibility split, archived-work rules, comment-body redaction,
  timezone day-bucketing across a DST boundary, every new history trigger, and
  template RLS.

**Client** (all new, `src/lib/general/report{Config,Range,Score,Narrative,
Data}.ts` — pure, URL-is-source-of-truth config, **26 Vitest tests, all
pass**), `src/lib/api/generalReports.ts`, `src/hooks/useGeneralReport.ts`
(debounced 300ms, cancels stale requests, only fetches what enabled sections
need), `src/pages/general/GeneralReports.tsx`,
`src/components/general/reports/` (`ReportBuilder`, `ReportDocument`,
`ReportSections`, `format.ts`, `csv.ts`, hand-rolled SVG `charts/` — line,
donut, stacked bar, progress bar), `src/components/ui/CheckboxList.tsx` (new
shared primitive). `src/components/reports/Sheet.tsx` (Education's existing
print sheet) was generalized with `letterhead`/`footerNote`/`id` props;
Education's own report output is byte-identical to before.

Wiring: route `/general/spaces/:spaceId/reports`, sidebar `ArchiveRow`
generalized into `SpaceRow` with a new Reports row beside Archive, a **Report**
button in each project's header, print CSS rules added to the existing
`@media print` block in `src/styles/index.css`.

Checked in the same mocked Vite harness as items 2–3, at 1440/390px, light,
dark, and emulated print media — caught and fixed a people table too wide for
A4, uncolored legend dots (a dynamic Tailwind class that wasn't statically
generated), and the print stylesheet hiding the on-screen table of contents.

```
git apply collabify-general-reports.patch
node scripts/db.mjs supabase/general-reports.sql
node scripts/db.mjs supabase/tests/general-reports.test.sql
```

`handoff.md` (the original file) was appended to with a summary of this item
before the user asked for this separate file instead — that edit is present
in the working tree but, like everything else in this section, not committed.

---

## Verification run in this session

- `npm run build`, `npx vitest run`, `npx eslint src`, `node
  scripts/motion-lint.mjs`, `node scripts/contrast.mjs` — all green after
  every feature, final state: **34 test files / 443 tests passing**, lint at
  baseline (23 pre-existing warnings, 0 errors), 0 motion-lint and 0
  contrast-check failures.
- `node scripts/schema-drift.mjs` — clean after registering each new `.sql`
  file in its `ORDER` list (also updated `docs/07-backup.md`'s restore
  command each time).
- All four new/changed `supabase/tests/*.test.sql` files run against a
  from-scratch local Postgres 16 with hand-built Supabase stubs — this
  session's own setup, not a Supabase project. **Total: 15 + 22 + 47 = 84 new
  assertions, all PASS.**

## Not verified in this session (needs the user's real environment)

- Sign-in and click-through with two real accounts (Owner vs. Member) in a
  browser — this container has no Supabase credentials.
- An actual browser print-to-PDF of a report (only print-media emulation was
  checked).
- Opening an exported CSV in Excel.
- Whether Vercel's live/preview deploys pick any of this up — nothing here
  reached `main` or was pushed anywhere past `main-13uyn0` (and only through
  item 3).

## Loose ends noticed but not fixed

- Two **pre-existing** SQL test failures surfaced while running the full
  local suite, unrelated to this session's changes: `general-notify`'s admin
  count check, and `general-repo`'s "reviewer merges without edit_files"
  case.
- The same "commits are frozen forever" trigger problem this session
  special-cased for project deletion likely also breaks **Delete space**
  today, for any space holding a project with committed files — flagged to
  the user, not fixed (out of scope of what was asked).
- A fresh restore of the whole schema from `docs/07-backup.md`'s command
  needs two passes locally: `classes.sql`⇄`syllabus.sql` and
  `groups.sql`⇄`projects.sql` each depend on tables the other creates later
  in the same nominal order. Pre-existing, not introduced this session.

## Current repo state

- `main` (GitHub): untouched by this session.
- `main-13uyn0` (GitHub): has items 1–3 only (tooling, dashboard, sidebar row).
  A pull request was never opened by this session, though the option was
  discussed.
- Local working tree (this container): every item above sits uncommitted —
  including `handoff.md`'s own edit. This container is ephemeral; the durable
  copies of items 4a–4c are the three `.patch` files already sent to the
  user, not anything in this filesystem.
