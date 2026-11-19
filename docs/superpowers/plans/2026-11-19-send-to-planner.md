# Send to planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Plan & route work, the project manager sends selected Planning tasks straight to themselves or an
active coordinator, with an optional team.

**Architecture:** One new security-definer RPC, `send_work_tasks_to_planner`, in a new file
`supabase/send-to-planner.sql` that releases and assigns in one transaction and redefines nothing. The app adds
`sendTasksToPlanner` to `lib/api/general.ts`, a PM-only picker in `TaskRoutingPanel.tsx`, and a history line for
the `holder_id` detail.

**Tech Stack:** Postgres/Supabase (plpgsql), React + TypeScript, Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-11-19-send-to-planner-design.md`

## Global Constraints

- PM only (`general_role_of(project, auth.uid()) = 'pm'`); coordinators are refused in SQL and see no picker.
- Holder is the caller or an active (`profiles.status = 'active'`) project `coordinator`; nobody else.
- Planning queue only; no subtasks (`parent_id` not null), no held tasks, no stale rows.
- Team optional; a non-null team must be a live team (`archived_at is null`) of this project; no lead required.
- History reuses kind `sent_to_team` with `holder_id` in `detail`; no new event kind, no new notice.
- `supabase/send-to-planner.sql` is idempotent, runs after `file-history.sql` and before `anon-lockdown.sql`.
- Copy: sentence case, active voice, no "please", no "successfully", no exclamation marks.
- No hardcoded colors; reuse existing components (`Select`, `Button`, `Alert`).

## Review Focus

- A coordinator leaves or is deactivated while the PM has them picked: the RPC refuses with "Choose yourself or an
  active coordinator on this project." and the panel shows it with Reload tasks. (Task 1 test `inactive coordinator
  refused`.)
- A project set to one holder per task: the single insert still passes. (Task 1 test `one-holder project`.)
- A picked team archived between load and send: refused with "Choose a live team in this project.", nothing
  released. (Task 1 test `archived team refused, nothing released`.)
- Send to team after picking No team or a leadless team: the button stays disabled, so no confusing SQL error.
  (Task 3 test `send to team stays off for no team`.)
- The PM sends to themselves: no notification to anyone, history reads "took it on". (Task 1 `no notice to self`,
  Task 2 `took it on`.)

---

### Task 1: SQL action and suite

**Files:**
- Create: `supabase/send-to-planner.sql`
- Create: `supabase/tests/send-to-planner.test.sql`
- Modify: `docs/07-backup.md` (both full-run lines at 26 and 53: insert `supabase/send-to-planner.sql` before the
  final `supabase/anon-lockdown.sql`; add a short "Send to planner" section after the file-history section)
- Modify: `CLAUDE.md` (one bullet after "File history")

**Interfaces:**
- Produces: `public.send_work_tasks_to_planner(p_project uuid, p_rows jsonb, p_holder uuid) returns int`.
  `p_rows` = `[{ "id": uuid, "team_id": uuid|null, "updated_at": timestamptz }]`. Returns the number of tasks sent.
  Event detail: `{actor_id, old_team_id, new_team_id, holder_id, reviewer_id: null, reason: null,
  former_holder_ids: []}`.

- [ ] **Step 1: Write the failing suite** in the style of `supabase/tests/file-history.test.sql` (`begin; …
  rollback;`, `pg_temp.act_as`, `pg_temp.must_be`, `pg_temp.must_refuse_with`). Seed one work project with a pm, an
  active coordinator, an inactive coordinator, a member, a qa, a team with a lead, a team without a lead, an
  archived team, and planning tasks (one plain, one with a subtask, one held, one released). Checks:
  - `pm sends to self with no team`: returns 1; task `routing_state='released'`, `team_id is null`, `sent_at` set;
    one `general_task_assignees` row for the pm; one `sent_to_team` event with `detail->>'holder_id'` = pm and
    `detail->'new_team_id'` = JSON null.
  - `pm sends to coordinator with leadless team`: `team_id` = the leadless team; coordinator holds it.
  - `coordinator gets assigned notice`: one `general_task_assigned` row for the coordinator (prefs on, project
    `task_assignment_notices` true).
  - `no notice to self`: no `notifications` row for the pm from the self send.
  - `subtask follows parent`: the subtask is `released` with the parent's `team_id`.
  - `one-holder project`: with `general_projects.allow_multiple_assignees = false`, the send still succeeds.
  - Refusals (`must_refuse_with`, needle in quotes): coordinator caller → `Only the project manager sends work
    straight to a person.`; member, qa and inactive coordinator as holder → `Choose yourself or an active
    coordinator on this project.`; subtask row, held row, released row → `Send planning tasks only.`; stale
    `updated_at` → `A task changed. Reload the tasks and try again.`; archived team → `Choose a live team in this
    project.`; class-board project → `This project cannot receive handoffs. Restore it first.`; duplicate id →
    `Select each task once.`
  - `archived team refused, nothing released`: a two-row call where row two has the archived team leaves row one in
    `planning`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/db.mjs supabase/tests/send-to-planner.test.sql`
