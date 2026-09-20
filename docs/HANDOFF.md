# Collabify — complete project handoff

**Written 2026-09-20.** Branch `main`, commit `c6d1f85`.
Live at https://dyci-collabify.vercel.app · repo `LemmuelAlinea/dyci.collabify`.

This is everything an assistant needs to pick the project up cold. Read it once,
then read `CLAUDE.md` at the repo root — that file holds the rules you must not
break, and this one holds the map.

---

## 1. What this is and who it is for

Collabify is a web application that runs school projects at **Dr. Yanga's
Colleges** in Bulacan, Philippines. It is the owner's capstone project, built
for a professor who asked that it serve the whole school rather than one course.

It has **two workplaces**, picked at registration, on one account:

| Workplace | For | Who |
|---|---|---|
| **Education** | Class projects — a professor sets boards and deadlines, student groups work them | student · professor · admin |
| **General** | Everything else the school runs — research papers, school events, competitions, community extension, accreditation, capstone systems | anybody, no role |

Education came first and is the older, larger half. General was built over
2026-09-17 → 09-20 and is where all recent work has happened.

The problem it solves, in the owner's words to the professor: school projects
live in a group chat for decisions, a shared drive for the paper, a private
message for who is doing what, and nothing at all for whether the work will
finish on time. When a member leaves or a term ends, the record leaves with
them. Collabify keeps one project in one place, with a history nobody can
rewrite.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **React 19** + TypeScript | function components, no class components |
| Build | **Vite 7** | `npm run dev` → http://localhost:5173 |
| Routing | **react-router-dom 7** | all routes in `src/App.tsx`, lazy-loaded |
| Styling | **Tailwind CSS v4** | `@tailwindcss/vite`, no `tailwind.config.js` — tokens live in `src/styles/index.css` |
| Backend | **Supabase** | Postgres 17.6, Auth, Storage, Realtime, pg_cron |
| Motion | **motion** (Framer) | always through `components/motion/Reveal.tsx` or `useReducedMotion` |
| Tests | **vitest** | `node` environment, `src/**/*.test.ts`, pure logic only |
| Lint | **eslint 10** + typescript-eslint | flat config in `eslint.config.js` |
| Hosting | **Vercel** | deploys `main` automatically; `vercel.json` holds the SPA rewrite and security headers |
| 3D | `three` + `@react-three/fiber` + `drei` | landing page only |
| Office files | `mammoth` (docx in), `docx` (docx out), `exceljs` (xlsx both ways) | all lazy-loaded via `import()` |

**There is no chart library.** Every chart in the product is hand-built HTML and
CSS — see `src/components/analytics/PressureChart.tsx` and
`src/components/general/GanttChart.tsx`. The entry bundle is ~312 KB and the
shapes needed are bars and markers. Do not add one without asking.

**There is no component test framework.** Vitest runs in `node` over pure logic
in `src/lib/**` only. Verification of components happens in the browser.

---

## 3. Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b --noEmit
npm run test         # vitest run   (377 tests, 23 files)
npm run check        # the whole gate, see below
node scripts/db.mjs supabase/<file>.sql      # apply SQL
node scripts/set-role.mjs <email> <role> [status]
```

`npm run check` = typecheck → lint → test → build → contrast → a11y-names →
schema-drift → motion-lint → legal-ready.

**Lint baseline is 23 warnings, 0 errors.** An untracked scratch file
`docs/redesign/serve-dashboard-preview.mjs` produces 3 errors, so run lint as:

```bash
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
```

`legal-ready` reports "not ready yet (not enforced)" and will keep doing so
until the supervising professor and the college DPO are named. That is waiting
on the owner, not on code.

`schema-drift` reports **4 items to check by hand**. All four are benign and
pre-existing. Anything above 4 is new and yours.

### The SQL shell preamble

`db.<ref>.supabase.co` is IPv6-only on the owner's machine, so every
`node scripts/db.mjs` call must run in a shell prepared like this **in the same
Bash invocation**:

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
```

