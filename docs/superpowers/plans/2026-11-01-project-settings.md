# Project Settings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give work projects a Settings tab (General, Sprints, Tasks, Members & permissions) that gathers today's scattered project controls and adds per-project sprint automation.

**Architecture:** Sprint options live in a new `general_sprint_settings` table owned by `supabase/sprint-settings.sql`, which also narrows sprint start/finish to the project manager and coordinators and adds a `pg_cron` job, `run_sprint_automation()`, that finishes, creates and starts sprints. The app reads the settings through `useGeneralProject`. A new `components/general/settings/` shell renders four sections. Three of them reuse the existing People, Project info and archive code, moved rather than rewritten.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens from `src/styles/index.css`, Supabase Postgres (plpgsql, RLS, pg_cron), Vitest, SQL suites run with `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-01-project-settings-design.md`

## Global Constraints

- Work projects only (`general_projects.class_board_id is null`); class boards, `board_sprints` and class projects are untouched.
- Colors only from tokens (`surface*`, `text-ink/muted/faint`, `border-line*`, `navy-*`, `amber-*`, status ramps); never raw hex, `emerald-*` or `red-*`.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully"; errors say what happened and what to do next.
- Desktop layout first, then tablet, then phone.
- Every `supabase/*.sql` file is idempotent; `anon-lockdown.sql` is re-run after it; restore order recorded in `docs/07-backup.md`.
- Redefinitions start from the live `pg_get_functiondef` (`guard_sprint_state` is owned by `sprint-reopen.sql`; `complete_general_sprint` by `work-planning.sql`).
- Time is always `Asia/Manila`.
- Commit locally after each task. **Do not push and do not run SQL on the live database without the owner's go-ahead.** Run SQL suites with the new file's body loaded inside the suite's own `begin … rollback` (see "Dry-run SQL" below) until the owner approves.
- Defaults: auto finish off, auto start off, unfinished tasks `ask`, length 14 days, start day derived (first sprint's start weekday, else Monday), time 09:00.

**Dry-run SQL** (until approved): write a scratch copy of the suite with the file under test pasted after the suite's first `begin;` (strip that file's own `begin;`/`commit;`), then `node scripts/db.mjs <scratch file>`. Expected: every check prints `PASS`, the run ends in `rollback`, and nothing reaches the live database.

## Review Focus

1. **The automation runs twice in one window** (cron overlap, or a retry): nothing changes on the second run. No second sprint is created and no second notification goes out. *(Task 2, test "a second run changes nothing")*
2. **Someone finishes a sprint by hand just before the job runs**: the job doesn't try to finish it again, and creates the next sprint only if auto-start is on and nothing is planned. *(Task 2, test "after a manual finish, creates the next sprint once")*
3. **The created sprint would start after the project's due date**: no sprint is created, and leftovers set to "next" go to the backlog. *(Task 2, test "no sprint is created past the project due date")*
4. **An archived project with automation on**: the job skips it completely. *(Task 2, test "archived projects are skipped")*
5. **Old links to the People tab** (`?tab=people`, `?tab=members` from notifications and the dashboard): they open Settings → Members & permissions. *(Task 5, navigation tests)*

---

### Task 1: Sprint settings table and sprint control rule (SQL)

**Files:**
- Create: `supabase/sprint-settings.sql` (this task writes its first half)
- Create: `supabase/tests/sprint-settings.test.sql`

**Interfaces:**
- Produces:
  - Table `public.general_sprint_settings`:
    - `project_id uuid primary key references general_projects(id) on delete cascade`
    - `auto_finish boolean not null default false`
    - `auto_start boolean not null default false`
    - `auto_start_since timestamptz` (set by trigger when `auto_start` turns true, cleared when false)
    - `carry text not null default 'ask' check (carry in ('ask','next','backlog'))`
    - `length_days int not null default 14 check (length_days between 1 and 90)`
    - `start_weekday int check (start_weekday between 0 and 6)` (null = derived; 0 = Sunday, as `extract(dow)`)
    - `run_at time not null default '09:00'`
    - `updated_by uuid`, `updated_at timestamptz`
    - Table check `not (auto_finish and carry = 'ask')`.
  - `public.general_can_run_sprint(p_project uuid) returns boolean`: stable, security definer. True when `general_role_of(p_project)` is `pm` or `coordinator`. Per-team sprints later add "or the lead of this sprint's team" here.
  - The sprint control rule: a `general_sprints` update whose state changes to `active` or `completed` is refused unless `general_can_run_sprint(project_id)` is true, or `auth.uid()` is null (the cron job).
  - `complete_general_sprint` checks `general_can_run_sprint` instead of `general_can(..., 'manage_tasks')`.
  - Realtime: `general_sprint_settings` added to `supabase_realtime`.

