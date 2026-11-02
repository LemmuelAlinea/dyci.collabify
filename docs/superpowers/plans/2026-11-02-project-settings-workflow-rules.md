# Project Settings Group 6 (Workflow rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the project manager and coordinators write "When / Then" rules that notify, set priority, assign or move a work task when it moves to a stage, is sent to a team, becomes overdue or has its priority raised.

**Architecture:**
- **Database:** a new file, `supabase/project-workflow-rules.sql`, runs after `project-notification-rules.sql` and before `anon-lockdown.sql`.
  - It holds the rules table, its access and checks, and a security-definer runner fired by AFTER triggers on task changes and by the morning overdue marker.
  - Each action runs in its own savepoint, under a transaction-local flag, so rules never chain and a refusal only skips.
- **App:** a Settings → Workflow rules section with a list and a builder, the notification link, and rule names in the task history.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens, Supabase Postgres (plpgsql, RLS), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-project-settings-workflow-rules-design.md` (calls 1–16 are referenced by number).

## Global Constraints

- Work projects only. Class boards are untouched.
- Released, live tasks only (`routing_state = 'released'`, not archived, not trashed, live project).
- **Writers and readers.** The project manager and coordinators write rules (`general_can_manage_workflow(project)`: role pm or coordinator, `general_can_write`, project not archived). Members of the project read them.
- **Size limits.** At most 20 rules per project. One trigger and one action per rule.
- **Existing guards.** None is redefined. Rule actions pass every data rule: dependencies, subtasks, require-holder, QA gate, release boundary, single-holder.
- **Rule limits:**
  - Assign only active members of the task's team who aren't QA or stakeholder.
  - Move never to the last stage and never past an active QA stage.
- **No chains.** Changes made by rules never set off rules.
- **Copy:** sentence case, no exclamation marks, no "please", no "successfully".
- **SQL and tokens.** Tokens only. Idempotent SQL. Redefinitions start from the live `pg_get_functiondef`. Dry-run only until the owner approves.

## Review Focus

1. **A member moves a task into Review under a rule "assign the team lead".** The lead is assigned, even though the member couldn't assign anyone. *(Task 2: "a rule acts for the project, not the person")*
2. **A rule's move is refused because the project requires a holder and the task has none** ("Give this task a holder before moving it on."). The person's own change stays. The rule records "Last skipped" with the reason. *(Task 2: "a refused action is skipped and the person's change stays")*
3. **Rule A raises a task to Urgent while rule B fires on Urgent.** B doesn't fire. *(Task 2: "changes made by rules set off no rules")*
4. **The project manager renames the stage a rule uses.** The rule stops firing, and the list says so. *(Task 2: "a rule whose stage is gone does not fire"; Task 3 UI test)*
5. **A private planning task moves stage.** No rule fires. *(Task 2: "private planning, archived and trashed tasks set off no rules")*

---

### Task 1: Database — rules table, access, checks, types

**Files:**
- Create: `supabase/project-workflow-rules.sql`, `supabase/tests/project-workflow-rules.test.sql`

**Interfaces:**
- Produces:
  - Enum `notification_type` value `workflow_rule`, in its own committed block at the top.
  - Task event kind for rule actions: `rule_applied`. Extend whatever constrains `general_task_events.kind`; read the live check or enum first.
  - Table `general_workflow_rules`:
    - `id uuid pk`, `project_id uuid not null` (references `general_projects` on delete cascade), `name text not null default ''` (≤ 80), `enabled bool not null default true`, `position int not null` (creation order)
    - `trigger_kind text not null check in ('stage_entered','task_released','task_overdue','priority_raised')`, `trigger_stage text` (stage name, for `stage_entered`), `trigger_priority text check in ('high','urgent')` (for `priority_raised`)
    - `action_kind text not null check in ('notify','set_priority','assign','move_stage')`, `notify_to text check in ('team_lead','planners','qa','holders','person')`, `person_id uuid` (references `profiles` on delete set null; for `notify_to = 'person'` or `assign`), `action_priority text check in ('low','normal','high','urgent')`, `action_stage text`
    - `created_by uuid`, `created_at`, `updated_at`, `last_skipped_at timestamptz`, `last_skip_reason text`
    - Row checks that the fields match the kinds (e.g. `stage_entered` requires `trigger_stage`; `assign` requires `person_id`).
  - RLS:
    - Select: `is_general_member(project_id)` or `can_read_general_project`. Match how group 5 settings are read.
    - Insert, update and delete: `general_can_manage_workflow(project_id)`.
    - A BEFORE INSERT guard refuses a 21st rule with "A project can have up to 20 rules."
    - Class boards are refused with "Workflow rules are for work projects."
    - Signed-in writes can't set `last_skipped_at` or `last_skip_reason`, which are kept or nulled (pattern: `guard_general_milestone_overdue`).
    - `position` is set on insert.
  - Write-time checks (messages):
    - "Choose a stage that isn't the last one." for a `move_stage` target that is the last stage.
    - "That person can't be given tasks." for `assign` to a QA, stakeholder or non-member.
    - "Choose someone in this project." for a `person` who isn't a current non-stakeholder member.
  - `general_can_manage_workflow(p_project uuid) returns boolean`: stable, security definer.
  - Add the table to realtime.
- [ ] **Step 1: Write the failing suite.** Use the harness from `project-notification-rules.test.sql`. Checks:
  - `'the project manager and coordinators can add, change and delete rules'`
  - `'members, qa and stakeholders read rules but cannot write them'`
  - `'a 21st rule is refused'`
  - `'fields must match the trigger and action'`
  - `'a move to the last stage is refused'`
  - `'assigning qa, a stakeholder or a non-member is refused'`
  - `'a signed-in person cannot write the skip fields'`
  - `'archived projects refuse rule writes'`
  - `'class boards refuse rules'`
- [ ] **Step 2: Dry-run.** Swap the enum value in the scratch copy. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `project-notification-rules`, `project-task-rules`, `general-tasks` and `work-task-handoff` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Add workflow rules and who may write them".

### Task 2: Database — the rule runner

**Files:**
- Modify: `supabase/project-workflow-rules.sql`, `supabase/tests/project-workflow-rules.test.sql`

**Interfaces:**
- Consumes: Task 1 table and types. Group 5's `general_task_reminders`, which is inserted by `send_project_reminders` and by `mark_project_reminders_sent`.
- Produces:
  - `run_general_workflow_rules(p_task uuid, p_trigger text, p_actor uuid) returns void`.
    - Security definer, revoked from clients.
    - Does nothing when `current_setting('collabify.workflow_rule', true) = 'on'` (no chains).
    - Otherwise it loads the task and checks the task, project and release conditions above.
    - It loops the project's enabled rules matching the trigger, in `position` order. For each it runs the action inside `begin … exception when others` (a savepoint), with the flag on and the request's JWT claims cleared for the write. Use the claims-clearing pattern of `create_general_subtask`, and always restore the claims and the flag.
  - Firing, from AFTER triggers on the final row; name them to sort after every existing `general_tasks` trigger, e.g. `general_tasks_zzz_workflow`:
    - `stage_entered`: on update when `stage` changed, the new stage's name equals `trigger_stage` (case-insensitive) and the task is released.
    - `task_released`: on update when `routing_state` became `released` from something else and the task has no `parent_id`. Subtasks always follow their parent's release state (group 2), so they never fire it.
    - `priority_raised`: on update when the new priority rank ≥ the chosen level and the old rank < it.
    - `task_overdue`: AFTER INSERT on `general_task_reminders`, only when `current_setting('collabify.reminder_premark', true)` is not 'on'.
      - Redefine `mark_project_reminders_sent` from live to set that flag. It is owned by `project-notification-rules.sql`, so record the ownership.
      - The trigger name sorts after nothing relevant.
  - Actions:
    - **notify**:
      - The recipients depend on `notify_to`:
        - `team_lead`: the active lead of the task's team.
        - `planners`: the pm and coordinators.
        - `qa`: members with role qa.
        - `holders`: the task's holders.
        - `person`: `person_id`.
      - Every recipient must be a current member, not a stakeholder, not `p_actor`, with an active profile and `notification_prefs.task_assignments` on.
      - Type `workflow_rule` with `general_project_id` and `general_task_id`.
      - Titles by trigger:
        - "{task} moved to {stage}"
        - "{task} was sent to {team}" ("{task} was sent out" with no team)
        - "{task} is overdue"
        - "{task} is now {Priority}"
      - Preview: "From the rule “{rule}”." where {rule} is the name or the sentence when the name is blank (`general_workflow_rule_sentence(rule)` below).
    - **set_priority**: no-op when it is already that level.
    - **assign**:
      - Skip when the person can't hold the task: not an active member of the task's team, QA, a stakeholder, or the single-holder rule blocks it.
      - A no-op when they already hold it.
    - **move_stage**:
      - Skip when the target name no longer exists, is the last stage, or is past an active QA stage (`general_qa_stage_pick` and `general_project_has_qa`).
      - A no-op when the task is already there.
  - A skip writes `last_skipped_at = now()` and `last_skip_reason`. A database refusal records the error message. A rule-limit skip records one of:
    - "Stage {name} no longer exists."
    - "{name} is no longer in the project."
    - "{name} isn't on the task's team."
    - "A task can't be moved past QA by a rule."

    The skip write runs under the flag. Notify with nobody to tell, and no-ops, write nothing.
  - History: each applied action writes a `general_task_events` row with kind `rule_applied` and detail `{rule_id, rule_name, action}`.
    - `actor_id` stays null if the column allows it. Otherwise it is the rule's `created_by`, and the detail marks it as a rule.
    - Record which in the report.
  - `general_workflow_rule_sentence(general_workflow_rules) returns text`: the sentence, e.g. "When a task moves to Review, notify the team lead". The app has its own copy (Task 3).
- [ ] **Step 1: Add failing checks:**
  - `'moving a task to the stage notifies the team lead'`
  - `'the person who moved it is not notified'`
  - `'a rule acts for the project, not the person'` (a member's move sets off an assign)
  - `'sending a task to a team fires the sent rule once; subtasks do not'`
  - `'a re-send after a return fires again; a reroute does not'`
  - `'raising priority to urgent fires the high rule and the urgent rule'`
  - `'lowering priority fires nothing'`
  - `'the morning overdue marker fires the overdue rule; the apply-time pre-mark does not'`
  - `'changes made by rules set off no rules'`
  - `'a refused action is skipped and the person's change stays'` (move refused by a dependency; `last_skip_reason` set)
  - `'assign skips someone outside the task's team'`
  - `'a move never goes to the last stage or past active qa'`
  - `'a rule whose stage is gone does not fire'`
  - `'a turned-off rule does not fire'`
  - `'private planning, archived and trashed tasks set off no rules'`
  - `'the task history names the rule'`
  - `'a person's task assignments switch silences rule notices'`
  - `'rules run in creation order'`
  - `'class boards are untouched'`
