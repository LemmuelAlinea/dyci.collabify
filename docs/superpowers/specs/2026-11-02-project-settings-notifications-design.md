# Project Settings, phase 2 group 5 — Notifications (design)

Date: 2026-11-02. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section F. Groups live: phase 1 (sprints), group 1 (look, visibility, joining,
Danger zone), group 2 (task management), group 3 (member options), group 4
(milestones). Next: Workflow rules.

## Why

"Project Settings should control which events generate notifications; Account
Settings should control how each person receives them." The PDF lists five
project settings: sprint ending reminder (1 day before), overdue task alert,
milestone due reminder (2 days before), task assignment notification and sprint
completion notification. Its example: one day before Sprint 1 ends, Collabify
tells the manager that three tasks remain unfinished.

## What Collabify has today (work projects)

- Task assignment: yes. `general_task_assigned` goes to the new holder
  (`notify_general_assignment`), gated by the person's "Task assignments" switch.
- Day-before task due reminder: yes. `general_deadline_soon` to holders
  (`send_general_deadline_reminders`, hourly), gated by "Deadline reminders".
- Milestone overdue: yes, from group 4 (`send_milestone_overdue_alerts`, daily
  08:00 Manila, PM and coordinators, `milestone_overdue_alerts` switch). It does
  not check personal switches.
- Sprint finished: only the automation job tells the PM and coordinators
  (`sprint_automation`). A person finishing a sprint tells nobody.
- Not at all: a sprint ending reminder, an overdue alert for work tasks, a
  milestone due reminder.
- Personal switches live in `notification_prefs` (Account → Notifications):
  `task_assignments`, `deadline_reminders`, `comments_mentions`,
  `project_updates`, and others. Each notify function joins them itself.
- No email delivery; notifications are in-app only.

## Decided by the owner

- **Overdue task alert** goes to the task's holders **and** the project manager
  and coordinators.
- **Sprint completion** is announced to the project manager, coordinators **and
  everyone who had a task in that sprint**, whether a person or the automation
  finished it.
- **Defaults are on, with the PDF's timings**, for new and existing projects:
  sprint ending reminder 1 day before, milestone due reminder 2 days before,
  overdue task alerts on, task assignment notices on, sprint completion notices
  on. The project manager can change each.
- **Personal switches still apply.** The project decides what is sent; each
  person can still silence these for themselves with their existing Account
  switches.

## My calls (owner to check)

1. **Where.** A new **Notifications** item in the Settings side menu, after
   Members & permissions (General, Sprints, Tasks, Milestones, Members &
   permissions, Notifications). Only the project manager edits it
   (`edit_project`); everyone else sees it read-only. The "Overdue milestone
   alerts" switch moves here from Settings → Milestones (same column), so every
   notification choice is in one place.
2. **The panel**, top to bottom:
   - "Sprint ending reminder": Off / 1 day before / 2 days before / 3 days before.
   - "Overdue task alerts": on/off.
   - "Milestone due reminder": Off / 1 day before / 2 days before / 3 days
     before / 1 week before.
   - "Overdue milestone alerts": on/off (moved).
   - "Task assignment notices": on/off.
   - "Sprint completion notices": on/off.
   - Help line under the title: "These decide what this project sends. Each
     person can still turn notices off for themselves in Account →
     Notifications."
3. **Columns on `general_projects`**: `sprint_end_reminder_days int` (null =
   off, default 1, 1–3), `task_overdue_alerts bool default true`,
   `milestone_due_reminder_days int` (null = off, default 2, one of 1, 2, 3, 7),
   `task_assignment_notices bool default true`, `sprint_completion_notices bool
   default true`. New file `supabase/project-notification-rules.sql`, after
   `project-milestone-rules.sql` and before `anon-lockdown.sql`.
4. **Sprint ending reminder** (new type `sprint_ending_soon`): for the running
   sprint, at 08:00 Manila on the day that is N days before `ends_on`, once per
   sprint (remembered on the sprint; cleared when `ends_on` moves later).
   Recipients: project manager and active coordinators. Title "{sprint} ends in
   {N} day(s)" (or "ends tomorrow" for 1); preview "{k} tasks remain
   unfinished." or "Every task is done." Counts released tasks only.