- [ ] **Step 1: Write the failing suite** `supabase/tests/sprint-settings.test.sql`. Use the same harness as `supabase/tests/sprint-reopen.test.sql`: `act_as`, `act_as_service`, `must_be`, `must_refuse`, three users Owner/Coord/Member, the member given a `manage_tasks` grant through `grant_general_permission` or a service insert into `general_grants`. Checks:
  - `'a project has no settings row until one is saved'`
  - `'the project manager can save sprint settings'`: upsert with `length_days = 7`
  - `'a coordinator can change sprint settings'`
  - `'a member cannot change sprint settings'` (refused)
  - `'auto finish cannot be on while unfinished tasks ask'` (refused: `auto_finish = true, carry = 'ask'`)
  - `'turning auto start on stamps auto_start_since'`, then `'turning it off clears it'`
  - `'a member with manage_tasks cannot start a sprint'` (refused direct `state = 'active'`)
  - `'a member with manage_tasks cannot finish a sprint'` (refused `complete_general_sprint`)
  - `'a member with manage_tasks can still move a task into a sprint'`
  - `'a coordinator can start and finish a sprint'`
  - `'settings on an archived project cannot change'` (refused)

- [ ] **Step 2: Dry-run the suite without the file.** Expected: it fails at the first check that needs the table (`relation "general_sprint_settings" does not exist`).

- [ ] **Step 3: Write the first half of `supabase/sprint-settings.sql`.** Header comment: what it owns, and "run after `sprint-reopen.sql`; re-running `work-planning.sql` (owner of `complete_general_sprint`) or `sprint-reopen.sql` means re-running this file after it". It adds:
  - the table, checks, `alter publication` (in a `duplicate_object` guard as `work-planning.sql` does), and `grant select, insert, update` to authenticated;
  - RLS: select with `can_read_general_project(project_id)`; insert and update with `general_can_run_sprint(project_id) and not general_is_archived(project_id)`; no delete policy;
  - a BEFORE INSERT OR UPDATE trigger that stamps `updated_by = auth.uid()`, `updated_at = now()` and maintains `auto_start_since`;
  - `general_can_run_sprint`;
  - a separate BEFORE UPDATE trigger on `general_sprints`, `general_sprints_run_guard`, for the sprint control rule (leave `guard_sprint_state` alone);
  - `complete_general_sprint`, redefined from its live definition with only the permission check changed (message: "Only the project manager or a coordinator can finish a sprint.").

- [ ] **Step 4: Dry-run the suite with the file loaded.** Expected: every check passes. Also dry-run `work-planning.test.sql`, `sprint-reopen.test.sql` and `sprint-milestones.test.sql` with the file loaded. Any check that relied on a `manage_tasks` grant holder starting or finishing a sprint must be updated to the new rule, in the same commit. Expected: 0 failures.

- [ ] **Step 5: Commit** `supabase/sprint-settings.sql`, the new suite and any adjusted suites: "Limit sprint start and finish to the project manager and coordinators".

---

### Task 2: Sprint automation job (SQL)

**Files:**
- Modify: `supabase/sprint-settings.sql` (second half)
- Modify: `supabase/tests/sprint-settings.test.sql`