Expected: error `function public.send_work_tasks_to_planner(uuid, jsonb, uuid) does not exist`.

- [ ] **Step 3: Write `supabase/send-to-planner.sql`**

Header comment naming what it owns, its place in the order and "redefines nothing". Model the body on
`send_work_tasks_to_teams` (`supabase/work-task-handoff.sql:1576`): same project lock and refusal, same
empty/duplicate check, same `for update` loop in id order and stale check, checking everything first and writing
after. Differences:
  - Caller check: `public.general_role_of(p_project, auth.uid()) is distinct from 'pm'` → refuse.
  - Holder check (before the loop, `for share` on the member and profile rows):
    `p_holder = auth.uid()` or the holder is a `coordinator` with `profiles.status = 'active'`.
  - Row check: `t.routing_state <> 'planning' or t.parent_id is not null or public.general_task_held(t.id)` →
    `Send planning tasks only.`
  - Team check when `team_id` is not null: a `general_teams` row with that id, this `project_id`,
    `archived_at is null` (`for share`), else refuse.
  - Write loop, under `set_config('collabify.work_task_handoff','on',true)`, restored to the prior value after:
    update `routing_state='released', team_id=<row team or null>, reviewer_id=null, sent_at=clock_timestamp()`;
    insert the `sent_to_team` event (detail as in Interfaces); then
    `insert into general_task_assignees(task_id, project_id, user_id) values (t.id, p_project, p_holder)`.
  - End with `revoke all on function … from public, anon; grant execute … to authenticated;` and
    `notify pgrst, 'reload schema';`. Wrap the file in `begin; … commit;`.

- [ ] **Step 4: Apply and run the suite**

Run: `node scripts/db.mjs supabase/send-to-planner.sql supabase/anon-lockdown.sql`
then `node scripts/db.mjs supabase/tests/send-to-planner.test.sql`
Expected: every line `PASS`, no `FAIL`. Re-run `supabase/tests/project-task-rules.test.sql` and
`supabase/tests/anon-lockdown.test.sql`; both still pass.

- [ ] **Step 5: Docs and commit**

Add the two `docs/07-backup.md` line edits and its section (what it owns, that re-running
`work-task-handoff.sql` does not require re-running it, since it redefines nothing). Add the `CLAUDE.md` bullet
"Send to planner (`supabase/send-to-planner.sql`, after `file-history.sql`, before `anon-lockdown.sql`): …" in two
or three lines, naming the suite.

```bash
git add supabase/send-to-planner.sql supabase/tests/send-to-planner.test.sql docs/07-backup.md CLAUDE.md
git commit -m "Let the project manager send planned work straight to a planner"
```

### Task 2: API call and history words

**Files:**
- Modify: `src/lib/api/general.ts` (after `sendTasksToTeams`, line 1139)
- Modify: `src/lib/general/history.ts` (`describeEvent` ~line 84, `describeActivity` ~line 256)
- Test: `src/lib/general/history.test.ts`

**Interfaces:**
- Consumes: the RPC from Task 1.
- Produces: `sendTasksToPlanner(projectId: string, rows: { id: string; team_id: string | null; updated_at: string }[], holderId: string): Promise<number>`.

- [ ] **Step 1: Write the failing tests** in `history.test.ts`:
  - `names a direct send`: `describeEvent({ kind: 'sent_to_team', actor_id: 'pm', detail: { holder_id: 'ana' } …}, nameOf)`
    → `'Pat sent it to Ana'` (with `nameOf` mapping pm→Pat, ana→Ana).
  - `took it on`: holder equals actor → `'Pat took it on'`.
  - `activity names a direct send`: `describeActivity` with `actor_name: 'Pat'`, `task_title: 'Design'`,
    `detail: { actor_id: 'pm', holder_id: 'ana' }` → `'Pat sent "Design" to a planner'`; with
    `detail: { actor_id: 'pm', holder_id: 'pm' }` → `'Pat took on "Design"'`. (`ActivityEvent` has no name lookup
    and no `actor_id` field, so it compares `detail.actor_id` and says "a planner".)
  - The existing `names handoffs and keeps their reason` test keeps passing unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/general/history.test.ts`
Expected: the three new tests FAIL with the "sent it to a team" wording.

- [ ] **Step 3: Implement.** `sendTasksToPlanner` calls `supabase.rpc('send_work_tasks_to_planner', { p_project, p_rows, p_holder })`
  and throws on error, like its neighbors. In both describers, before the shared handoff branch, return the direct
  wording when `event.kind === 'sent_to_team'` and `detail.holder_id` is a string. `describeEvent` compares
  `holder_id` with `event.actor_id`; `describeActivity` compares it with `detail.actor_id`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/general/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/general.ts src/lib/general/history.ts src/lib/general/history.test.ts
git commit -m "Name a direct send in task history"
```

