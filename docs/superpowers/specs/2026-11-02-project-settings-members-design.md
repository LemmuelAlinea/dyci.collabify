# Project Settings, phase 2 group 3 — Members & Permissions (design)

Date: 2026-11-02. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section E. Groups live: phase 1 (sprints), group 1 (look, visibility, joining,
Danger zone), group 2 (task management). Next: Milestones, Notifications,
Workflow rules.

## Why

The PDF's permission table gives members two things Collabify can only grant one
person at a time or not at all: managing milestones ("Optional") and creating
tasks. Collabify already has richer roles than the PDF (PM, Coordinator, Team
lead, Member, QA, Stakeholder), per-person grants and a role guide, so this
group adds two project-wide switches rather than a new permission system.

## Decided by the owner

- **"Members can manage milestones"** switch in Settings → Members &
  permissions, off by default. When on, every Member of the project can create,
  edit, delete and mark milestones reached — nothing else (not assigning, not
  sprint planning). Per-person "Manage tasks" grants keep working as today.
- **"Members can create tasks"** switch, off by default. When on, a Member can
  create a task; it starts in **private planning**, like every new work task,
  and the PM or a coordinator reviews and sends it through the existing
  handoff flow.

## My calls (owner to check)

1. Only the project manager changes the two switches (`edit_project`, like the
   other project rules). They show to everyone, read-only for others.
2. "Member" means `general_members.role = 'member'` (including team leads,
   who are members). QA and Stakeholders are not affected: QA keeps creating
   bug tasks only; Stakeholders stay read-only; Workspace viewers stay
   read-only.
3. Database: two columns on `general_projects`
   (`members_manage_milestones`, `members_create_tasks`, both default false),
   in a new file `supabase/project-member-rules.sql` that runs after
   `project-task-rules.sql` and before `anon-lockdown.sql`.
   - Milestones: a helper `general_can_manage_milestones(project)` =
     the existing milestone rule OR (switch on and the caller is a Member);
     the milestone write policies/RPCs use it. Redefinitions start from the
     live definitions.
   - Tasks: a security-definer RPC `create_general_member_task(project, title,
     description, due_at, team)` that checks the switch and the Member role,
     then inserts the task in planning (same pattern as `create_general_subtask`),
     so the existing insert guard owned by `work-task-handoff.sql` is not
     redefined. The member's task carries them as creator; it is not held by
     anyone until sent.
4. App: the Members & permissions section gets a "Member options" panel with
   the two switches; the role guide's rows read "Plan milestones — Members:
   if the project allows" and "Create tasks — Members: if the project allows"
   when the switch is on; the Tasks tab's "Add task" and the milestone
   controls appear for Members when allowed. A Member sees their own planning
   tasks (the release boundary already lets creators read their unsent work;
   to be confirmed against the live rules and, if not, the RPC response shows
   "Sent to planners for review").
5. Class boards untouched.

## Non-goals

Custom per-role permission matrices, new roles, changes to Coordinator/Team
lead/QA/Stakeholder abilities.

## Constraints

Tokens only, copy rules, desktop → phone, idempotent SQL, release boundary,
`general_can_write` for new member-write paths, owner reviews before any live
SQL or push.
