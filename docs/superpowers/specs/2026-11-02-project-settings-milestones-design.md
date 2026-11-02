# Project Settings, phase 2 group 4 — Milestone Management (design)

Date: 2026-11-02. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section D. Groups live: phase 1 (sprints), group 1 (look, visibility, joining,
Danger zone), group 2 (task management), group 3 (member options). Next:
Notifications, Workflow rules.

## Why

Milestones today always need a due date, count as reached when all their tasks
are done or when someone marks them, have no dependencies and send no alerts.
The PDF asks for per-project control of completion, due dates, dependencies and
overdue alerts. "Milestones can span several sprints, so milestone completion
must remain separate from sprint completion."

## Decided by the owner

- **Completion mode** setting:
  - **Automatic** (default, today's behaviour): a milestone counts as reached
    when all its tasks are done, and Collabify records the date.
  - **Manual**: a milestone counts as reached only when someone marks it, even
    when all its tasks are done (for milestones that need a sign-off).
- **"Require a due date"** switch, on by default (today's rule). When off, a
  milestone may have no date; an undated milestone is never late and sits at
  the end of the timeline.
- **Milestone dependencies**: "B waits for A". B shows "Waiting for A" and can't
  count as reached — manually or automatically — until A is reached. Enforced in
  the database. **"Allow milestone dependencies"** switch.
- **Overdue alerts**: the morning after a milestone's due date passes without it
  being reached, the PM and coordinators get one in-app notification.
  **"Overdue milestone alerts"** switch, on by default.

## My calls (owner to check)

1. A new **Milestones** item in the Settings side menu (General, Sprints, Tasks,
   Milestones, Members & permissions) with the four controls. Only the project
   manager edits it (`edit_project`), like the task rules; everyone else sees it
   read-only.
2. Settings are columns on `general_projects`: `milestone_completion`
   ('automatic' | 'manual', default 'automatic'), `require_milestone_due`
   (default true), `allow_milestone_dependencies` (default true),
   `milestone_overdue_alerts` (default true). New SQL file
   `supabase/project-milestone-rules.sql` after `project-member-rules.sql`,
   before `anon-lockdown.sql`.
3. **Automatic reach is recorded**: when the last open task of a milestone is
   done (and it is unblocked), Collabify sets `reached_at` and marks it as
   automatic (`reached_auto = true`). If a task reopens, an automatic reach is
   undone; a manual one stays. Switching the project to Manual leaves existing
   reached milestones as they are. A milestone with no tasks is never reached
   automatically.
4. **Due date**: `due_on` becomes nullable; a check refuses a missing date while
   the switch is on. Turning the switch back on doesn't touch existing undated
   milestones, but editing one then requires a date.
5. **Dependencies**: a table `general_milestone_dependencies (milestone_id,
   depends_on_id)` in the same project, no self-links, no loops; added and
   removed by whoever may manage milestones (`general_can_manage_milestones`,
   which includes members when that switch is on). Marking reached is refused
   while a dependency isn't reached; an automatic reach waits and happens when
   the blocker is reached.
6. **Overdue alerts**: a daily scheduled job at 8:00 AM Philippine time sends
   `milestone_overdue` ("{milestone} is overdue in {project}") once per
   milestone (remembered with `overdue_notified_at`); moving the due date later
   clears that so a new date can alert again. Undated and reached milestones
   never alert.
7. The milestone views (list, timeline, overview card, progress tab) follow the
   completion mode: in Manual, 100% done shows "Ready to mark reached" instead of
   "Reached". "Waiting for {A}" shows on blocked milestones; undated milestones
   show "No due date".
8. Class boards are untouched.

## Non-goals

Milestone due reminders before the date (group 5, Notifications), milestone
templates, Gantt-style scheduling.

## Constraints

Tokens only, copy rules, desktop → phone, idempotent SQL, release boundary,
redefinitions from live definitions, owner reviews before any live SQL or push.