### Task 3: The PM's picker in Plan & route work

**Files:**
- Modify: `src/components/general/TaskRoutingPanel.tsx`
- Test: `src/components/general/TaskRoutingPanel.test.tsx` (add `sendTasksToPlanner: vi.fn()` to the mock)

**Interfaces:**
- Consumes: `sendTasksToPlanner` from Task 2.

- [ ] **Step 1: Write the failing tests** with the file's existing helpers (`state`, `render`, `selectRows`,
  `change`, `click`):
  - `sends planning tasks to the PM with no team`: `selectRows()`, `change('Person', 'pm')`,
    `click('Send to person')` → `sendTasksToPlanner` called once with
    `('project', [{ id: 'one', team_id: null, updated_at: 'stamp-one' }, { id: 'two', team_id: null, updated_at: 'stamp-two' }], 'pm')`;
    `reload` called; body contains `Tasks assigned to you.`
  - `sends to a coordinator with a team`: `change('Team for Design', 'design')`, `change('Person', 'reviewer')`, send
    → row one carries `team_id: 'design'`; body contains `Tasks sent to reviewer.`
  - `send to team stays off for no team`: PM sets `Team for Design` to `none` → the `Send to team` button is
    disabled.
  - `lists leadless teams for the PM only`: with a team `{ id: 'ops', name: 'Ops', leader_id: null }`, the PM's
    `Team for Design` select has an option `Ops (no lead)` and `No team`; with `myRole: 'coordinator'` it has
    neither and no `Person` select.
  - `no person picker outside planning`: after `click('Coordinator review')` and `click('Reroute released work')`,
    no `[aria-label="Person"]`.
  - `Send to person needs a person and a selection`: disabled until both are set.
  - The existing tests keep passing (coordinator lists and Send to team behavior unchanged).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/general/TaskRoutingPanel.test.tsx`
Expected: new tests FAIL (no `Person` select).

- [ ] **Step 3: Implement in `TaskRoutingPanel.tsx`**
  - `const direct = state.myRole === 'pm' && queue === 'planning'`. `const NO_TEAM = 'none'`.
  - Row team options: for the PM, every team in `state.teams` (label `name`, or `name + ' (no lead)'` when
    `!leader_id`), then `{ value: NO_TEAM, label: 'No team' }`; for a coordinator, today's `destinations`.
  - `ready` for Send to team: every pick's chosen team is in `destinations` (so No team and leadless teams keep it
    off).
  - New state `holder` (string) and `sentTo` (string | null). Footer, when `direct`: a `Select`
    `aria-label="Person"`, placeholder `Choose a person`, options `[{ value: viewerId, label: 'Me' }, …active
    coordinators]`, and a `Button` `Send to person`, disabled unless `editable && picks.length && holder`.
  - On click: `act(() => sendTasksToPlanner(project.id, picks.map(t => ({ id, team_id: chosen === NO_TEAM || !chosen ? null : chosen, updated_at })), holder), true)`,
    with `chosen = teams[t.id] ?? t.team_id`. Record `sentTo` before calling so the receipt reads
    `Tasks assigned to you.` when the holder is the viewer, else `Tasks sent to ${state.nameOf(holder)}.`; Send to
    team keeps `Tasks sent to team.` Clear `holder` on queue change.
  - Keep the footer wrapping on a phone (`flex-wrap`, picker `w-full sm:w-56` like the coordinator picker).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/general/TaskRoutingPanel.test.tsx src/components/general/TasksTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/general/TaskRoutingPanel.tsx src/components/general/TaskRoutingPanel.test.tsx
git commit -m "Add Send to person to the project manager's planning queue"
```

### Task 4: Build, check in the app, hand off

**Files:**
- Modify: `handoff.md` (new section at the end, with a Deferred list if anything is left)

- [ ] **Step 1:** Run `npm run build` and `npx vitest run`. Expected: build passes, all tests pass.
- [ ] **Step 2:** On the dev server (`preview_start`), signed in as a PM on a work project: open Plan & route work,
  send one planning task to Me with No team and one to a coordinator with a team. Confirm both show on the board,
  the holder is set, and the task history reads "took it on" / "sent it to <name>". Check 1280 and 390 wide.
- [ ] **Step 3:** Append the handoff section (what shipped, the file order, the suite, the live apply) and commit.

```bash
git add handoff.md
git commit -m "Note send to planner in the handoff"
```

Do not push `main`; ask the user to review first.
