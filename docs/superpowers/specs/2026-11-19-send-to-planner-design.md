# Send planned work straight to a planner (design)

Date: 2026-11-19. Size: small feature.

## Intent

The project manager writes the tasks in their projects. Today a planned task leaves private planning only through
Send to team, and the team's lead then picks the holder. When the PM wants to do a task themselves, or hand it to a
coordinator, they have to route it through a team and its lead first. Plan & route work should let the PM send a
planned task straight to themselves or a coordinator.

## Goals

- In Plan & route work, the project manager (only) can send selected Planning tasks to one person: themselves or an
  active coordinator on the project.
- The team is optional for this path. The PM may pick a team (for team filters and sprint streams) or leave it at
  No team. A picked team does not need a lead.
- Releasing and assigning happen in one database step, so a task is never released without its holder.

## Non-goals

- Coordinators do not get direct sending. They keep Send to team and Send for review.
- No direct sending to members, QA or stakeholders. Team leads still assign everyone on their teams.
- No direct path from Reroute released work. On a released task the PM can already add holders in the task dialog.
- Send to team, Send for review and Return to planning are unchanged.

## Anti-goals

- A task released with no holder, or a holder without a release (a half-sent task).
- Loosening any existing guard. Nothing already built is redefined.

## Approaches

- **A. New send-to-person action (picked).** A new PM-only RPC releases and assigns in one transaction. A new SQL
  file runs after the existing chain and redefines nothing. Picked because it is atomic, allows No team, and leaves
  the handoff file alone.
- B. Frontend only: Send to team, then assign. Dropped: it needs a team with a lead, tells that lead "Incoming" for
  work they won't assign, and is two steps that can fail between them.
- C. Add an optional holder to `send_work_tasks_to_teams`. Dropped: that function belongs to
  `work-task-handoff.sql`, so the change means re-running it and its whole tail on the live database.

## Design

### Database: `supabase/send-to-planner.sql`

Runs after the last file in the current tail and before `anon-lockdown.sql`, and goes into `docs/07-backup.md`.
Idempotent.

`send_work_tasks_to_planner(p_project uuid, p_rows jsonb, p_holder uuid) returns int`, security definer, granted to
`authenticated` only. `p_rows` is `[{id, team_id (nullable), updated_at}]`. It checks:

- The caller is the project's `pm`. Coordinators are refused.
- The project is a live work project (not a class board, not archived or trashed), with the same refusal copy as
  `send_work_tasks_to_teams`.
- `p_holder` is the caller, or an active `coordinator` on the project.
- Each row is a live task in this project, in `planning`, not a subtask, not held, and unchanged since
  `updated_at` (the same stale check and message as Send to team). Rows lock in id order.
- A non-null `team_id` is a live team in this project. No lead is required.

Then, under `collabify.work_task_handoff` (restored afterwards), for each task it sets `routing_state = 'released'`,
`team_id` (or null), `reviewer_id = null` and `sent_at`. It then inserts the holder into `general_task_assignees`
(the existing assignee guard already lets a pm assign on a released work task) and writes one history row.

- History reuses the `sent_to_team` kind, with `holder_id` added to its detail, because the kinds check is
  redefined in four files and a new kind would make this file a fifth owner. `new_team_id` may be null. The app
  reads it as "sent it to <holder>", or "took it on" when the holder is the actor.
- A coordinator recipient gets a `work_task_handoff` notice, "Incoming: <title>", when their `task_assignments`
  preference is on. The PM gets nothing for their own task.
- Subtasks follow their parent's release state the same way they do for Send to team.

Suite: `supabase/tests/send-to-planner.test.sql` covers PM success with and without a team, coordinator refused,
member or QA as holder refused, an inactive coordinator refused, a held, stale, released or subtask row refused,
the history detail, the notice, and a subtask that follows its parent.

### App: `TaskRoutingPanel.tsx`

- On the Planning queue only, and only for `myRole === 'pm'`, the pinned footer gets a "Send to person" picker
  (Me first, then each active coordinator by name) and a Send button.
- Each row's team picker gains a "No team" option, used only by this path. Send to team still needs a team with a
  lead and stays disabled for rows on No team.
- On success, the alert reads "Tasks sent to <name>." ("Tasks assigned to you." for Me) with the same View on board
  button. Errors use the existing reload pattern.
- `lib/api/general.ts` gets `sendTasksToPlanner`. `lib/general/history.ts` and the task dialog's handoff line learn
  `holder_id`.
- Test: `TaskRoutingPanel` shows the picker to the PM only, on Planning only, and calls the RPC with the right rows.

## Left to the builder

- Exact copy for the history line and the picker placeholder, within the copy rules.
- Whether the picker and the Send to team team picker share one footer row or wrap on a phone.
- Mirroring the new rule in `lib/general/permissions.ts` if a helper reads more cleanly than an inline check.