Never print `SUPABASE_DB_URL` or the password. **There is one live database** —
there is no staging copy. Schema files are applied for real; test files end in
`rollback` and change nothing.

### Environment

`.env.local`, gitignored, holds four keys:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — safe in the browser
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` — **must never** appear in
  frontend code, in Vercel, or in any committed file

---

## 4. Repository map

```
src/
  App.tsx              every route, lazy-loaded
  routes/ProtectedRoute.tsx    role + workplace gate
  context/             AuthContext (session + profile), ThemeContext
  hooks/               useLive (realtime + poll), per-page data hooks
  lib/
    api/               one module per feature; every Supabase call lives here
    general/           the General workplace's pure logic, each with tests
    legal/             privacy/terms/cookies document content
    types.ts           Education row types and shared helpers
    limits.ts          every length cap, mirrored from the database
    authError.ts       turns a Supabase error into a sentence
  components/
    ui/                Button, Field, Modal, Tabs, Alert, Toast, Icon, …
    app/               AppShell, TopNav, nav.ts, WorkplaceSwitcher
    general/           the General workplace's components
    analytics/ tasks/ classes/ groups/ …   Education components
    motion/Reveal.tsx  the only sanctioned animation wrapper
  pages/
    auth/ legal/ app/ general/
  styles/index.css     ALL design tokens, light and dark in one block
supabase/              58 .sql files, applied in order; 31 test suites
scripts/               db.mjs, schema-drift.mjs, a11y-names.mjs, contrast.mjs,
                       motion-lint.mjs, legal-ready.mjs, set-role.mjs, …
