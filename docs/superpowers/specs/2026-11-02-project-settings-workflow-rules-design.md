# Project Settings, phase 2 group 6 — Workflow rules (design)

Date: 2026-11-02. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section 3 ("Additional settings to consider later"): "Workflow Rules & Automation —
When a task moves to In Review, notify its reviewer." Groups live: phase 1
(sprints), groups 1–5 (general, tasks, members, milestones, notifications). This is
the last group from the PDF.

## Why

Projects repeat the same follow-ups by hand: telling the lead a task is ready for
review, raising a late task's priority, handing a bug to the same person, moving a
task on when it's ready. The PDF asks for project rules that do this for them.

## What Collabify has today

- Stages per project (`general_projects.stages`, 3–8 names; `general_tasks.stage`
  is the index; first = To do, last = Done, middle = In progress), a QA stage and
  gate, task rules (group 2), notification settings (group 5) and the sprint
  automation. No rule engine and no stage reviewer exist.
- Team leads (one per team), roles pm / coordinator / member / qa / stakeholder,
  holders in `general_task_assignees`, priorities low / normal / high / urgent,
  the release boundary (`routing_state`), the task history (`general_task_events`).
- Custom fields already exist on projects and personal templates exist; they are
  out of scope here.

## Decided by the owner

- **Scope: workflow rules only.** Task custom fields and shared project templates
  are later groups.
- **A simple "When / Then" builder.** Each rule has one trigger and one action and
  can be turned on or off.
- **Triggers ("When")**: a task moves to a stage; a task is sent to a team
  (released); a task becomes overdue; a task's priority is raised to High or
  Urgent.
- **Actions ("Then")**: notify someone; set the priority; assign someone; move to
  a stage.
- **The rule picks who** is notified: the task's team lead, the project manager and
  coordinators, QA, the task's holders, or a specific person.
- **The project manager and coordinators** create, change, turn off and delete
  rules. Everyone else sees them read-only.

## My calls (owner to check)

1. **Where.** A new **Workflow rules** item at the end of the Settings side menu
   (… Notifications, Workflow rules). It lists the rules with an on/off switch,
   a short sentence for each ("When a task moves to Review, notify the team
   lead"), and "Add rule" / "Edit" / "Delete". At most 20 rules per project.
2. **The builder.** Name (optional; the sentence is the default), When (trigger +
   its stage or priority), Then (action + its people, priority, person or stage).
   One trigger and one action per rule; two actions means two rules.
3. **Triggers in detail.**
   - *Moves to a stage*: when a released task's stage changes into the chosen
     stage (not when it's created there).
   - *Sent to a team*: when a task becomes released (sent out of private
     planning).
   - *Becomes overdue*: at the 08:00 Manila morning run, the first time a task is
     counted overdue (the same moment group 5 marks it; this works even when the
     overdue alert is switched off).
   - *Priority raised*: when a task's priority goes from below the chosen level to
     the chosen level or above (High means High or Urgent).
4. **Actions in detail.**
   - *Notify*: new notification type `workflow_rule`, linked to the task. Title
     "{task} moved to {stage}" / "{task} was sent to {team}" / "{task} is overdue"
     / "{task} is now {priority}"; preview "From the rule “{rule}”." Recipients
     are current members only; never the person whose change set it off; never
     stakeholders. "QA" means members with the QA role. Recipients' personal
     "Task assignments" switch applies.
   - *Set the priority*: sets it to the chosen level.
   - *Assign someone*: adds the chosen person as a holder only if they are an
     active member of the task's team (the receiving team), not QA or a
     stakeholder, not already holding it, and the project allows multiple holders
     or the task has none. Otherwise the action is skipped.
   - *Move to a stage*: moves the task to the chosen stage. It never moves past an
     active QA stage (only QA or the project manager may do that) and never moves
     to Done; those choices aren't offered when QA is active, and the last stage
     isn't offered at all.
5. **Everything follows the existing database rules.** An action the database
   refuses (a dependency not done, a subtask rule, the QA gate, a missing holder
   rule) is skipped. It never undoes or blocks the person's own change. The rule
   shows "Last skipped {date}: {reason}" in the list.
6. **No chains.** Changes made by a rule don't set off other rules, so rules can't
   loop.
7. **Released work only.** Private planning tasks never set off a rule. Class
   boards are untouched. Archived or trashed tasks and archived projects never set
   off rules.
8. **History.** Every action a rule takes is written to the task's history as "by
   the rule “{rule}”" (a new event kind), so people can see why a task changed.
9. **Stages by name.** A rule remembers its stage by name. If the project manager
   renames or removes that stage, the rule stops firing and the list shows
   "Stage {name} no longer exists. Edit the rule." Same for a specific person who
   leaves the project: "{name} is no longer in the project."
10. **Database.** A table `general_workflow_rules` (project, name, enabled,
    trigger kind and value, action kind and value, created_by, updated_at,
    last_skipped_at, last_skip_reason) in a new file
    `supabase/project-workflow-rules.sql` after `project-notification-rules.sql`,
    before `anon-lockdown.sql`. Members of the project read it; the project
    manager and coordinators write it (`general_can_manage_workflow`). Rules run
    in the database (triggers on task changes and the morning overdue moment), so
    they work whoever makes the change and whatever screen they use.

11. **Rules act for the project, not as a person.** The person whose change set
    a rule off may not have the right to do the rule's action (a member can't
    assign someone on another team), and the morning run has no person at all.
    So a rule acts with the authority of the project's rule-setters (the project
    manager and coordinators who may write rules), limited by the rule's own
    limits in calls 4 and 7. The database's work rules still apply to it:
    dependencies, subtasks, "require a holder", the QA gate, the release
    boundary. The builder uses the existing pattern for this (a security-definer
    runner with a transaction-local flag, like the milestone and sprint
    automation), runs each action in its own savepoint so a refusal only skips
    that action, and never redefines an existing guard.
12. **"Sent to a team" fires each time a task becomes released**: the first send
    and a re-send after it was returned. A reroute between teams (already
    released) does not fire it. Subtasks that are released because their parent
    was sent don't fire it separately; the parent does.
13. **History actor.** A rule's history entry shows the rule as the actor ("Rule
    “{name}”"), not a person. The builder checks whether `general_task_events`
    allows no person and makes the task history show the rule's name either way.
14. **What counts as skipped.** Only a refused action is a skip: the database
    refused it, the person to assign can't hold the task, or the rule's stage or
    person no longer exists. A notify rule that finds nobody to tell, or an
    action that changes nothing (the priority is already that level), is not a
    skip and writes nothing. The rule row is written only when a skip happens.
15. **Who can be named.** A specific person must be a current member who isn't a
    stakeholder. QA can be notified but never assigned. Rule notices aren't tied
    to group 5's project switches (turning the rule off is the switch); each
    recipient's personal "Task assignments" switch still applies. Everyone who
    can open Settings sees the Workflow rules list, read-only unless they're the
    project manager or a coordinator.
16. **When rules run.** After the task change is final (an AFTER trigger that
    sees the finished row, named to run after the existing task triggers), and
    in the morning run right after group 5 marks a task overdue. Several rules
    on one change run in the order they were created. A due date moved later
    and then passed again fires "becomes overdue" again, following group 5's
    overdue marker.

## Non-goals

Several actions per rule, conditions ("only bugs", "only team X"), time-based
triggers other than overdue, rules on comments or files, email, task custom fields,
project templates, class boards.

## Constraints

Tokens only, copy rules, desktop → phone, idempotent SQL, release boundary,
redefinitions from live definitions, existing guards never bypassed, owner reviews
before any live SQL or push.