**Interfaces:**
- Consumes: Task 1's table and `general_can_run_sprint`.
- Produces:
  - `public.run_sprint_automation(p_now timestamptz default now()) returns int` (number of projects changed). Security definer, `search_path = public`, execute revoked from `public, anon, authenticated`. `p_now` exists so tests can set the clock.
  - Cron job `'collabify-sprint-automation'`, `'*/15 * * * *'`, `select public.run_sprint_automation()`. Unschedule-then-schedule, as `general-notify.sql` does.
  - Notification type `'sprint_automation'`, inserted with `general_project_id` set, sent to every member whose role is `pm` or `coordinator` and whose profile is active.

- [ ] **Step 1: Add failing checks** to the suite. Each check sets up sprints with service inserts, sets a settings row, then calls `run_sprint_automation(<a fixed timestamptz>)`:
  - `'auto finish waits for the day after the end date and the set time'`: running sprint ending D, `run_at 09:00`. At D+1 08:59 Manila, still running. At D+1 09:00 Manila, finished.
  - `'leftovers move to the earliest planned sprint when carry is next'`
  - `'leftovers return to the backlog when carry is backlog'`
  - `'auto start starts the earliest planned sprint once its start date and time arrive'`
  - `'auto start creates the next sprint when none is planned, then starts it when its day comes'`. Name `'Sprint ' || (count + 1)`. Start is the first `start_weekday` on or after max(last `ends_on` + 1, today). Length is `length_days`. Goal empty, no milestone.
  - `'no sprint is created before auto start was turned on'`: the last sprint finished before `auto_start_since`, so nothing is created.
  - `'no sprint is created past the project due date'`: new start > `general_projects.ends_on`, so nothing is created and carry `next` goes to the backlog.
  - `'after a manual finish, creates the next sprint once'`: the finish happens outside the job, then run twice. Exactly one planned sprint.
  - `'a second run changes nothing'`: the same `p_now` twice gives the same sprint states and the same notification count.
  - `'archived projects are skipped'`
  - `'the project manager and coordinators are notified of each automatic action'`: count of `sprint_automation` rows. Members get none.
  - `'start weekday falls back to the first sprint, then Monday'`

- [ ] **Step 2: Dry-run.** Expected: FAIL, `function run_sprint_automation does not exist`.

- [ ] **Step 3: Implement `run_sprint_automation`.** Per project with `auto_finish or auto_start`, not archived, ordered by id, inside its own `begin … exception when others then raise warning … end` block:
  - take `pg_advisory_xact_lock(hashtext('sprint-automation:' || project_id))`;
  - `local := p_now at time zone 'Asia/Manila'`; `due := local::time >= run_at`;
  - finish, then create, then start.
  - **Finish:** with `auto_finish`, `due` and `ends_on < local::date`. Carry target is the earliest planned sprint (`starts_on`, `created_at`). If there is none, `carry = 'next'` and the create rule allows it, create one first. Otherwise null. Move non-done, unarchived tasks the way `complete_general_sprint` does, set `state = 'completed'`, notify.
  - **Create:** with `auto_start`, no active and no planned sprint, a completed sprint whose `completed_at >= auto_start_since`, and the computed start not after the project `ends_on` (when set).
  - **Start:** with `auto_start`, no active sprint, `due`, and the earliest planned `starts_on <= local::date`. Set `state = 'active'` and notify.
  - Notification copy:
    - finish: title "{name} finished on its own", preview "{n} unfinished tasks moved to {next}." / "…returned to the backlog." / "Every task was done."
    - start: title "{name} started on its own", preview its date range.
    - create: folded into the start or finish notice; no separate one.
  - Start weekday: `coalesce(start_weekday, extract(dow from first sprint starts_on), 1)`.

- [ ] **Step 4: Dry-run the suite.** Expected: every check passes. Re-run the three sprint suites. Expected: 0 failures.

- [ ] **Step 5: Commit**: "Finish, create and start sprints on their own when a project asks".

---

### Task 3: Sprint settings in the app's data layer

**Files:**
- Create: `src/lib/work/sprintSettings.ts`, `src/lib/work/sprintSettings.test.ts`
- Modify: `src/lib/work/sprints.ts` (`nextSprintDraft` takes settings), `src/lib/work/sprints.test.ts`
- Modify: `src/lib/api/sprints.ts`
- Modify: `src/components/general/useGeneralProject.ts`
- Modify: `src/lib/types.ts` (add `'sprint_automation'` to the notification type union), `src/components/app/NotificationBell.tsx` (link: `?tab=plan&work=sprints`)