docs/                  setup, deploy, backup, privacy runbooks
docs/superpowers/      specs and implementation plans for each build
.superpowers/sdd/      execution ledger (progress.md) — read it for history
```

---

## 5. Data model

### Shared between workplaces

`profiles` is the hinge. One row per account.

| Column | Meaning |
|---|---|
| `role` | `student` · `professor` · `admin` · **null** — null means the account has not entered Education |
| `status` | `active` · `pending` · **`rejected`** — `rejected` means **deactivated**, not "application refused". A rejected account is blocked from both workplaces |
| `home_workplace` | `education` · `general` — where sign-in lands |

Also shared: `notifications`, `notification_prefs`, `conversations` /
`messages` (with `kind = 'class' | 'group' | 'direct' | 'project'`), and one
Storage bucket per feature.

**`role` and `status` are changeable only by an admin**, enforced by the
`profiles_guard_privileged` trigger. The single exception is `enter_education()`,
which lets a General account pick student or professor once.

### Education (the older half)

`classes` → `class_members` → `group_sets` → `groups` → `group_members` →
`project_boards` → `project_tasks` → `task_assignees` / `task_events`.
Plus `teaching_resources` (syllabi, curriculum), `announcements`, polls,
submissions, reassignments, results, analytics views, audit log.

### General (25 tables)

| Group | Tables |
|---|---|
| Project | `general_projects`, `general_members`, `general_teams`, `general_team_members`, `general_positions`, `general_position_holders` |
| Access | `general_grants`, `general_access_requests`, `general_invitations`, `general_join_codes` |
| Fields | `general_fields`, `general_field_values` |
| Tasks | `general_tasks`, `general_task_assignees`, `general_task_comments`, `general_task_files`, `general_task_logs`, `general_task_events` |
| Files | `general_repos`, `general_commits`, `general_blobs`, `general_repo_changes`, `general_repo_comments` |
| Drafts | `general_drafts`, `general_draft_files` |

### The General permission model

Two layers, and this is the single most important thing to understand:

**Level** — every member is `owner`, `manager` or `member`.
**Grant** — an Owner can give one member *one* permission on top of their level.

The five permissions: `edit_project`, `manage_members`, `manage_structure`,
`manage_tasks`, `edit_files`.

- Owner has all five, plus changing levels, answering access requests,
  archiving, and handing over ownership.
- Manager has all five.
- Member views everything, comments, claims and works on tasks, and attaches
  files to tasks they hold.
- A Member can **request** a permission; any Owner approves or declines.

Enforced by `general_can(project, permission)` in `supabase/general.sql`, used
by every RLS policy and every write function. Mirrored in
`src/lib/general/permissions.ts` **for the interface only** — the database is
the authority. Keep the two in step.

**Positions are not permissions.** A position ("Adviser", "Treasurer") is a
free-text name the project's creator invents. It describes a person and grants
nothing, so naming somebody Treasurer is never a security decision.

### Files and drafts — the model worth understanding

A project has one file store. Every file is a row in `general_blobs` keyed by
path, so **folders are just the `/` in a path** — there is no folder table.
`documents/Chapter 1.docx` needs no record of `documents/`.

Four file kinds:

| Kind | Stored in | Editor | Diff |
|---|---|---|---|
| `text` | `content` | textarea | line by line |
| `rich` | `content` as HTML | contenteditable | line by line on the words |
| `sheet` | `content` as JSON | grid | cell by cell |
| `binary` | Supabase Storage, `storage_path` | none | "replaced" |

A `.docx` upload converts once into `rich` and becomes a file the site owns;
"Download as Word" regenerates it. Conversion is **lossy** and the import dialog
says so before it happens.

Three places a change can live:

1. **Main** — `general_blobs`, read through the `general_repo_tree` view. Only a
   commit puts anything here.
2. **My draft** — `general_draft_files`, **private to one person**. Nobody else
   reads it, not even an Owner. That is deliberate: a chapter can sit
   half-rewritten for a week without the group seeing a mess.
3. **For review** — submitting a draft turns the whole set into one
   `general_repo_changes` row, which is read, commented on, and merged or closed.

A draft remembers the commit it started from. When Main moves on, the draft
reports which of *its* files were touched underneath it rather than silently
rebasing.

**`git clone` and `git push` do not work and will not without new
infrastructure.** A real Git server needs to speak the Git wire protocol, which
Supabase cannot. The Code notice in the Files tab says so in place rather than
letting somebody find out by trying.

---

## 6. Pages, and what each is for

### Public

| Route | Purpose |
|---|---|
| `/` | Landing page. Three.js hero, sections explaining the product |
| `/login` `/register` | Registration picks the workplace first, then role if Education |
| `/forgot-password` `/reset-password` `/check-email` | Password recovery |
| `/auth/callback` `/onboarding` | Google sign-in lands here; onboarding asks the workplace question |
| `/pending` | A professor awaiting admin approval |
| `/education/enter` | A General account choosing student or professor, once |
| `/privacy` `/terms` `/cookies` | Legal documents, versioned, consent recorded |

### Shared (any signed-in account)

| Route | Purpose |
|---|---|
| `/settings` | Profile, avatar, theme, notification preferences |
| `/privacy/request` | Data export or erasure request under the Data Privacy Act |

### General workplace

| Route | Purpose |
|---|---|
| `/general` | Your projects, your invitations, create or join a project |
| `/general/projects/:projectId` | One project — five tabs, below |
| `/general/messages` | Project conversations and direct messages |

The project page's five tabs, all reached by `?tab=`:

- **Overview** — core fields (name, description, start, end, status, points) plus
  added fields of ten types, each renameable and reorderable
- **Tasks** — board and list, filterable; a task detail dialog with holders,
  comments, files, time log and history
- **Files** — Main / My draft / For review / History
- **Progress** — where we are, the Gantt timeline, will we finish in time, what
  is late and landing next *(newest, merged 2026-09-20)*
- **Members** — levels, extra permissions, teams, positions, invitations, join
  code, access requests

### Education — student

`/student` dashboard · `/student/classes` · `/student/groups` ·
`/student/projects` (boards) · `/student/tasks` · `/student/calendar` ·
`/student/reports` · `/student/messages`

### Education — professor

`/professor` dashboard · classes · groups · projects · `/professor/submissions`
(groups that handed in, sectioned by class) · `/professor/reassignments` ·
`/professor/analytics` · `/professor/reports` · `/professor/syllabi` ·
`/professor/curriculum` · `/professor/privacy` · calendar · messages

### Education — admin

`/admin` dashboard (includes a General workplace **counts band** — figures only,
never project content) · professor approvals · accounts · audit log · privacy
requests · notices · sections · library · classes · faculty · cohort

---

## 7. Data flow

```
Component
  └─ page hook (useGeneralProject, useTaskBoard, useStudentDashboard, …)
       └─ src/lib/api/*.ts          ← the ONLY place supabase is called
            └─ supabase-js
                 └─ PostgREST  →  view or table  →  RLS policy  →  rows
                 └─ RPC        →  security definer function  →  guard trigger
```

Rules that hold everywhere:

- **No component calls `supabase` directly.** Every call goes through
  `src/lib/api/`. The one exception is a single recovery-session check in
  `ResetPassword`.
- **Reads go through views** where a view exists (`general_project_overview`,
  `general_task_overview`, `general_repo_tree`, `conversation_overview`). Views
  are `security_invoker = true`, so RLS still applies to the caller.
- **Writes that touch more than one row go through an RPC** — a
  `security definer` function that checks permission itself. Single-row writes
  go direct and rely on RLS plus a guard trigger.
- **Realtime + poll.** `useLive(load, [tables])` subscribes to Postgres changes
  and also refetches on focus, on visibility, on `online`, and every 30 s.
  Realtime does **not** apply RLS to DELETE events, so tables whose primary key
  would leak are deliberately kept out of the publication.

### A worked example: saving a task

1. `TaskDialog` calls `updateTask(id, patch)` in `src/lib/api/general.ts`.
2. Before that it checks `startsAt > dueAt` itself, so the person gets a
   sentence rather than a Postgres error.
3. PostgREST issues the UPDATE. `general_tasks_update` (RLS) decides whether the
   caller may write the row at all.
4. `guard_general_task` (trigger) decides which *columns* they may change —
   this is where the narrow "team-clearing" exemption lives.
5. `record_general_task_event` (trigger) writes a history row naming what
   changed and what it changed *from*.
6. `useLive` hears the change and the component reloads.

---

## 8. Design system

**Never hardcode a colour.** Everything reads from tokens in
`src/styles/index.css`, where light and dark are defined in the same block — a
raw hex breaks one of them.

- Surfaces `surface`, `surface-raised`, `surface-sunken`
- Text `text-ink`, `text-muted`, `text-faint`
- Lines `border-line`, `border-line-strong`
- Ramps `navy-*` (600 is the brand), `amber-*` (400 is the accent)

Type: `font-display` (Outfit) for headings, `font-sans` (Instrument Sans) for
body, `font-mono` (JetBrains Mono) for eyebrows and numerals. `.eyebrow` for
small mono uppercase labels, `.shell` for page gutters, `.blueprint` for the
grid motif, `.rich-body` for a Word document being edited.

Dark mode is the `.dark` class on `<html>`, set pre-paint by an inline script in
`index.html`. **Never switch on a media query alone.**

### Copy rules

Sentence case. Active voice. No exclamation marks. No "please". No
"successfully". **Errors say what happened and what to do next.**

### Layout

Desktop first, then tablet, then phone — not a widened mobile column. Wide
content scrolls **inside its own container**; the page never scrolls sideways.
`AppShell` sets `overflow-x-clip`, so anything wider than the viewport is
silently cut off rather than scrollable. This has bitten twice.

### Automated gates

- `scripts/contrast.mjs` — every token pair against WCAG
- `scripts/a11y-names.mjs` — icon-only buttons need an `aria-label`. **It checks
  nothing else** — a clean run does not mean an input is labelled
- `scripts/motion-lint.mjs` — rejects ungated `hover:translate-*`

---

## 9. SQL conventions

58 files in `supabase/`, applied **in the order listed in `ORDER` in
`scripts/schema-drift.mjs`** — which must match the rebuild command in
`docs/07-backup.md`. Adding a file means appending it to both.

Rules:

- **Every file is idempotent.** `create or replace`, `if not exists`, and
  `do $$ … exception when duplicate_object then null; end $$` for constraints
  and enums.
- **A later file may redefine an earlier file's function or view.**
  `schema-drift.mjs` tracks this and warns when a redefinition is *shorter* than
  what it replaces. `create or replace view` can only **append** columns.
- **A new enum value must be added and committed in its own transaction** before
  anything uses it.
- Every `security definer` function sets `search_path = public` and is revoked
  from `public, anon`.
- Test files print `PASS`/`FAIL` through `raise notice` and end in `rollback`.

### Traps learned the hard way

- **PL/pgSQL:** an `IF`/`ELSIF` condition containing a `CASE … THEN` at paren
  depth 0 fails to parse with "syntax error at end of input". Compute the CASE
  into a variable first.
- **RLS on UPDATE/DELETE:** Postgres only applies the SELECT policy when the
  statement reads columns. An unfiltered `delete … where true` runs under the
  write policy alone.
- **A zero-row write is not a permission problem.** A write RLS filters out
  returns no rows and no error, and that has three possible causes: already
  gone, archived, or permission lost. Messages must not assert the permission
  one — this bug shipped four separate times before being fixed at the source.
- **`CASE … END` returning string literals** needs an explicit cast when
  assigned to an enum column.
- **A migration and the drop it enables belong in one transaction.** Split
  apart, a failed drop left a document migration to run a second time and
  duplicate every row.

---

## 10. Testing and verification

| Layer | What | Where |
|---|---|---|
| Pure logic | **377 unit tests, 23 files** | `src/lib/**/*.test.ts`, vitest, node env |
| Database | **~464 PASS across 31 suites** | `supabase/tests/*.test.sql`, rollback harness |
| Contrast | every token pair | `scripts/contrast.mjs` |
| Accessible names | icon-only buttons | `scripts/a11y-names.mjs` |
| Motion | ungated hover transforms | `scripts/motion-lint.mjs` |
| Schema | redefinition chain | `scripts/schema-drift.mjs` |
| Components | **browser only** | there is no component test framework |

Every SQL test pairs a refusal with a **succeeding control**, so a test that
passes because the setup was wrong is caught. Write new ones the same way.

---

## 11. How work gets done here

The owner uses the `superpowers` skills. The established pipeline:

**brainstorming → writing-plans → subagent-driven-development**

1. `/superpowers:brainstorming` — questions one at a time, then a design written
   to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
2. `superpowers:writing-plans` — a numbered task plan with complete code, to
   `docs/superpowers/plans/`
3. `superpowers:subagent-driven-development` — one implementer subagent per
   task, a reviewer after each, a whole-branch review at the end

**The review round is not optional, and here is why.** Across the last three
builds, reviews found defects the plans' own tests never caught:

- a live **email leak** through an invitation embed
- four **deactivated-account holes**
- a **permission hole** letting somebody with `manage_structure` move anyone's
  task start date
- a bar drawn 101% across its container
- an axis that rendered **zero ticks** for a whole class of input
- tasks **silently dropped** from a chart
- a chart unreachable by keyboard and unreadable without colour
- the same "you do not have permission" lie in four separate files

The plan's own code is a **detailed draft, not a verified one**. Treat it that
way.

Progress is tracked in `.superpowers/sdd/progress.md`. **Read it before
re-dispatching anything** — a task marked complete there is done, and its
commits exist in git even if conversation memory does not.

---

## 12. Security invariants — do not break these

1. `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend
   code, in Vercel, or in any committed file.
2. `role` and `status` are changeable only by an admin, enforced by the
   `profiles_guard_privileged` trigger — not just by the interface.
3. Avatar uploads are scoped to `avatars/<user-id>/…` by storage policy.
4. Project file uploads are scoped to `<project-id>/files/…`, and a commit
   refuses an object outside its own project's folder.
5. `supabase/schema.sql` must stay idempotent — it gets re-run.
6. A draft is private to its owner. No policy, view or RPC may widen that.
7. Realtime publications exclude any table whose DELETE key would leak.
8. Every RLS refusal message must say what to do next, and must not claim a
   permission problem it cannot prove.

---

## 13. Where things stand

### Shipped and live

Two workplaces · the whole Education half · General projects with editable
fields, teams, free-form positions, access levels, grants and requests ·
invitations and join codes · tasks with holders, comments, files, time and
history · ten project presets drawn from Philippine school practice · one Files
tab with Main / draft / review / history · Word and Excel editing in the browser
· the Progress tab with a Gantt, a forecast and an overdue panel.

### Known gaps, in rough priority order

1. **`git clone` / `git push` are impossible** without a host speaking the Git
   wire protocol. Stated in place; a hosting decision, not a coding one.
2. **The site title still says "BSIT coursework at Dr. Yanga's Colleges"** on
   every page, which is wrong now that General serves the whole school. The
   consent copy likewise says "coursework information" to a General signup.
3. **`red-*` and `emerald-*` are not in the enumerated token ramp.** They match
   existing practice (`Alert.tsx`, `PressureChart.tsx`) but violate the literal
   "colours come only from tokens" rule. **An owner decision is pending:** should
   semantic red and green become named tokens?
4. **General has no calendar, reports or analytics.** Education has all three.
   Out of scope by design, but a visible asymmetry.
5. **Progress is tasks-only** — a paper's document state and a repository's
   commits do not feed it.
6. **Presets carry no dates**, so a new capstone's timeline is all undated rows
   until somebody fills them in. Staggering preset tasks across a term is the
   obvious next feature.
7. `legal-ready` is blocked on naming the supervising professor and the college
   DPO.
8. Two Progress panels the owner turned down and may want later: **who is
   carrying what** (per-member tasks and time logged) and **progress by team**.

### Carried minor findings

`.superpowers/sdd/progress.md` lists every Minor finding each review deferred,
with a triage decision on each. Read that list before assuming something is an
oversight — most were judged and left deliberately.

---

## 14. Working with this owner

- **Standing authorisation to commit and push** Collabify work without asking.
- **Expects self-verification, not click-through requests.** Full database and
  deploy access was granted for that reason. Run the thing, read the output, say
  what happened.
- Wants **honest reporting**: if a test fails, say so with the output; if a step
  was skipped, say that.
- Often works from a phone over Remote Control, so a browser walk on `localhost`
  may not be reachable — the live site usually is.
- Frequently hits usage limits mid-task. **On resume, check `git status`,
  `git log` and the ledger before redoing anything** — a subagent that died
  usually wrote nothing, but sometimes wrote a lot.
- Tends to ask for terse output. Honour that, but never at the cost of omitting
  a real problem.

### Signing in

You cannot create accounts or enter passwords. To verify anything behind auth,
the owner must sign in first — then you can drive the browser without touching
credentials.

---

## 15. First thirty minutes on this project

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
git log --oneline -10
cat CLAUDE.md
cat docs/HANDOFF.md                      # this file
tail -60 .superpowers/sdd/progress.md    # what was just built, and why
npm run typecheck && npm run test        # 377 should pass
```

Then read, in this order:

1. `src/App.tsx` — every route in one file
2. `src/components/app/nav.ts` — what each role sees
3. `src/lib/general/permissions.ts` — the access model, with its reasoning
4. `src/components/general/useGeneralProject.ts` — how a project page loads
5. `supabase/general.sql` — the helpers every policy leans on

The comments in this codebase explain **why**, not what. They are the fastest
way in, and they are load-bearing — several record a bug that was fixed and must
not come back.
