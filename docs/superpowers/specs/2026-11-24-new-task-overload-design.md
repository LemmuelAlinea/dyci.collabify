# New task: stop before overloading someone

Status: approved · 2026-11-24 · builds on `2026-11-22-space-workload-balancing-design.md`

## Intent

Ivan had 16 / 40 h. The owner added a 30 h task for him in an Open project and it was created at once. A small amber
line ("Ivan Caburnay goes over available hours this week.") appeared only once both the holder and the estimate were
filled, Add task did not stop, and the line counted the whole estimate in this week even for a task due later. Asana's
rules can't stop an over-capacity assignment and ClickUp users still ask for it (feedback board), so doing this well
sets Collabify apart.

## Decision (owner)

Option A: when Add task would put a holder over their hours, the form pauses and offers **Add and split with AI**
(creates the task, then opens Break down and balance), **Add anyway** and **Go back**. Rejected: a stronger warning
without AI; splitting inside the New task form.

## Design

- Applies to the project manager and coordinators adding a task with holders and an estimate in an Open project
  (where holders are picked at creation). Members keep the database refusal they get today.
- On Add task the app asks the database: `general_new_task_room(project, users, minutes, starts, due)` returns, for each
  project member among the users, their load, their share of the new task (estimate ÷ holders), their available
  minutes and the weeks counted. The weeks follow the load rule: from the start (or today) to the due date, overdue
  or undated work is this week. Only the project manager and coordinators may ask (they already see hours).
- Nobody over: the task is added as today. Someone over: the form shows
  "Ivan Caburnay would be 6 h over: 46 / 40 h for 23–27 Nov." per person, and the three choices. Go back returns to
  the form as it was.
- Add and split with AI: the task is created as filled in (holders included), then Break down and balance opens on it
  with everyone who can hold tasks selected; its owner rule (skills as a preference) spreads the work. Closing it
  keeps the task as created. When subtasks are off in the project, the choice is replaced by a line saying so.
- The old live amber line is removed (it counted only this week, so it could disagree with the check).

## Non-goals

The task dialog's holder picker (assigning an existing task), Members' flow, the Planned flow's handoff.
