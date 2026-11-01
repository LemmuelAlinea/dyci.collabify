# Project Settings Group 3 (Member options) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two project switches: "Members can manage milestones" and "Members can create tasks". A member's tasks go into private planning.

**Architecture:**
- **Database.** A new file, `supabase/project-member-rules.sql`, runs after `project-task-rules.sql` and before `anon-lockdown.sql`. It adds two `general_projects` columns, a helper `general_can_manage_milestones(project)` used by the redefined `general_milestones` insert/update/delete policies, and a definer RPC `create_general_member_task` that follows the `create_general_subtask` pattern. The existing task insert guard is not changed.
- **App.** Adds a "Member options" panel, conditional role-guide rows, and gates "Add task" and the milestone controls for members.

**Tech Stack:** React + TypeScript (Vite), Tailwind tokens, Supabase Postgres (plpgsql, RLS), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-project-settings-members-design.md`

## Global Constraints

- **Scope.** Work projects only; class boards are untouched.
- **Defaults.** Both switches default to false, so today's behaviour is unchanged.
- **Who flips the switches.** Only the project manager, through `edit_project`.
- **"Member" means** `general_members.role = 'member'`, team leads included. QA, Stakeholders and Workspace viewers are unaffected.
- **Milestone switch scope.** It covers creating, editing, deleting and marking milestones reached. It does not cover tagging tasks or linking sprints, which keep `manage_tasks`.
- **Member tasks.** They start in private planning, with `created_by` set to the member, no holder, and the project's default priority. They are never released by this path.
- **Conventions.**
  - Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
  - Colors from tokens only.
  - New SQL is idempotent.
  - Redefinitions start from the live definition.
  - Until the owner approves, SQL is dry-run only, and nothing is pushed.

## Review Focus

1. **Switch off after creation.** When the PM turns "Members can create tasks" off, members can no longer create tasks. Tasks they already created stay in planning. *(Task 1: "turning the switch off stops new member tasks but keeps existing ones")*
2. **Member sees their own planning task.** After creating one, a member can still read their own unsent task. Other members can't. *(Task 1: "a member reads their own planning task, another member does not")*
3. **Archived project.** Neither switch lets anyone write to an archived project. *(Task 1: "archived projects refuse member milestone and task writes")*
4. **QA and Stakeholder.** These roles get nothing from either switch. *(Task 1: "qa and stakeholders are not members for these switches")*
5. **Grant holders.** Members with a "Manage tasks" grant keep full milestone rights whatever the switch says. *(Task 1: "a manage_tasks grant still manages milestones with the switch off")*

---

### Task 1: Database — member switches, milestone helper, member task RPC

**Files:**
- Create: `supabase/project-member-rules.sql`, `supabase/tests/project-member-rules.test.sql`

**Interfaces:**
- Produces:
  - `general_projects.members_manage_milestones bool not null default false`.
  - `general_projects.members_create_tasks bool not null default false`.
  - `general_can_manage_milestones(p_project uuid) returns boolean`. Stable and security definer. It returns true when `general_can(p_project, 'manage_tasks')`, or when the switch is on, `general_role_of(p_project) = 'member'` and `general_can_write(p_project)`.
  - The `general_milestones` insert (with check), update and delete policies, redefined to use `general_can_manage_milestones(project_id) and not general_is_archived(project_id)`. Start from the live definitions and keep everything else they check. Read `guard_general_milestone` as well: if it re-checks `manage_tasks`, it must accept the helper too.
  - `create_general_member_task(p_project uuid, p_title text, p_description text default '', p_due_at timestamptz default null, p_team uuid default null) returns uuid`. Security definer.
    - It requires a work project, the switch on, the caller's role `member`, `general_can_write`, a non-archived project, and a non-empty title.
    - It inserts a planning task. When `p_team` is given, the team must be one of the project's teams.
    - It uses the claims-clearing insert pattern from `create_general_subtask` in `project-task-rules.sql`: set `collabify.subtask_op` / clear the JWT claims for the insert only and always restore them, and set `created_by` to the caller.
    - It returns the task id.
  - Messages:
    - "This project doesn't let members create tasks."
    - "Only members use this. Planners create tasks from Plan."
- [ ] **Step 1: Write the failing suite.** Use the phase 1 harness. Checks:
  - `'both switches are off by default'`
  - `'a member cannot create a milestone while the switch is off'` (refused or 0 rows)
  - `'a member can create, edit, mark reached and delete a milestone when the switch is on'`
  - `'the milestone switch does not let a member tag tasks or link sprints'`
  - `'a manage_tasks grant still manages milestones with the switch off'`
  - `'qa and stakeholders are not members for these switches'`
  - `'archived projects refuse member milestone and task writes'`
  - `'a member cannot create a task while the switch is off'`
  - `'a member's task starts in private planning with no holder'`
  - `'a member reads their own planning task, another member does not'`
  - `'turning the switch off stops new member tasks but keeps existing ones'`
  - `'only the project manager can change the switches'`
