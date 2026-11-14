# Admin offboarding and oversight by office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin deactivate a member and hand over everything they hold in one atomic step,
give a stuck work space a new PM, and see each work project's office.

**Architecture:** One new idempotent SQL file, `supabase/offboarding.sql`, with admin-only security
definer functions (a preview, the atomic offboarding, a space PM assign, and two small reads). It
redefines nothing and uses two existing transaction-local flags to pass existing guards. The
frontend adds `lib/offboarding.ts` + `lib/api/offboarding.ts`, an Offboard dialog on Accounts, an
office column on Work projects and space lines on Admin Home's Needs attention band.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-offboarding-design.md`

## Global Constraints

- Atomic: if any step of an offboarding fails, nothing changes (one function, one transaction).
- Admin only: every new function refuses anyone but an active admin (reuse `require_office_admin()`
  / `office_admin_reads()` from `supabase/offices.sql`).
- Work spaces and work projects only (`general_spaces.kind = 'work'`, `class_board_id is null`).
- Successors are active `member` accounts with Project manager on, never the target, never an admin.
- Open tasks = not `done`, `trashed_at is null`, `archived_at is null`, project not archived;
  planning tasks included.
- Never redefine an existing function, trigger or guard. Pass guards only with the existing flags
  `collabify.space_role_cascade` (assignee deletes) and `collabify.team_leader_clear` (team-lead
  clears), set with `set_config(…, 'on', true)` and reset to `'off'` after.
- The function writes no task history row: `record_general_assignee_event` writes `unassigned`.
- Counts and names only reach the admin; no project content.
- `supabase/offboarding.sql` runs after `supabase/offices.sql`, before `supabase/anon-lockdown.sql`;
  apply with `node scripts/db.mjs supabase/offboarding.sql supabase/anon-lockdown.sql <suite>`
  (the linked live project; additive; approved).
- Database refusals reach the person as-is: wrap Supabase errors in
  `new Error(authErrorMessage(err, '<fallback>'), { cause: err })` before a `ConfirmDialog` / `Modal`
  shows them (a Supabase error is a plain object, not an `Error`).
- Tokens only; copy in sentence case, active voice, no "please", no "successfully", no exclamation
  marks; desktop first, then tablet, then phone. `npm run build` passes before a task is done.

## Review Focus

1. **The successor is also a member of the project already, as Coordinator or QA**: they become PM
   and keep one membership row, not two. Test in Task 1.
2. **The target is PM of an archived project or space**: it is handed over too; a team seat on an
   archived project is cleared (the flag). Test in Task 1.
3. **The target holds tasks in a project where they are not PM**: those are unassigned too, and only
   their own assignee row goes (co-assignees stay). Test in Task 1.
4. **The admin opens Offboard, someone changes the person's roles, then the admin confirms**: the
   function works from the database's state at confirm time, not the preview's; a line the preview
   showed that no longer applies is skipped, not refused. Test in Task 1.
5. **No eligible successor exists** (nobody else has Project manager on): the dialog says so and
   points to Accounts' switch; confirm stays disabled. Test in Task 4.

---

### Task 1: Offboarding preview and the atomic offboard (`supabase/offboarding.sql`)

**Files:**
- Create: `supabase/offboarding.sql`
- Create: `supabase/tests/offboarding.test.sql`

**Interfaces:**
- Consumes: `require_office_admin()`, `office_admin_reads()` (offices.sql); `is_project_manager(uuid)`.
- Produces:
  - Audit values `offboarded`, `space_pm_assigned` (own committed transaction first, as `offices.sql`).
  - `admin_offboarding_preview(p_user uuid) returns table(kind text, item_id uuid, item_name text,
    project_name text, space_name text, office_name text, archived boolean, task_count int)` —
    `kind` in `space_pm` | `project_pm` | `team_lead` | `reviewer` | `open_tasks`. `space_pm`:
    `item_id` = space. `project_pm`: `item_id` = project. `team_lead`: `item_id` = team,
    `project_name` set. `reviewer`: one row per project, `item_id` = project, `task_count` = tasks
    in `coordinator_review` with `reviewer_id` = target. `open_tasks`: one row, `item_id` null,
    `task_count` = open tasks held. Zero rows when they hold nothing. Ordered space, project, team,
    reviewer, open_tasks, then name.
  - `admin_offboard_member(p_user uuid, p_successor uuid, p_overrides jsonb default '{}') returns
    void` — `p_overrides` is `{"<space or project id>": "<user id>"}`.