- [ ] **Step 2: Dry-run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green**, plus `project-notification-rules`, `project-task-rules`, `project-qa`, `general-tasks`, `work-task-handoff`, `project-member-rules` and `sprint-settings` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Run workflow rules when tasks change".

### Task 3: App — Workflow rules section, builder, links, history

**Files:**
- Modify:
  - `src/lib/general/navigation.ts`: `SettingsSection` gains `'workflow'`.
  - `src/components/general/settings/ProjectSettings.tsx`: add "Workflow rules" last, with an existing icon.
  - Create `src/components/general/settings/WorkflowSection.tsx`.
  - Create `src/lib/general/workflowRules.ts`:
    - the `WorkflowRule` type (camelCase of the columns)
    - `ruleSentence(rule, stages, people)`, the same sentences as the SQL helper
    - `ruleProblem(rule, stages, members)`, returning "Stage {name} no longer exists. Edit the rule." / "{name} is no longer in the project." / null
    - the trigger and action option lists
  - Create `src/lib/api/workflowRules.ts`: `listWorkflowRules(projectId)` with the missing-table fallback (`[]`, "remove once live"), plus `addWorkflowRule`, `updateWorkflowRule`, `deleteWorkflowRule` and `setWorkflowRuleEnabled`.
  - `useGeneralProject` live tables: add `general_workflow_rules`.
  - `src/lib/types.ts` and `notificationDestination.ts`: `workflow_rule` opens the task (`?task={general_task_id}`).
  - The task history list (find where `qa_passed` / `qa_sent_back` events render): `rule_applied` reads "{action} by the rule “{name}”".