5. **Overdue task alert** (new type `general_task_overdue`; the existing
   `task_overdue` stays class-only): the morning (08:00 Manila) after a released,
   open, live work task's due time passes, once per task (remembered on the
   task; cleared when the due time moves later). Holders get one notice per task
   ("{task} is overdue"). The project manager and coordinators get **one summary
   per project per morning** for that morning's newly overdue tasks ("{k} tasks
   became overdue in {project}") rather than one notice per task, so a busy
   project doesn't flood them. A planner who also holds the task gets both
   (holder notice plus the summary count). Private planning tasks never alert.
   Tasks already overdue on the day this ships are remembered silently, so the
   first morning doesn't send old lateness.
6. **Milestone due reminder** (new type `milestone_due_soon`): at 08:00 Manila N
   days before `due_on`, once per milestone (cleared when `due_on` moves),
   for dated, unreached milestones. Recipients: project manager and active
   coordinators, like the overdue alert. Title "{milestone} is due in {N}
   day(s)".
7. **Task assignment notices off** stops `general_task_assigned` for this
   project. Handoff notices (`work_task_handoff`: a task sent to a team, sent
   back, rerouted) are workflow requests, not assignment notices, and keep
   going.
8. **Sprint completion** (new type `sprint_completed`): when a sprint's state
   becomes done (a person or the automation), notify the project manager,
   active coordinators and the sprint team (call 13), except
   the person who finished it. Title "{sprint} is finished"; preview as in
   call 13. When the automation finishes a sprint, the planners
   already get the `sprint_automation` notice, so they don't get this one too;
   the sprint team does. Reopening and finishing again announces again.
9. **Personal switches**: sprint ending, overdue task, milestone due and
   milestone overdue notices honour "Deadline reminders"; sprint completion
   honours "Project updates"; task assignment keeps "Task assignments". The
   Account page descriptions are updated to name the new notices. (This adds the
   personal check to the existing milestone overdue alert.)
10. **One daily job** `collabify-project-reminders` at 00:00 UTC (08:00 Manila)
    sends the sprint ending, overdue task and milestone due notices; the
    milestone overdue job stays as it is. Only live (not archived, not trashed)
    work projects. Stakeholders and QA never receive these (QA keeps its own
    notices).
11. **Links**: sprint ending and sprint completion open Plan → Sprints; overdue
    task opens the task; the overdue summary opens Tasks; milestone due opens
    Plan → Milestones.
12. Class boards untouched.
13. **Sprint team and counts.** "Everyone who had a task in that sprint" means
    the holders of released tasks in the sprint at the moment it is finished,
    *before* unfinished work moves to the next sprint or the backlog, so the
    people whose tasks were carried over hear about it too. The preview counts
    from that same moment: "{done} of {total} tasks done." plus " {moved} moved
    to {next sprint}." or " {moved} went back to the backlog." when work moved.
    The counts are captured before the carry (the builder chooses how: inside
    the finish paths or recorded on the sprint).
14. **Who finished it.** The person excluded is the signed-in person who
    finished the sprint; the automation has no person, so nobody is excluded.
    The automation is recognised by its existing transaction flag
    (`collabify.sprint_automation`), and then the planners are skipped because
    they already get `sprint_automation`.
15. **"Open" and "live" for an overdue task**: not Done (`status <> 'done'`),
    not archived, not trashed, released, in a live work project. A task waiting
    in QA or review is still open and can be overdue. A subtask is its own task.
16. **Catch-up, not exact day.** Each reminder sends on the first morning run
    when it is due and not yet sent: the sprint ending reminder when the
    running sprint ends within N days and hasn't ended; the milestone due
    reminder when an unreached milestone is due within N days and isn't past
    due (past due is the overdue alert's job). A missed run sends the next
    morning. A sprint started with fewer than N days left gets its reminder the
    next morning.
17. **No flood on the first morning.** When the SQL is applied, everything
    that would already qualify (overdue tasks, running sprints inside their
    window, milestones inside their window) is marked as sent without a notice.
    From then on only new cases notify.
18. **The hourly day-before task reminder** (`general_deadline_soon`) keeps
    working as today, under each person's "Deadline reminders" switch; it gets
    no project switch.
19. **Moving the milestone switch** is a UI move only: the Milestones panel
    loses "Overdue milestone alerts" and the Notifications panel shows it,
    reading and writing the same `milestone_overdue_alerts` column, so no saved
    choice changes.

## Non-goals

Email or push delivery, digest scheduling per person, custom reminder times,
reminders for subtasks separately from their parent (a subtask is a task and
follows the same rule), workflow rules ("when a task moves to In Review, notify
its reviewer" is group 6).

## Constraints

Tokens only, copy rules, desktop → phone, idempotent SQL, release boundary,
redefinitions from live definitions, no notification floods on deploy, owner
reviews before any live SQL or push.
