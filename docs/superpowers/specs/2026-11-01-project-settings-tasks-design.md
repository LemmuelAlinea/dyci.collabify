# Project Settings, phase 2 group 2 — Task Management (design)

Date: 2026-11-01. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section C (Task Management). Groups done and live: phase 1 (Settings tab,
sprints) and group 1 (look, visibility, join requests, Danger zone). Order after
this: Members & Permissions, Milestones, Notifications, Workflow rules.

## Why

Tasks today have no priority, no subtasks and no dependencies, and the project
can't set task rules. The PDF asks for all of these as per-project settings so a
project manager can shape how work is broken down and finished.

## Decided by the owner

- **Priority**: Low, Normal, High, Urgent; Normal by default. A small badge on
  task cards and in the task window; Tasks and My tasks can sort and filter by
  it. Settings → Tasks has **Default priority** for new tasks.
- **Default status for new tasks**: any of the project's progress stages; the
  default is the first stage (today's behaviour). It applies when a task is
  created or released into the work, not to private planning.
- **Subtasks** are real tasks under a parent: their own holder, status, due
  date, comments; they show on the board and in My tasks; the parent shows a
  count (e.g. "2/3 done"). **One level only** — a subtask can't have subtasks.
  **Who can add one**: the PM, coordinators, the lead of the parent's team, and
  the parent's holders. A subtask lands in the parent's team, sprint and
  milestone.
- **Allow subtasks** switch in Settings → Tasks.
- **Dependencies**: "Task A waits for task B". A shows "Waiting for B". People
  can start A, but A can't be marked Done until B is Done — enforced in the
  database. **Allow dependencies** switch in Settings → Tasks.
- **Allow multiple assignees** switch. When turned off, tasks that already have
  several holders keep them; from then on no task can gain a second holder.
- **Require an assignee** switch: a task can stay unassigned in planning and in
  the first stage, but can't move to a later stage without a holder.
- **Completion rule** switch ("Require all subtasks to be Done"): a parent
  can't be marked Done while any subtask isn't Done.

## My calls (owner to check)

1. Settings → Tasks (the section from phase 1, which already has progress
   stages and the QA stage) gains a "Task rules" panel with: Default priority,
   Default status, Allow subtasks, Allow dependencies, Allow multiple
   assignees, Require an assignee, Require all subtasks to be Done. Edited by
   the project manager (`edit_project`), like the stages. Defaults keep today's
   behaviour: priority Normal, first stage, subtasks on, dependencies on,
   multiple assignees on, require assignee off, subtask rule on.
2. Settings live in columns on `general_projects` (they are project rules,
   edited with `edit_project`, like `stages`), not a separate table.
3. Tasks gain `priority` (low/normal/high/urgent, default from the project) and
   `parent_id` (same project, one level, not itself a subtask). Dependencies are
   a new table `general_task_dependencies (task_id, depends_on_id)`: same
   project, no self-links, no cycles.
4. A subtask follows its parent's release boundary: under a released parent it
   is released; under a private planning parent it stays in planning with it.
   Holders of a released parent can add subtasks without the planning step.
5. Progress counts (project %, sprint and milestone progress, reports) count
   every task, subtasks included, as separate tasks — no double counting rule.
   The parent's "2/3 done" is shown alongside.
6. Turning "Allow subtasks" or "Allow dependencies" off hides the add controls;
   existing subtasks and dependencies stay and keep working (nothing deleted).
7. Dependencies can be added by whoever can edit the task (planners, the team
   lead, holders), only between tasks of the same project.
8. Bugs (QA) can be subtasks and can have dependencies like any task; QA keeps
   its own rules (creates bugs only, cannot hold tasks).
9. Class boards are untouched.

## Non-goals

Milestone settings, notification settings, workflow automation, custom task
statuses beyond today's stages, time-based scheduling of dependencies (Gantt).

## Constraints

As before: tokens only, copy rules, desktop → tablet → phone, idempotent SQL,
the release boundary honoured everywhere (counts, search, calendars,
notifications), new member-write paths use `general_can_write`, and the owner
reviews before any live SQL or push.