- [ ] **Step 2: Dry-run.** Expected: FAIL (`column "members_manage_milestones" does not exist`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry-run to green.** Then dry-run `work-milestones` (if present), `sprint-milestones`, `project-roles`, `work-task-handoff`, `project-task-rules` and `project-settings-general` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit** "Let projects open milestones and task creation to members".

### Task 2: App — data, panel, role guide, gated controls

**Files:**
- Modify:
  - `src/lib/api/general.ts`: `getGeneralProject` returns `memberRules: { manageMilestones: boolean; createTasks: boolean }` (defaults false). `ProjectPatch` accepts both columns. Add `createMemberTask(projectId, title, description?, dueAt?, teamId?) → Promise<string>`.
  - `src/lib/general/permissions.ts`: add `canManageMilestones(role, can, memberRules)` and `canCreateWorkTaskWith(role, kind, memberRules)`, and update `ROLE_MATRIX` for the conditional rows.
  - `src/components/general/workSource.ts` and the milestone source: `canManage` for milestones uses `canManageMilestones`. `canAdd` for tasks uses `canCreateWorkTaskWith`. Members add through `createMemberTask`.
  - `src/components/general/settings/MembersSection.tsx`: a "Member options" panel.
  - `src/components/general/RoleGuide.tsx`: the conditional captions.
- Test: `permissions.test.ts`, `settings/MembersSection.test.tsx`, `RoleGuide` and workSource tests.

**Interfaces:**
- Consumes: Task 1's columns and RPC.
- Produces:
  - **The panel.** It's titled "Member options" and holds two switches with exact labels:
    - "Members can manage milestones". Help: "Create, edit and mark milestones reached. Tagging tasks still needs Manage tasks."
    - "Members can create tasks". Help: "Their tasks start in planning for the project manager or a coordinator to send."

    It has a "Save member options" button that shows the toast "Member options saved". Only the PM (`edit_project`, not `readOnly`) can edit; everyone else sees it read-only.
  - **Role guide.** When a switch is on, the matching row shows Member as "yes, set by the project manager" (use the existing `RoleMark` style for a conditional, or a short caption).
  - **Member creation.** When a member creates a task, the toast reads "Sent to planners for review" and the task opens in planning.
- [ ] **Step 1: Write failing tests:**
  - The permission helpers across roles and switches.
  - The panel's save payload.
  - A member sees "Add task" only when the switch is on, and creating calls `createMemberTask`.
  - The milestone controls show for a member only when the switch is on.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reads of the new columns fall back to false only for a missing column (`isMissingColumn`), with a "remove once live" comment.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** "Add member options for milestones and task creation".

### Task 3: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: add the file after `project-task-rules.sql` in both restore commands and the rerun tail, plus a section on what it owns and the re-run rule.
  - `CLAUDE.md`: one concise bullet.
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Run checks.**
  - Build, vitest, eslint on changed files, and contrast.
  - SQL dry-runs of `project-member-rules` plus the Task 1 sibling suites.

  Expected: all green.
- [ ] **Step 2: Commit** "Document member options".
- [ ] **Step 3: Stop for owner review**, then:
  1. `node scripts/db.mjs supabase/project-member-rules.sql supabase/anon-lockdown.sql`
  2. A read-only check.
  3. Re-run the suites.
  4. Push `main`.
