# Open task flow — design

Date: 2026-11-20. Status: draft for approval.

## Intent

A work project today runs one task flow: every new task starts in private planning, the project manager or a
coordinator sends it to a team (or through a coordinator's review), and the receiving team's lead assigns it. That
fits a structured team, but small or flat teams want to skip the review: anyone on the project adds a task, it is
live at once, and they hand it to whoever should do it.

This makes the task flow a per-project choice in Settings → Tasks:

- **Planned handoff** (default, today's flow, unchanged).
- **Open**: no review when handing tasks. Every Member creates tasks that are live straight away and assigns any
  task to anyone who can hold tasks.

The New task dialog also gains **Priority** (both modes) and, in Open mode, **Holder**.

## Goals

- One project setting, `general_projects.task_flow` (`planned` | `open`), default `planned`. Existing projects keep
  today's behaviour until their project manager changes it.
- In Open mode, the project manager, coordinators and Members create live (released) tasks, with a priority and
  optional holders, in one step.
- In Open mode, the same people assign, reassign and unassign holders on any live task.
- Switching to Open releases every task still in planning or waiting for coordinator review.
- New task dialog: Priority (both modes), Holder (Open mode only).

## Non-goals

- Edit rights don't widen. A Member who neither holds nor created a task still can't edit, move, finish or archive
  it; description and dates stay with the project manager, coordinators and the team's lead; points and sprint
  placement stay with `manage_tasks`. (Decided: "Assign only".)
- No change to class boards.
- No change to subtasks' rules (they follow the parent's release state as today).
- No holder field in Planned mode. Routing still decides holders there. (Decided.)

## Anti-goals

- Weakening an existing guard for Planned projects. A Planned project must behave exactly as it does today.
- Letting stakeholders, read-only workspace viewers or QA hold tasks, or stakeholders create them.
- Bypassing the QA gate. In an Open project with active QA, the QA stage still gates exactly as today.

## Decisions (the user's)

| Question | Answer |
| --- | --- |
| Member rights on a task they neither hold nor created, in Open mode | Assign only (create, assign, reassign, unassign) |
| Planning/review tasks when switching to Open | Released at once, keeping their team |
| QA and teams in Open mode | QA gate stays. Teams stay as labels; the lead-only assign rule doesn't apply |
| Who switches the mode | Project manager only |
| New task dialog | Holder and Priority fields |
| Holder field in Planned mode | No, Open mode only |
| Build approach | A (new file, new functions, nothing redefined) |

## Approaches

- **A. New file, nothing redefined (picked).** A new `supabase/project-open-tasks.sql` adds the column and three
  security-definer functions that check the caller and the mode themselves, then write with the request's claims
  cleared, like `create_general_member_task` (`project-member-rules.sql`) and `send_work_tasks_to_planner`
  (`send-to-planner.sql`). Existing guards and policies stay as they are, so Planned projects can't regress and the
  rerun chain only grows by one file at the end. Cost: the functions re-state the checks the guards would have
  made.
- **B. Branch the existing guards.** Redefine `guard_general_task`, `guard_general_task_child`, the
  `general_tasks_insert` and `general_task_assignees_insert/_delete` policies to read `task_flow`. Direct inserts
  would just work, but it rewrites the final owners in `work-task-handoff.sql` and `project-team-leads.sql`,
  the most delicate part of the chain. Rejected for risk.

## Database (`supabase/project-open-tasks.sql`)

Runs after the current last file before `anon-lockdown.sql` (today `message-mentions.sql`), then
`anon-lockdown.sql`. Idempotent. Redefines nothing.

### Column

`general_projects.task_flow text not null default 'planned'`, check `in ('planned', 'open')`. Class boards keep
`planned` and the value means nothing there.

A guard trigger on `general_projects` refuses a change of `task_flow` made with claims unless it runs inside
`set_general_task_flow` (a transaction flag, e.g. `collabify.task_flow_set`), so the release on switch can't be
skipped by a direct update.

### `set_general_task_flow(p_project uuid, p_flow text)`

- Project manager only (`general_role_of = 'pm'`), work project, not archived.
- Locks the project row. Setting the same value is a no-op.
- `planned` → `open`: every live (not archived, not trashed) task in `planning` or `coordinator_review` becomes
  `released`: `reviewer_id` null, `sent_at` now, team kept, no holders added. Runs under
  `collabify.work_task_handoff` so the guards accept the routing change. Each task gets a history row with the
  existing `sent_to_team` kind and the project manager as actor (as `send-to-planner.sql` does). Release rules
  (`task_released`) fire through the normal trigger. `require_assignee` handling on release is the existing
  trigger's.
- `open` → `planned`: nothing moves. Released tasks stay released with their holders; new tasks start in planning
  again.
- Returns the number of tasks released, so the app can say "12 planned tasks are now live".

### `preview_general_task_flow(p_project uuid)`

Returns counts of planning and review tasks a switch to Open would release (PM only), for the confirmation.

### `create_general_open_task(p_project, p_title, p_description, p_starts_at, p_due_at, p_team, p_priority, p_kind, p_holders uuid[])`

- Caller is an active writer (`general_can_write`) whose role is `pm`, `coordinator`, `member` or `qa`; the
  project is a work project with `task_flow = 'open'`, not archived.
- QA: `p_kind` must be `bug` and `p_holders` must be empty (QA can't assign). Others: `task` or `bug`.
- Title rules and limits as `create_general_member_task` (required, 200 characters). `p_team` must belong to the
  project. Starts must not be after due. `p_priority` null means the project's default.
- Holders: each an active member of the project whose role isn't `qa` or `stakeholder`; deduplicated; more than
  one refused when `allow_multiple_assignees` is off.
- Order, all with claims cleared so `guard_general_task` takes its `auth.uid() is null` branch: insert the task in
  `planning` with `created_by` the caller; insert the holders; then update it to `released` (under
  `collabify.work_task_handoff`). Releasing after the holders exist lets the default-stage rule
  (`apply_general_task_defaults`) place it at the default stage even when `require_assignee` is on, and fires
  `task_released` workflow rules through the normal trigger, so "When a task is sent" rules cover Open-mode tasks.
  Then restore the claims and give the `created`, `assigned` and release history rows the caller as actor, and
  `assigned_by` the caller. *(Builder-check call.)*
- `sent_at` stays **null**. With it set, `general_tasks_0_sent_creator` would strip a Member's creator rights the
  moment they create the task. Left null, the creator keeps today's creator rule: they edit their task while
  nobody holds it; once someone holds it, the holder rules apply. *(Builder-check call.)*
- Assignment notices go out as they do for any new holder (`task_assignment_notices` and the holder's
  preference).
- Never sets a sprint or milestone; the task lands in the backlog.

### `set_general_task_holders(p_task uuid, p_holders uuid[])`

- Caller is an active writer with role `pm`, `coordinator` or `member` on a work project with `task_flow = 'open'`,
  not archived; the task is released, not archived, not trashed, and not in an active QA stage or Done ("Reopen
  it before changing who holds it."), mirroring Planned mode, where QA and Done work must reopen first.
  *(Builder-check call.)*
- Replaces the task's holders with `p_holders` (adds the missing, removes the rest), with the same holder checks as
  above and the single-holder rule. An empty array clears holders, unless `require_assignee` is on and the task is
  past the first stage (the existing rule's message).
- Writes with claims cleared, then fixes `assigned_by` and the history actors to the caller.
  `collabify.space_role_cascade`-style flags are not needed: it only touches assignees.
- Locks the task row so two people reassigning at once serialize.

### Grants

All four functions: revoke from `public, anon`; grant execute to `authenticated`. The guard trigger function:
revoke from everyone.

### Suite `supabase/tests/project-open-tasks.test.sql`

At least: default is planned; a Planned project's Member still can't insert or assign; a coordinator can't switch
the mode; switching releases planning and review tasks (and not archived or trashed ones) and returns the count;
a direct update of `task_flow` is refused; Member creates a live task with holders and priority; QA creates a bug
with no holders and is refused a task or holders; stakeholder and read-only viewer refused; holder who is QA or a
stakeholder refused; single-holder rule; Member reassigns a task they don't hold; Member still can't edit that
task's title or move it; QA gate still refuses a Member crossing the QA stage; switching back keeps holders and
new direct inserts start in planning again; `task_released` rule fires on an Open create.

## App

- `lib/api/general.ts`: read `task_flow` with the project's task settings; add `createOpenTask`,
  `setTaskHolders`, `setTaskFlow`, `previewTaskFlow`. `createTask` gains an optional `priority` (Planned mode:
  the PM's and coordinators' direct insert sets it).
- `lib/general/permissions.ts`: the project carries `taskFlow`. `canCreateWorkTaskWith` lets `member` create in
  Open mode; `assignableTo` / the assign checks let `pm`, `coordinator` and `member` assign anyone who can hold
  tasks in Open mode. Tests next to the existing ones.
- **Settings → Tasks** (`TasksSection.tsx`): a "Task flow" choice at the top, two options with one line each
  ("Planned handoff: tasks start in planning; the project manager or a coordinator sends them to a team." /
  "Open: anyone on the project adds live tasks and assigns them to anyone."). Only the project manager changes it;
  others read it. Switching to Open shows a confirmation with the preview counts. Settings → Members' "Members
  create tasks" switch is hidden in Open mode (it is implied) and keeps its value.
- **New task dialog** (`TasksTab.tsx` `NewTaskDialog`): a Priority select, defaulting to the project's default
  priority. It shows in both modes for the project manager and coordinators, and in Open mode for Members and QA. A
  Member in Planned mode doesn't get it: their task is reviewed, and `create_general_member_task` takes no priority.
  *(Builder-check call.)* In Open mode every role's dialog, the project manager's and coordinators' included, saves
  through `createOpenTask`. In Open mode a Holder picker (multi-select when multiple holders are allowed,
  otherwise single), listing active members who can hold tasks; QA doesn't get it. The Member's "goes to planners
  for review" description and toast don't show in Open mode; it's "Task added" and the new task opens.
- **Task dialog**: in Open mode the holder picker shows for `pm`, `coordinator` and `member` on any live task and
  saves through `setTaskHolders`.
- **Tasks tab**: in Open mode, From notes, AI drafts and other existing creation paths keep their behaviour
  (planning tasks). Plan & route and the planner queue show only while the project has planning tasks, so nothing
  is stranded; otherwise they're hidden. The empty state reads "Anyone on the project adds tasks and assigns them."
  *(Builder-check call.)*
- Copy follows the repo rules (sentence case, no "please", no "successfully").
- Walkthrough flows that point at Plan & route need to stay valid for Planned projects; Open projects skip those
  steps if a flow names them.

## Docs

`CLAUDE.md` gets a bullet for the file and its place in the order; `docs/07-backup.md` lists it in the rerun tail;
`handoff.md` gets a new section with **Deferred**.

## Left to the builder

- Exact names of the transaction flag and guard trigger.
- Whether the release on switch reuses `send_work_tasks_to_planner`-style internals or writes the update directly.
- How the holder picker looks (reuse the existing assignee picker component if one fits).
- Whether Open-mode history uses `sent_to_team` alone or also an `assigned` row per holder (whichever the task
  history already reads cleanly).