- [ ] **Step 1: Write the failing suite** in the pattern of `supabase/tests/offices.test.sql`
  (rolled back; fixture names prefixed `Zz`). Seed: admin A, target T (member, PM on), successors S1
  and S2 (members, PM on), member M without PM switch, an admin X with PM on. T is PM of work space
  WS1 (live) and WS2 (archived), PM of project P1 (in WS1) and P2 (archived), Coordinator on P3
  where S1 is PM, lead of team T1 on P1 and T2 on P2, reviewer on two `coordinator_review` tasks in
  P1, assignee on: open task K1 (P1, co-assignee M), done task K2, archived task K3, open task K4 in
  P2, open task K5 in P3, planning task K6 in P1. S1 is already Coordinator on P1. Assertions:
  - `preview refuses a non-admin`; `preview lists 2 spaces, 2 projects, 2 teams, 1 reviewer line
    with 2, open_tasks 3` (K1, K5, K6).
  - `offboard refuses a non-admin`, `… an inactive admin`, `… the target being an admin`,
    `… the admin themself`, `… a successor without Project manager` (M), `… an admin successor`
    (X), `… the target as successor`, `… an inactive successor`.
  - After `admin_offboard_member(T, S1, {P2: S2})`:
    `WS1 and WS2 have S1 as PM and T as Coordinator`; `P1 has S1 as PM, one row for S1, T is
    Coordinator`; `P2 has S2 as PM`; `P3 is unchanged`; `T1 and T2 have no leader`;
    `both reviews now name S1`; `K1, K5, K6 lose T, K1 keeps M`; `K2, K3, K4 keep T`;
    `each removed assignee left exactly one unassigned event`; `T is deactivated`;
    `one offboarded audit row: after_value = S1's name, before_value = '2 spaces, 2 projects,
    2 teams, 3 tasks'`.
  - `an override naming M rolls back everything`: call with `{P1: M}` inside a sub-block, catch the
    error, assert T is still active and still PM of P1 and WS1.
  - `a line gone since the preview is skipped`: remove T as PM of P1 by direct update as the service
    role before the call; the call succeeds.
- [ ] **Step 2: Run it and see it fail**
  Run: `node scripts/db.mjs supabase/tests/offboarding.test.sql`
  Expected: error, `function public.admin_offboarding_preview(uuid) does not exist`.