**Interfaces:**
- Produces:
  - `type SprintCarry = 'ask' | 'next' | 'backlog'`
  - `type SprintSettings = { autoFinish: boolean; autoStart: boolean; carry: SprintCarry; lengthDays: number; startWeekday: number | null; runAt: string /* 'HH:MM' */ }`
  - `DEFAULT_SPRINT_SETTINGS: SprintSettings` (values from Global Constraints)
  - `startWeekdayOf(settings: SprintSettings, sprints: readonly Sprint[]): number`
  - `nextSprintDraft(sprints: readonly Sprint[], now?: number, settings?: SprintSettings): SprintInput`. The settings argument is optional so class boards keep 14 days and no weekday alignment.
  - `getSprintSettings(projectId: string): Promise<SprintSettings>` (defaults when there's no row) and `saveSprintSettings(projectId: string, s: SprintSettings): Promise<void>` (upsert on `project_id`)
  - `GeneralProjectState.sprintSettings: SprintSettings`, loaded in `reload`'s `Promise.all`, with `'general_sprint_settings'` added to `useLive`

- [ ] **Step 1: Write failing Vitest cases.**
  - `sprintSettings.test.ts`: `startWeekdayOf` returns the saved day; falls back to the first sprint's start weekday (`'2026-10-29'` is Thursday, so 4); with no sprints returns 1.
  - `sprints.test.ts`: with settings `{ lengthDays: 7, startWeekday: 4 }` and latest end `'2026-11-11'` (a Wednesday), `nextSprintDraft` gives `startsOn '2026-11-12'`, `endsOn '2026-11-18'`. Without settings the current behavior is unchanged.
- [ ] **Step 2: Run** `npx vitest run src/lib/work`. Expected: the new cases fail.
- [ ] **Step 3: Implement** the types, defaults, helpers, API calls (map snake_case ↔ camelCase, `run_at` trimmed to `HH:MM`) and state loading.
- [ ] **Step 4: Run** `npx vitest run src/lib/work` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit**: "Load each project's sprint settings".

---

### Task 4: Sprint controls follow the new rule and the settings

**Files:**
- Modify: `src/lib/work/types.ts` (`WorkSource`), `src/components/general/workSource.ts`, `src/components/tasks/classWorkSource.ts`
- Modify: `src/components/work/BacklogView.tsx` (Start sprint at ~line 180, Create sprint draft at ~line 276), `src/components/work/SprintsView.tsx` (Finish button, Reopen dialog), `src/components/work/FinishSprintDialog.tsx`
- Modify: `src/lib/general/permissions.ts` (`ROLE_GUIDE` row "Plan sprints and milestones"; add a row "Start, finish and reopen sprints": pm yes, coordinator yes), `src/lib/general/permissions.test.ts`

**Interfaces:**
- Consumes: Task 3's `SprintSettings`, `nextSprintDraft(sprints, now, settings)`.
- Produces: `WorkSource.canRunSprints: boolean` and `WorkSource.sprintSettings?: SprintSettings`. Work: `live && (myRole === 'pm' || myRole === 'coordinator')`. Class: `canPlan`, no settings.

- [ ] **Step 1: Write failing tests.**
  - `permissions.test.ts`: the role guide has "Start, finish and reopen sprints" with only `pm` and `coordinator`.
  - A `FinishSprintDialog` test (new `src/components/work/FinishSprintDialog.test.tsx`, Testing Library like `TaskDialog.test.tsx`): with `sprintSettings.carry = 'backlog'` the "Back to the backlog" choice starts selected; with `'next'` and a planned sprint, the next sprint starts selected.
- [ ] **Step 2: Run** these tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Start sprint and Finish sprint show only when `source.canRunSprints`.
  - Create sprint uses `nextSprintDraft(source.sprints, Date.now(), source.sprintSettings)`.
  - The Finish dialog pre-selects from `carry`.
  - The Reopen dialog adds "Automatic finishing is on and this sprint's end date has passed, so it will finish again at {run_at}." when `sprintSettings.autoFinish` and `ends_on <` today.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit**: "Show sprint start and finish only to the project manager and coordinators".

---

### Task 5: Settings tab shell, navigation and Members section

**Files:**
- Modify: `src/lib/general/navigation.ts`, `src/lib/general/navigation.test.ts`
- Create: `src/components/general/settings/ProjectSettings.tsx` (side menu + section switch)
- Create: `src/components/general/settings/MembersSection.tsx` (the body of today's `MembersTab`: action buttons, `MemberList`, `RoleGuide`, `StructurePanel`, the requests and invite modals, `HandOverDialog`)
- Modify: `src/components/general/MembersTab.tsx` (keeps `MemberList`; exports what `MembersSection` needs) or delete it if fully absorbed
- Modify: `src/pages/general/GeneralProject.tsx` (tab row: `settings` replaces `people` with the same count badge; render `ProjectSettings`)

**Interfaces:**
- Produces:
  - `GeneralTabId` gains `'settings'` and loses `'people'`; `LEGACY` maps `people` and `members` → `'settings'`
  - `export type SettingsSection = 'general' | 'sprints' | 'tasks' | 'members'`
  - `settingsSection(params: URLSearchParams): SettingsSection`: reads `?section=`, and `?tab=people` / `?tab=members` mean `'members'`, default `'general'`
  - `<ProjectSettings state={state} />`

- [ ] **Step 1: Write failing navigation tests.**
  - `generalTab(new URLSearchParams('tab=people'))` → `'settings'`
  - `generalTab('tab=members')` → `'settings'`
  - `settingsSection('tab=members')` → `'members'`
  - `settingsSection('tab=settings&section=sprints')` → `'sprints'`
  - `settingsSection('tab=settings&section=nope')` → `'general'`
- [ ] **Step 2: Run** `npx vitest run src/lib/general/navigation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Layout A: the menu is a 200px left column on desktop and a horizontally scrolling row under `md`.
  - Menu labels: General, Sprints, Tasks, Members & permissions. The active item uses `nav-active` / `nav-marker`.
  - The section changes the URL with `replace`.
  - General, Sprints and Tasks render placeholders until Tasks 6–7 (one line: "This section is being moved here.").
  - `changeTab` in `GeneralProject.tsx` clears `section` when leaving Settings.
- [ ] **Step 4: Run** `npx vitest run src/lib/general src/components/general` and `npm run typecheck`. Then walk it on the preview: `?tab=members` opens Settings → Members, which shows everything People showed. Expected: pass.
- [ ] **Step 5: Commit**: "Replace the People tab with Settings".

---

### Task 6: General and Tasks sections; Project info view-only; archive moves

**Files:**
- Create: `src/components/general/settings/GeneralSection.tsx`. Details (name, description, dates, status) and custom fields, moved from `OverviewTab.tsx`'s `DetailsPanel`/`DetailsForm`/`FieldsPanel`/`FieldRow`/`StoredFieldValue`, plus an "Archive project" / "Restore project" area at the bottom (project manager only, using the confirm and `archiveGeneralProject` from `GeneralProject.tsx`).
- Create: `src/components/general/settings/TasksSection.tsx`: progress stages and QA stage, split out of `DetailsForm` with the same `checkStages` / `stagesToSave` / `updateGeneralProject({ stages, qa_stage })`.
- Modify: `src/components/general/OverviewTab.tsx`. The Project info modal shows the details, stages and fields read-only. "View all / Edit" becomes "View all", and the modal has "Edit in Settings" links to `?tab=settings&section=general` and `&section=tasks` when `state.can('edit_project')`.
- Modify: `src/pages/general/GeneralProject.tsx`. Remove the header Archive `IconAction`. The archived banner's "Restore it" opens Settings → General.
- Test: `src/components/general/OverviewTab.test.ts` (extend)

**Interfaces:**
- Consumes: Task 5's `ProjectSettings` slots and `SettingsSection`.
- Produces: `<GeneralSection state />`, `<TasksSection state />`.

- [ ] **Step 1: Write failing tests.** In `OverviewTab.test.ts` (or a new `settings/GeneralSection.test.tsx`): Project info shows no editable inputs, and its edit link points to `tab=settings&section=general`. Stages save through `TasksSection` with the same validation message as today ("Progress stages: …").
- [ ] **Step 2: Run** these tests. Expected: FAIL.
- [ ] **Step 3: Implement** by moving code (no behavior changes). Editing needs `state.can('edit_project') && !state.readOnly`. Everyone else sees read-only values.
- [ ] **Step 4: Run** `npx vitest run src/components/general` and `npm run typecheck`. Then walk the preview: edit details and a field in Settings, change stages in Tasks, archive and restore from General. Expected: pass.
- [ ] **Step 5: Commit**: "Move project details, stages and archive into Settings".

---

### Task 7: Sprints section

**Files:**
- Create: `src/components/general/settings/SprintsSection.tsx`, `src/components/general/settings/SprintsSection.test.tsx`

**Interfaces:**
- Consumes: Task 3's `SprintSettings`, `saveSprintSettings`, `startWeekdayOf`; `state.sprintSettings`; `WorkSource.canRunSprints` rule (`myRole` is `pm` or `coordinator`, not `readOnly`).
- Produces: `<SprintsSection state />`

The controls, in this order, labels exact:

| Label | Control | Help text |
|---|---|---|
| Sprint organization | segmented: Sequential (selected), "Multiple sprint streams · soon" and "Flexible parallel · soon" (disabled) | One sprint runs at a time. |
| Finish sprints automatically | switch | When the end date passes, at the time below. |
| Start the next sprint automatically | switch | Creates the next sprint if none is planned. Never makes a duplicate, and never starts one after the project's due date. |
| Unfinished tasks at finish | select: Ask on finish / Move to the next sprint / Return to the backlog | Where tasks that are not done go. |
| Default sprint length | number, days, 1–90 | |
| Sprint start day | select Sunday–Saturday | |
| Start and finish time | time select, 30-minute steps | Philippine time. |

Footer: "Only the project manager and coordinators can change these. Changes apply to this project only."

- [ ] **Step 1: Write failing tests.**
  - Read-only for a member: all controls disabled.
  - Turning "Finish sprints automatically" on while carry is `ask` switches the select to "Move to the next sprint", disables "Ask on finish", and shows "Unfinished tasks will move to the next sprint. You can choose the backlog instead."
  - Save calls `saveSprintSettings` with the edited values.
  - The two "soon" options are disabled.
- [ ] **Step 2: Run** these tests. Expected: FAIL.
- [ ] **Step 3: Implement.** One Save button, matching Project info's form. The toast says "Sprint settings saved". Errors go through `authErrorMessage`.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit**: "Add sprint settings".

---

### Task 8: Docs, full checks and owner review

**Files:**
- Modify: `docs/07-backup.md`. Add `supabase/sprint-settings.sql` after `supabase/sprint-reopen.sql` in both restore commands and the rerun tail, and a short section on what it owns.
- Modify: `CLAUDE.md` (Project roles: sprint start/finish/reopen and settings are pm/coordinator, `general_can_run_sprint`), `handoff.md` (new section at the end), `.gitignore` (add `.superpowers/`)

- [ ] **Step 1: Run** `npm run build`, `npx vitest run`, `npx eslint` on changed files, and the dry-run SQL suites (`sprint-settings`, `sprint-reopen`, `work-planning`, `sprint-milestones`, `class-planning`). Expected: all green.
- [ ] **Step 2: Walk the localhost preview** as the project manager, then as a coordinator, a member with a `manage_tasks` grant, QA and a stakeholder (the owner signs in for each).
  - Who sees and can edit each section.
  - Old People links.
  - Project info is view-only.
  - Archive and restore.
  - Start/Finish visibility.
  - Desktop, tablet and phone widths.
- [ ] **Step 3: Commit** the docs: "Document project settings and sprint automation".
- [ ] **Step 4: Stop for owner review.** Ask before:
  1. running `node scripts/db.mjs supabase/sprint-settings.sql supabase/anon-lockdown.sql` on the live database;
  2. pushing `main`.

  Order once approved: SQL first, then push.