- Test: `workflowRules.test.ts`, `settings/WorkflowSection.test.tsx`, `notificationDestination` test, the history component test.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces the section:
  - Title "Workflow rules". Help: "Rules act for the project. They follow the project's task rules and never set off other rules."
  - Empty state: "No rules yet."
  - Each row shows the name (or sentence), the sentence under it when a name is set, an on/off switch, "Edit" and "Delete". It also shows "Last skipped {Mon D}: {reason}" when set, and the `ruleProblem` text in danger tokens when not null.
  - "Add rule" opens the builder with:
    - "Name" (optional)
    - "When" (select: "A task moves to a stage" / "A task is sent to a team" / "A task becomes overdue" / "A task's priority is raised to"), then a stage select or a priority select ("High" / "Urgent")
    - "Then" (select: "Notify" / "Set the priority to" / "Assign" / "Move it to"), then a people select ("The team lead" / "The project manager and coordinators" / "QA" / "The task's holders" / "A specific person"), a person select (current members who aren't stakeholders; QA excluded for Assign), a priority select, or a stage select that leaves out the last stage and the stages past an active QA stage
  - Buttons "Save rule" / "Cancel". Toasts "Rule saved", "Rule deleted".
  - "Delete" asks for confirmation with "Delete this rule?"
  - "Add rule" is hidden at 20 rules, with "A project can have up to 20 rules."
  - Editable when `myRole` is pm or coordinator and not `readOnly`, read-only otherwise.
  - Database refusals show their message.
- [ ] **Step 1: Write failing tests:**
  - The sentences for each trigger and action pair.
  - `ruleProblem` for a missing stage and a departed person.
  - The builder's payload for each action.
  - The stage list leaves out the last stage and the stages past active QA.
  - Read-only for a member.
  - The switch calls `setWorkflowRuleEnabled`.
  - "Add rule" is hidden at 20.
  - The `workflow_rule` destination.
  - The `rule_applied` history line.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`, and `npx eslint` on the changed files. Expected: PASS.
- [ ] **Step 5: Commit** "Add workflow rules to project settings".

### Task 4: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: add the file after `project-notification-rules.sql` in both restore commands and the rerun tail, plus an ownership section and the re-run rule. Re-running `project-notification-rules.sql` (it owns `mark_project_reminders_sent`, now redefined here) or any file whose triggers the runner depends on means re-running this file afterwards, then `anon-lockdown.sql`.
  - `scripts/schema-drift.mjs`: the order.
  - `CLAUDE.md`: one concise bullet.
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Checks.**
  - Build, vitest, eslint and contrast.
  - SQL dry-runs of `project-workflow-rules` plus every sibling named in Tasks 1–2.

  Expected: green.
- [ ] **Step 2: Commit** "Document workflow rules".
- [ ] **Step 3: Stop for owner review**, then:
  1. `node scripts/db.mjs supabase/project-workflow-rules.sql supabase/anon-lockdown.sql`
  2. A read-only check.
  3. Re-run the suites.
  4. Push `main`.
