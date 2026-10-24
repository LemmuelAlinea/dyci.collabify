# Company roles, phase 4: QA — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on the QA role for work projects: a QA stage the PM marks, a
gate so only QA (and the PM) can pass a task out of it, Pass and Send back,
a QA queue, and Bug tasks.

**Architecture:** One new SQL file, `project-qa.sql`, last in the chain.
- It adds `general_tasks.kind` and `qa_entered_at`, plus
  `general_projects.qa_stage` (stored as a stage *name*, so it survives
  reordering).
- It adds the QA write rules and the gate inside `sync_general_task_stage`.
  The gate tests the stage the task ends up on after alignment, so a
  status-only "mark done" can't slip past.
- It adds Pass and Send-back RPCs, history and notification kinds, and a
  `my_qa_queue()` summary.
- The frontend adds the QA stage picker, Bug tasks, the QA role in the
  Members tab, a QA queue Work subview and a Home tile.

**Tech stack:** React 19 + TypeScript + Vite, Supabase (Postgres RLS,
plpgsql), Vitest, SQL tests via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-23-company-roles-design.md`
"QA" section (:245-260) and rollout phase 4.

## Global constraints

- **Idempotent.** `supabase/*.sql` must stay idempotent.
- **New file.** `project-qa.sql` goes after `project-feedback.sql`:
  - in both rebuild lines of `docs/07-backup.md`;
  - in `scripts/schema-drift.mjs` ORDER;
  - with a re-run paragraph (what it owns; which earlier files' re-runs
    require it);
  - with the CLAUDE.md chain becoming seven files.
- **Redefinitions.** Start every one from the LIVE definition
  (`pg_get_functiondef` / `pg_get_viewdef` / `pg_policies`) and change only
  what the task lists. Re-run `anon-lockdown.sql` after applying.
  `general_task_overview`'s last owner is `task-stages.sql`. Recreate it
  here with the new columns appended (drop and create, as that file does).
- **Scope.** Work projects only (`class_board_id is null`). Class-board
  Files projects and Education boards are untouched.
- **Exact names:**
  - enum `general_task_kind` (`'task','bug'`)
  - columns:
    - `general_tasks.kind general_task_kind not null default 'task'`
    - `general_tasks.qa_entered_at timestamptz`
    - `general_projects.qa_stage text` (null = default rule)
  - functions:
    - `general_qa_stage_index(p_project uuid) returns int`
    - `general_project_has_qa(p_project uuid) returns boolean`
  - RPCs:
    - `qa_pass_general_task(p_task uuid)`
    - `qa_send_back_general_task(p_task uuid, p_note text)`
    - `my_qa_queue()`
  - task event kinds `'qa_passed'`, `'qa_sent_back'`
  - notification type `'task_sent_back'`
  - frontend:
    - Work section `'qa'`
    - `src/components/work/QaQueue.tsx`
    - `src/lib/work/qa.ts`
- **QA stage rule** (spec):
  - The PM marks one **middle** stage.
  - Default (`qa_stage` null, or a name no longer in the list): the stage
    named "Testing" (case-insensitive) if it is a middle stage; otherwise
    the stage just before the last.
  - With the default 3 stages, that is "In progress".
- **The gate** applies only when the project has at least one active QA
  member:
  - Only QA and the PM can move a task out of the QA stage forward to the
    last stage.
  - Anyone who can move the task may move it back.
  - With no QA member, the QA stage is an ordinary stage.
- **QA powers** (spec table):
  - QA sees everything.
  - QA creates **Bug** tasks only.
  - QA may edit the bug tasks they created, under today's creator rule.
  - QA can't edit others' tasks, manage members or files, or hold tasks.
    *My call:* QA reviews work rather than doing it, so QA is refused as an
    assignee, like stakeholders.
  - QA keeps drafts, comments, discussion, chat and their own meetings.
- **Copy:**
  - *"Only QA or the project manager can pass a task out of {stage}."*
  - *"QA creates bug tasks only."*
  - *"QA can't hold tasks. Pick someone else."*
  - *"Add a note saying what to fix."*
  - Labels: "Bug", "Pass", "Send back", "QA queue", "Waiting for QA".
  - Sentence case, no exclamation marks, no "please", no "successfully".
- **UI.** Use design tokens (Bug badge: `danger-*` soft chip). Desktop
  first, then tablet, then phone.
- **Who sets QA** (spec):
  - The PM can make anyone except themself QA.
  - A coordinator can switch people among Member, QA and Stakeholder, and
    can invite as Member, QA or Stakeholder.
- Run `npm run build` before claiming anything works.

## Review focus

1. **Status-only "mark done"** (as My tasks sends) by a holder, on a task
   in the QA stage of a project with QA: refused with the gate message.
   The same write in a project without QA: allowed. *(Task 2.)*
2. **Stage list changes.**
   - Reordering stages keeps `qa_stage` pointing at the same named stage.
   - Renaming that stage through the editor carries `qa_stage` along.
   - Removing it, or naming the first or last stage, falls back to the
     default rule.

   *(Task 1 for SQL validation and the fallback; Task 3 for the editor.)*
3. **QA creating a normal task**, changing a task's kind, or claiming or
   being assigned a task: refused. A member creating a Bug task: allowed.
   *(Task 1.)*
4. **Send back with a blank note:** refused, and the task doesn't move.
   With a note:
   - the task moves to the stage before QA;
   - the note becomes a task comment;
   - holders get `task_sent_back` even with comment notifications off.

   *(Task 2.)*
5. **The QA queue lists tasks in the effective QA stage, oldest first**
   (by `qa_entered_at`). A task that left and re-entered QA moves to the
   back. *(Tasks 2 and 4.)*

---

### Task 1: `project-qa.sql`, columns, QA stage, QA write rules, role on

**Files:**
- Create: `supabase/project-qa.sql`, `supabase/tests/project-qa.test.sql`
  (patterns: `project-stakeholders.test.sql`; set QA fixtures with a
  service-role update of `general_members.role`).
- Modify: `docs/07-backup.md`, `scripts/schema-drift.mjs`, `CLAUDE.md`
  (seven-file chain).

**Interfaces:**
- Produces:
  - Columns `kind`, `qa_entered_at` and `qa_stage`, and the enum (in its
    own committed block).
  - `general_task_overview` recreated with `kind` and `qa_entered_at`
    appended.
  - `general_qa_stage_index(p_project)`: returns the 0-based index per the
    QA stage rule. `stable security definer`, readable by members:
    - stages null → defaults `{'To do','In progress','Done'}`;
    - match `qa_stage` case-insensitively among middle indexes;
    - else "Testing";
    - else n-2.
  - `general_project_has_qa(p_project)`: some member has role `qa` and an
    active profile.
- **Validation.** On `general_projects` insert/update of `qa_stage` or
  `stages`:
  - `qa_stage` must be null or match a middle stage of the effective list.
    Otherwise raise *"The QA stage must be one of the middle stages."*
  - When `stages` changes and the old `qa_stage` no longer matches a middle
    stage, set `qa_stage` to null (fallback) instead of raising, so
    removing a stage never fails.
  - Changing `qa_stage` is PM-only through the existing
    `general_has(edit_project)` update policy; nothing new is needed.
- **QA write rules** (extend from the live definitions):
  - `guard_general_task` INSERT: role `qa` → `new.kind` must be `'bug'`,
    else *"QA creates bug tasks only."*
  - `guard_general_task` UPDATE: a change of `kind` needs
    `general_can(manage_tasks)`; QA can never change it.
  - Assignees: refuse a target whose role is `qa` with *"QA can't hold
    tasks. Pick someone else."* Put this next to the stakeholder refusal
    in `guard_general_task_child`, so it covers self-claim, managers and
    leads.
- **Role on:**
  - `set_general_member_role`:
    - the PM may set `qa`;
    - a coordinator may switch among member, qa and stakeholder (not
      touching coordinators or the PM);
    - moving to `qa` deletes the target's task assignee rows in that
      project, using the same tx-local-flag cleanup phase 3 uses for
      stakeholders;
    - grants and requests are already cleared on leaving Member.
  - `invite_to_general_project`: the PM may invite as qa; a coordinator as
    member, qa or stakeholder. Drop the "QA roles are not available yet."
    refusal.
  - `join_general_project` keeps a pending invitation's role, which already
    works.

**Tests:**
- `general_qa_stage_index` returns:
  - 1 for default stages;
  - 2 for `{Planning,In progress,Testing,Done}`;
  - 2 for `{A,B,C,D}` (n-2);
  - 1 when `qa_stage='B'` on `{A,B,C,D}`.
- The PM sets `qa_stage='Done'`: refused. `qa_stage='B'`: allowed.
- Removing B from the stages sets `qa_stage` null. Reordering keeps it.
- QA inserts `kind='task'`: refused with the message. QA inserts
  `kind='bug'`: allowed.
- A member inserts `kind='bug'`: allowed. A member changes a task's kind:
  refused. A coordinator changes it: allowed.
- A QA member self-claims a task: refused. The PM assigns QA: refused. The
  PM assigns a member: allowed.
- PM sets M to qa: allowed, and M's assignee rows are gone. Coordinator
  sets a member to qa: allowed. Coordinator sets a coordinator to qa:
  refused. PM invites as qa; the invitee accepts as qa.
- `general_task_overview` exposes `kind` and `qa_entered_at`.
- A class-board project member's task insert is unaffected.

- [ ] **Step 1:** Write the test and run it. Expected: FAIL.
- [ ] **Step 2:** Write the file.
- [ ] **Step 3:** Apply twice:
  `node scripts/db.mjs supabase/project-qa.sql supabase/anon-lockdown.sql`.
- [ ] **Step 4:** The test → PASS. Every `supabase/tests/*.test.sql` →
  PASS (known class-files and accounts live-data notices excepted).
  `schema-drift` → clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 2: The gate, Pass and Send back, history, notifications, queue summary

**Files:**
- Modify: `supabase/project-qa.sql` (append),
  `supabase/tests/project-qa.test.sql`.

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces: the gate, `qa_entered_at` upkeep, both RPCs, the event kinds,
  the notification type and `my_qa_queue()`.

**Rules:**
- **`sync_general_task_stage`** (from LIVE; keep every existing branch).
  After `align_task_stage`, compute `old_i := stageIndex(old)` and
  `new_i := stageIndex(new)` from status and stage, as `lib/stages.ts`
  does. Then:
  - **Enter/leave tracking.**
    - If `new_i = qa_i` and `old_i <> qa_i` (or on INSERT at `qa_i`), set
      `new.qa_entered_at := now()`.
    - If `new_i <> qa_i`, set `new.qa_entered_at := null`.
  - **Gate.** For a signed-in caller on a work project where
    `general_project_has_qa`: if `old_i = qa_i` and `new_i > qa_i`, the
    caller's role must be `qa` or `pm`. Otherwise raise the gate message
    with the stage name, errcode `insufficient_privilege`.
  - **QA may move without holding.** When the caller is `qa` and
    `old_i = qa_i` and `new_i` is the last stage or `qa_i - 1`, allow it
    even though QA doesn't hold the task. Put this before the existing
    holder check.
- **`qa_pass_general_task(p_task)`**
  - Caller is QA or PM on the task's work project; the project is not
    archived; the task is at `qa_i`. Otherwise raise *"This task isn't
    waiting for QA."*
  - Move it to the last stage (`status = 'done'`).
  - Record a task event `qa_passed`.
- **`qa_send_back_general_task(p_task, p_note)`**
  - Same caller and stage checks.
  - Trimmed note 1–2000 characters, else *"Add a note saying what to
    fix."*
  - Move to stage `qa_i - 1` (status `in_progress`, or `todo` if that is
    stage 0).
  - Insert the note as a `general_task_comments` row by the caller.
  - Record `qa_sent_back` with `{note}`.
  - Notify each current holder (not the caller) with type
    `task_sent_back`. Title: *"{task title} was sent back"*; preview: the
    note's first 140 characters; `general_project_id` and
    `general_task_id` filled. Gate on
    `notification_prefs.task_assignments`, not `comments_mentions`, so it
    lands even with comments muted.
- **History.** Widen the `general_task_events` kind CHECK with
  `qa_passed` and `qa_sent_back`. The RPCs insert these rows directly as
  definer.
- **Notification type.** `task_sent_back`, added in its own committed
  transaction.
- **`my_qa_queue()`** returns, for the caller's live work projects where
  their role is `qa`: `project_id`, `name`, `qa_stage_name`, `waiting` (the
  count of tasks at the effective QA index, not archived) and
  `oldest_entered_at`. It is `security definer stable`, granted to
  authenticated and revoked from anon.

**Tests:**
- Project with a QA member, task at the QA stage held by M:
  - M sets `status='done'` (status-only): refused with the gate message.
  - M moves it back a stage: allowed.
  - QA passes via the RPC: done, `qa_passed` event, `qa_entered_at` null.
  - QA sets `stage = last` directly: allowed.
  - The PM passes: allowed.
  - A coordinator moves it out forward: refused.
- Remove the QA member: M sets done: allowed (the stage is ordinary now).
- Moving a task into QA sets `qa_entered_at`. Leaving clears it.
  Re-entering resets it.
- Send back:
  - blank note: refused, and the task doesn't move;
  - with a note: moved to `qa_i - 1`, a comment row exists, a
    `qa_sent_back` event exists, and the holder gets `task_sent_back` even
    with `comments_mentions` off.
- Pass on a task not at the QA stage: refused. A member calling pass:
  refused. On an archived project: refused.
- `my_qa_queue()` for QA returns the project with `waiting = 1`; for a
  member it returns nothing.

- [ ] **Step 1:** Add the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Apply twice with anon-lockdown.
- [ ] **Step 4:** Run the test plus `general-tasks*`, `task-stages*`,
  `general-history*`, `project-team-leads`, `project-stakeholders`, then
  the full suite once → PASS. `schema-drift` → clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 3: Frontend, QA role, the QA stage picker, Bug tasks

**Files:**
- Modify:
  - `src/lib/general/types.ts` (`GeneralTask.kind`, `qa_entered_at`;
    project `qa_stage`)
  - `src/lib/api/general.ts` (`createTask` accepts `kind`; `TaskPatch` and
    `updateGeneralProject` accept `qa_stage`)
  - `src/lib/work/types.ts` and `workSource.ts` (`WorkItem.kind`)
  - `src/lib/general/permissions.ts`:
    - `assignableRoles`: PM → `['coordinator','member','qa','stakeholder']`;
      coordinator on a member/qa/stakeholder target →
      `['member','qa','stakeholder']`
    - `inviteRoles`: PM → `['member','coordinator','qa','stakeholder']`;
      coordinator → `['member','qa','stakeholder']`
    - `assignableTo`: drop QA candidates
    - `ROLE_MATRIX`: QA rows lose their "Coming later" captions
- Modify: `src/components/tasks/StagesEditor.tsx`.
  - Optional prop `qaStage?: string | null` and
    `onQaStageChange?(name: string | null)`.
  - When provided, render a "QA stage" select listing the middle stages,
    plus "Default (Testing, or the stage before the last)".
  - When a stage is renamed, carry the selection to the new name. When it
    is removed, reset to null.
  - Education callers pass nothing and see no change.
- Modify: `src/components/general/OverviewTab.tsx`. `DetailsForm` passes
  and saves `qa_stage` (PM only, as stages are).
- Bug tasks:
  - `NewTaskDialog` (TasksTab): a Type select (Task, Bug), locked to Bug
    for QA.
  - Backlog quick-add creates `kind:'bug'` when `myRole === 'qa'`.
  - A Bug badge on `TaskCard`, `TaskTable` and the `TaskDialog` header.
  - A "Type" filter (All, Tasks, Bugs) in the TasksTab `FilterPopover`,
    included in the count and Clear all.
  - `TasksFromNotes` creates normal tasks; hide it for QA.
- Create: `src/lib/work/qa.ts` with:
  - `qaStageIndex(stages: string[] | null, qaStage: string | null): number`,
    mirroring `general_qa_stage_index`;
  - `inQa(task, stages, qaStage): boolean`, using `stageIndex`.
- Tests:
  - `src/lib/work/qa.test.ts`: the same four index cases as Task 1, plus
    `inQa`.
  - `permissions.test.ts`: the updated role arrays, and `assignableTo`
    dropping QA.
  - A StagesEditor helper test if the rename/remove carry is a pure
    function. Export `carryQaStage(prevStages, nextStages, qaStage)` and
    test it: rename carries, remove → null, reorder keeps.

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Check in a temporary harness (delete it after): the
  editor with the QA select, and the Bug badge and filter. Light and dark,
  375 px.
- [ ] **Step 5:** Commit and push.

### Task 4: QA queue, Pass and Send back in the UI, Home tile, history, hand off

**Files:**
- Modify: `src/lib/work/nav.ts`, `src/components/work/WorkNav.tsx`,
  `src/components/general/WorkTab.tsx`. Add Work section `'qa'` ("QA
  queue"), shown when `general_project_has_qa` is true, or `myRole` is qa
  or pm. Expose `has_qa` on the project overview the same way `has_pm` is,
  appended to `general_project_overview` in `project-qa.sql` (its last
  definition) and re-applied.
- Create: `src/components/work/QaQueue.tsx`.
  - Lists tasks where `inQa(...)`, oldest `qa_entered_at` first: title, Bug
    badge, holders with badges, and how long it has waited.
  - For QA/PM: **Pass** (calls `qa_pass_general_task`) and **Send back**,
    which opens a dialog with a required note, then calls
    `qa_send_back_general_task`.
  - Errors go through `authErrorMessage`, shown in a toast.
  - Empty state: *"Nothing is waiting for QA."*
- `TaskDialog`: when the task is in QA and the viewer is QA/PM, show Pass
  and Send back there too.
- Home: in `WorkOverview`'s tiles, a "Waiting for QA" tile from
  `my_qa_queue()` (sum of `waiting`), linking to the project with the most
  waiting at `?tab=work&work=qa`. Show it only when the caller has QA
  projects.
- History: `GeneralTaskEvent.kind` gains `qa_passed`/`qa_sent_back`.
  `describeEvent` in `src/lib/general/history.ts` gives:
  - *"{name} passed it"*
  - *"{name} sent it back: {note}"*
- Bell: add `task_sent_back` to the type union. `destination()` opens
  `?task=<id>` (the default task route).
- Tests:
  - `nav.test.ts`: the `'qa'` section is listed.
  - `history` tests: the two strings.
  - A pure `queueOrder(tasks)` helper in `qa.ts` (oldest `qa_entered_at`
    first, nulls last), with a test.
- Handoff:
  - append a phase 4 section to `handoff.md` in house style;
  - "Still to check by you": make a test account QA on Capstone 2 (which
    has a Testing stage), move a task to Testing, try "mark done" as the
    holder (refused), then Pass and Send back as QA;
  - Deferred, from the ledger;
  - Next: nothing queued, company roles complete.

  Update CLAUDE.md: phase 4 live, the seven-file chain, and the QA rules
  in brief.

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement, including the SQL view column, re-applied with
  anon-lockdown.
- [ ] **Step 3:** `npx vitest run`, `npm run build`, `npx eslint src` →
  clean. All SQL tests → PASS. `schema-drift` → clean.
- [ ] **Step 4:** Check in a temporary harness: the queue with Pass and
  Send back, and the Home tile. Light and dark, 375 px.
- [ ] **Step 5:** Commit and push.