- [ ] **Step 3: Write `supabase/offboarding.sql`.** Header comment: what it owns, run position, the
  two flags. Preview as above. `admin_offboard_member`, in order and under `for update` locks on the
  target profile, then each space/project/team/task row it changes:
  validate (copy: `'Only an admin can offboard someone.'`, `'Choose someone else to take over.'`,
  `'<name> needs Project manager turned on first. Turn it on in Accounts.'`, `'Only an active
  member can take over.'`, `'Only an active member can be offboarded here.'`); spaces (join as
  member if absent, set target `coordinator`, successor `pm`, in that order for the one-PM index);
  projects (same order; successor's existing row is promoted, not duplicated; clear the successor's
  `general_grants` on that project as `assign_general_project_pm` does); teams (`leader_id = null`
  under `collabify.team_leader_clear`); reviews (`reviewer_id` = that project's new PM); assignee
  deletes under `collabify.space_role_cascade`; `profiles.status = 'rejected'`, `decided_by`,
  `decided_at`; the `offboarded` audit row (counts with correct singular/plural; omit zero parts).
  `revoke all … from public, anon; grant execute … to authenticated` on both functions.
- [ ] **Step 4: Run it twice and see it pass**
  Run: `node scripts/db.mjs supabase/offboarding.sql supabase/anon-lockdown.sql supabase/tests/offboarding.test.sql`
  Expected: every line `PASS`, both runs.
- [ ] **Step 5: Commit** — `git add supabase/offboarding.sql supabase/tests/offboarding.test.sql`,
  message "Offboard a member and hand over their spaces and projects in one step".

### Task 2: Space PM assign and the oversight reads (same file)

**Files:**
- Modify: `supabase/offboarding.sql`, `supabase/tests/offboarding.test.sql`

**Interfaces:**
- Produces:
  - `admin_assign_space_pm(p_space uuid, p_user uuid) returns void` — refuses (`'This space already
    has a project manager.'`) unless the space has no working PM (no `pm` row, or the PM is not
    active, or `can_manage_projects` is off); same successor rules as Task 1; end state as Task 1's
    space step; writes `space_pm_assigned` (subject the space, after the new PM's name).
  - `admin_spaces_without_pm() returns table(space_id uuid, space_name text, office_name text)` —
    live (not archived, not trashed) work spaces with no working PM; office name `''` when none or
    archived (phase 1's Unassigned rule).
  - `admin_project_offices() returns table(project_id uuid, office_id uuid, office_name text)` —
    every work project (not trashed) with its space's live office, null/`''` when none.
- [ ] **Step 1: Add failing assertions:** `assign refuses while the PM is active with the switch
  on`; `assign works when the PM's switch is off`; `assign works on a space with no pm row`;
  `assign writes one space_pm_assigned row`; `spaces_without_pm lists the switched-off space and not
  a healthy one`; `project_offices names the office of a filed space and '' for an unfiled one`;
  the three refuse a non-admin (zero rows or raise, as the reads in offices.sql do).
- [ ] **Step 2: Run, see it fail** (same command as Task 1 Step 4).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run twice, see it pass.**
- [ ] **Step 5: Commit** — message "Let the admin give a stuck space a project manager".

### Task 3: Frontend data layer

**Files:**
- Create: `src/lib/offboarding.ts`, `src/lib/offboarding.test.ts`, `src/lib/api/offboarding.ts`
- Modify: `src/lib/types.ts` (`AuditAction`, `AUDIT_ACTIONS`, `auditSentence`),
  `src/pages/app/admin/AuditLog.tsx` (`ICON`, `TONE`)

**Interfaces:**
- Produces in `lib/offboarding.ts`:
  - `type OffboardLine = { kind: 'space_pm' | 'project_pm' | 'team_lead' | 'reviewer' | 'open_tasks';
    item_id: string | null; item_name: string; project_name: string; space_name: string;
    office_name: string; archived: boolean; task_count: number }`
  - `handoverLines(lines: OffboardLine[]): OffboardLine[]` — only `space_pm` and `project_pm`.
  - `buildOverrides(lines: OffboardLine[], successor: string, picks: Record<string, string>):
    Record<string, string>` — only entries whose pick differs from `successor`.
  - `readyToOffboard(lines: OffboardLine[], successor: string | null): boolean` — true when there
    is a successor, or when there are no handover lines.
  - `isEligibleSuccessor(a: { id: string; role: string | null; status: string;
    can_manage_projects: boolean }, targetId: string): boolean`.
- Produces in `lib/api/offboarding.ts`: `offboardingPreview(userId): Promise<OffboardLine[]>`,
  `offboardMember(userId, successorId, overrides): Promise<void>`,
  `assignSpacePm(spaceId, userId): Promise<void>`, `spacesWithoutPm(): Promise<{ space_id: string;
  space_name: string; office_name: string }[]>`, `projectOffices(): Promise<{ project_id: string;
  office_id: string | null; office_name: string }[]>`.
- Audit: `offboarded` label 'Offboarded', sentence `${who} was offboarded and handed over to
  ${after}` (`(${before})` appended when before is non-empty); `space_pm_assigned` label 'Space
  PM assigned', sentence `The space ${who} now has ${after} as project manager`. Icon `swap` for
  both; tone `bg-warning-400/18 text-warning-700 dark:text-warning-300` for `offboarded`, muted for
  the other.
- [ ] **Step 1: Failing tests** in `offboarding.test.ts`: `buildOverrides keeps only changed lines`;
  `readyToOffboard needs a successor when spaces or projects are listed`; `readyToOffboard is true
  with only tasks and teams`; `isEligibleSuccessor refuses the target, an admin, an inactive account
  and someone without Project manager`; and in `src/lib/auditSentence.test.ts`
  `an offboarded line names the successor and the counts`.
- [ ] **Step 2: Run** `npx vitest run src/lib/offboarding.test.ts src/lib/auditSentence.test.ts`. FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again and `npm run typecheck`.** PASS.
- [ ] **Step 5: Commit** — message "Read offboarding from the app and label it in the audit log".

### Task 4: Offboard dialog on Accounts

**Files:**
- Create: `src/pages/app/admin/accounts/OffboardDialog.tsx`, `src/pages/app/admin/accounts/OffboardDialog.test.tsx`
- Modify: `src/pages/app/admin/Accounts.tsx` (the Deactivate path, ~line 434 and ~485)

**Interfaces:**
- Consumes: Task 3. `OffboardDialog` props: `{ person: { id: string; name: string }; candidates:
  { id: string; name: string }[]; lines: OffboardLine[]; onClose(): void; onDone(): void }`.
  Accounts builds `candidates` from its own rows with `isEligibleSuccessor`.

Behaviour: **Deactivate** on an active member calls `offboardingPreview`. Empty → the existing
confirmation. Otherwise the Offboard dialog (layout as the spec's sketch): a "Hand everything to"
`Select`; one row per space and project with its own `Select` defaulting to the successor; team
lines say "Seat emptied. The project manager picks a lead." with the project name; reviewer lines
say "N reviews move to that project's new project manager."; the open-tasks line says "N open
tasks are unassigned and go back to their teams." Confirm label "Deactivate and hand over",
disabled until `readyToOffboard`. A preview failure shows an `Alert` with retry in place of the
dialog body. Students keep today's path.

- [ ] **Step 1: Failing render tests:** `lists every preview line with its project name`;
  `defaults every space and project to the chosen successor`; `sends only changed lines as
  overrides` (expects `offboardMember('t', 's1', { p2: 's2' })`); `keeps confirm disabled without
  a successor`; `says nobody can take over when there are no candidates, and points to Accounts'
  Project manager switch` (Review Focus 5); `shows the database refusal as-is` (reject with a plain
  `{ message }` object).
- [ ] **Step 2: Run** `npx vitest run src/pages/app/admin/accounts/OffboardDialog.test.tsx`. FAIL.
- [ ] **Step 3: Implement** and wire it into Accounts.
- [ ] **Step 4: Run, then `npm run build`.** PASS.
- [ ] **Step 5: Commit** — message "Offboard a member from Accounts".

### Task 5: Office on Work projects and stuck spaces on Admin Home

**Files:**
- Modify: `src/pages/app/admin/WorkProjects.tsx`, `src/pages/app/admin/WorkProjects.test.tsx`
- Modify: `src/pages/app/admin/home/AttentionBand.tsx`, `src/pages/app/AdminHome.test.tsx`

**Interfaces:**
- Consumes: `projectOffices`, `spacesWithoutPm`, `assignSpacePm` (Task 3); `AssignPmDialog` from
  `components/general/NoPmNotice.tsx` is for projects only, so the space assign uses a small
  `Modal` + candidate `Select` built from `listAccounts()` (`lib/api/accounts.ts`) rows filtered
  with `isEligibleSuccessor(row, '')` — no new SQL.

- Work projects: an **Office** column (`'Unassigned'` when none) and an office filter beside the
  search, using `projectOffices()` joined by id; projects with no PM still first; the existing
  `?assign=` behaviour unchanged.
- Admin Home's Needs attention: space lines first, "Space has no project manager", with an
  **Assign** button opening the space assign dialog; the count, cap of 6 and "N more" include them.
- [ ] **Step 1: Failing tests:** WorkProjects `shows each project's office and filters by it`;
  AdminHome `lists a space without a project manager with an Assign button` and `assigning calls
  assignSpacePm and reloads`.
- [ ] **Step 2: Run** the two test files. FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, then `npm run build`.** PASS.
- [ ] **Step 5: Commit** — message "Show offices on Work projects and stuck spaces on Home".

### Task 6: Docs and full checks

**Files:**
- Modify: `docs/07-backup.md` (add `supabase/offboarding.sql` after `supabase/offices.sql` in every
  run line; an "Offboarding" entry), `CLAUDE.md` (an "Offboarding" bullet under Project roles: the
  functions, the two flags, open-task rule, run position, suite), `handoff.md` (a dated section at
  the end: what shipped, SQL applied, verification, Deferred).

- [ ] **Step 1:** `npm run build`, `npm test`, and the Task 1 command. All green.
- [ ] **Step 2:** Write the docs; commit "Document offboarding and oversight by office".
- [ ] **Step 3:** The controller walks it in the browser as the admin: opens Offboard on a real
  member who holds something, checks the lines and defaults, and cancels (the full offboard is
  proven by the rolled-back suite; no real account is deactivated and no account is created). Then
  it stops for the user's review before pushing `main`.
