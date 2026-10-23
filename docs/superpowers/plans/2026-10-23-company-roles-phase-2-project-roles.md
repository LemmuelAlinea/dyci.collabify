# Company roles, phase 2: project roles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work projects get company roles: one project manager (PM),
coordinators and members, plus a team-lead tag. Roles are enforced in the
database. People see only the projects they are on, and they enter spaces
through projects.

**Architecture:**
- A new enum column, `general_members.role`, becomes the source of truth for
  a person's place in a work project.
- A trigger keeps the old `level` column in step with `role`
  (pm → owner, coordinator → manager, everyone else → member). The ~75 SQL
  call sites and the shared `general_level` enum (also used by class spaces
  and space members) keep working unchanged.
- Where the roles must differ from the old levels, the permission helper
  `general_has` now reads `role`. One example: a coordinator does not get
  `edit_project`.
- SQL ships first. Because `level` stays in sync, the current frontend keeps
  working against every intermediate database state. The frontend then moves
  to roles, and the last task drops the old level RPC.

**Tech stack:** React 19 + TypeScript + Vite, Supabase (Postgres RLS,
plpgsql), Vitest, SQL tests run with `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-23-company-roles-design.md`. This
plan covers rollout phase 2 and these sections: "Work spaces", "Project
roles" (minus the QA and Stakeholder powers), "Teams" and "Seeing roles".
Stakeholder read-only, Feedback and the slim sidebar are phase 3. QA is
phase 4.

## Global constraints

- `supabase/*.sql` must stay idempotent; it gets re-run. Apply files in the
  real rebuild order (`docs/07-backup.md` lines 26 and 53, mirrored in
  `scripts/schema-drift.mjs` ORDER). Re-run `anon-lockdown.sql` after
  applying anything.
  - Each new SQL file in this plan is appended to both rebuild lines and to
    ORDER, after `company-accounts.sql`, in task order.
  - The re-run note in `docs/07-backup.md` gains every older file whose
    functions these files redefine.
  - When a function is redefined, start from its LAST definition in that
    order. Example: `guard_general_task`'s last definition is in
    `task-archive.sql`. Change only what the task lists.
- Everything here applies only to work projects: `class_board_id is null`.
  The 8 hidden class-board Files projects keep today's model untouched.
- `role`, `status`, `can_teach` and `can_manage_projects` on profiles are
  admin-only (phase 1). Do not weaken that.
- Exact names fixed by this plan:
  - enum `public.general_role` with values `'pm','coordinator','member','qa','stakeholder'`
  - columns `general_members.role` and `general_invitations.role`
    (both `general_role not null default 'member'`)
  - column `general_teams.leader_id uuid` (nullable)
  - functions:
    - `general_role_level(general_role) returns general_level`
    - `general_role_of(p_project uuid, p_user uuid default auth.uid()) returns general_role`
    - `general_project_has_pm(p_project uuid) returns boolean`
    - `general_leads_user(p_project uuid, p_lead uuid, p_user uuid) returns boolean`
  - RPCs:
    - `set_general_member_role(p_project uuid, p_user uuid, p_role general_role)`
    - `invite_to_general_project(p_project uuid, p_user uuid, p_role general_role default 'member')`
    - `hand_over_general_project(p_project uuid, p_to uuid)`
    - `assign_general_project_pm(p_project uuid, p_user uuid)`
    - `set_general_team_leader(p_team uuid, p_user uuid)` (null clears)
  - project event kinds `'member_role'`, `'pm_handover'`, `'team_leader'`
  - frontend:
    - type `ProjectRole`
    - `ROLE_LABEL`, `rolePermissions`, `canAs`, `assignableRoles`, `ROLE_MATRIX`
    - component `RoleBadge`
    - admin route `/admin/projects`
- **Phase 2 offers PM, Coordinator and Member only.** The enum holds `qa`
  and `stakeholder` for phases 3–4.
  - `set_general_member_role` and `invite_to_general_project` refuse them
    with: *"QA and stakeholder roles are not available yet."*
  - The UI does not offer them.
- Role labels (copy):
  - Project manager · Coordinator · Member · QA · Stakeholder
  - Badges: PM · Coordinator · Lead · QA · Stakeholder
  - Member shows no badge.
- Copy: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.
- No hardcoded colors; use design tokens. Desktop first, then tablet, then
  phone.
- Run `npm run build` before claiming anything works.

## Review focus

The failure modes most likely to bite a person, each pinned by a test in the
named task:

1. **Creating a project** (with or without a space team) makes the creator
   its PM. A project never ends up with 0 or 2 PMs. *(Task 1.)*
2. **A coordinator** can manage tasks, files, members and teams, but cannot
   edit project details or stages, archive, delete, or hand over. *(Task 1
   for `general_has`, Task 2 for the RPCs.)*
3. **A space member who is not on a project** can no longer read its tasks,
   repo, members, sprints or milestones. A space owner can read them but
   write nothing. *(Task 3.)*
4. **Hand over** leaves exactly one PM. The old PM becomes Coordinator. A
   target without the Project manager switch is refused. *(Task 2.)*
5. **A student** can be invited as Coordinator and can join with a project
   code. Making a student PM is refused. *(Tasks 1 and 2.)*
6. **A team lead** can edit and assign a task held by someone on their team,
   but not a task held only by people on another team. *(Task 4.)*

---

### Task 1: `project-roles.sql`, role column, migration, permissions

**Files:**
- Create: `supabase/project-roles.sql`, `supabase/tests/project-roles.test.sql`.
  Style: copy `supabase/tests/company-accounts.test.sql`, which uses
  `act_as`, `must_refuse_with` and paired allowed cases.
- Modify: `scripts/schema-drift.mjs` ORDER, `docs/07-backup.md` (both
  rebuild lines and the re-run note).

**Interfaces:**
- Produces:
  - enum `general_role`
  - columns `general_members.role` and `general_invitations.role`
  - `general_role_level(r)`: pm→owner, coordinator→manager, else member
  - `general_role_of(p_project, p_user)`: the active member's role, null if
    not a member
  - `general_project_has_pm(p_project)`: true when some member has role
    `pm` and their profile is active with `can_manage_projects`
  - the reworked `general_has`

**Steps (one file, in this order):**
1. **Enum and columns.** Add the enum in its own `begin; … commit;` block,
   as `company-accounts.sql` does. Then add both columns.
2. **Level sync.** Add a `BEFORE INSERT OR UPDATE OF role` trigger
   `sync_general_member_level` on `general_members`. For a work project it
   sets `new.level := general_role_level(new.role)`; class-board projects
   are skipped.
   - **Reverse direction, for old callers:** on INSERT, when `role` is
     still the default and `level` is `owner`/`manager`, derive the role
     first: owner→pm, manager→coordinator.
   - So existing insert paths keep producing the right role without being
     rewritten: `create_general_project` (last def
     `general-space-teams.sql:417`), invite response, join by code,
     space-team seeding.
3. **Migration** (work projects only):
   - `update general_members set role = case level when 'owner' then 'pm' when 'manager' then 'coordinator' else 'member' end`.
     Live data: 5 owners (1 per project), 0 managers, 11 members.
   - Class-board rows get `role = 'member'` with `level` untouched.
4. **One PM.**
   - Partial unique index `general_members_one_pm` on `(project_id)`
     `where role = 'pm'`.
   - If class-board rows ever carry `pm`, scope the index with a check
     trigger instead; class-board rows are all `member` after the
     migration.
5. **Students.** Redefine `guard_student_level` (last def
   `company-accounts.sql:596`). On `general_members` of a work project a
   student may hold any role except `pm`. Message: *"A student cannot be
   the project manager."* Its behaviour on space tables and class-space
   tables is unchanged.
6. **`general_has`** (last def `general.sql:306`) reads `role` for work
   projects:

   | Role | Permissions |
   |---|---|
   | pm | all six |
   | coordinator | `manage_members`, `manage_structure`, `manage_tasks`, `edit_files`, `commit_main` (not `edit_project`) |
   | member | its `general_grants` only |
   | qa, stakeholder | none |

   Class-board projects keep the current body path, including the
   class-board commit rule.
7. **PM-only checks.** Check every raw `level in ('owner','manager')`
   check and `general_leads` caller that gates an action the spec makes
   PM-only:
   - project details and stages
   - archive, restore, delete
   - the project join code (`set_general_join_code`, owner-only today)

   Each must reduce to PM (`level = 'owner'`). List every check you
   touched, and every one you left, in the report.
8. **Students and project codes.** `join_general_project` (last def
   `company-accounts.sql:607`) now admits students, as Member. Copy for the
   remaining refusals stays as is. `join_general_space` is Task 3.

**Tests** (`project-roles.test.sql`):
- After the migration, every work project has exactly one `pm`, and it is
  the old owner.
- A PM-enabled member calls `create_general_project`, with and without a
  space team. The creator's role is `pm` and level `owner`.
- A second `pm` insert on the same project violates `general_members_one_pm`.
- `general_has` matrix, as `act_as`:
  - a coordinator has `manage_tasks`, `edit_files`, `manage_members`,
    `manage_structure` and `commit_main`, but not `edit_project`;
  - a member with no grants has none;
  - a member granted `edit_files` has only that;
  - a pm has all six.
- A coordinator updating the project's details/stages is refused; the PM is
  allowed. A coordinator archiving the project is refused; the PM is
  allowed.
- A student set to `coordinator` by service-role insert is allowed. A
  student as `pm` is refused with the message above.
- A student uses an open project join code and becomes Member.
- A class-board project's member rows and `general_has` results are
  unchanged by the migration: snapshot before and after inside the test.

- [ ] **Step 1:** Write the test and run
  `node scripts/db.mjs supabase/tests/project-roles.test.sql`. Expected:
  FAIL (no `general_role`).
- [ ] **Step 2:** Write `project-roles.sql` as above.
- [ ] **Step 3:** Apply it:
  `node scripts/db.mjs supabase/project-roles.sql supabase/anon-lockdown.sql`.
  Then run it a second time; it must be idempotent.
- [ ] **Step 4:** The test → all PASS. Then run every
  `supabase/tests/general*.test.sql`, `company-accounts`, `access`,
  `work-planning`, `work-milestones`, `task-archive`, `archive-page` and
  `trash` → all PASS. Then `node scripts/schema-drift.mjs` → no new
  suspects.
- [ ] **Step 5:** `npm run build` (the frontend is untouched and must still
  compile). Commit and push.

### Task 2: Role management RPCs and the role activity log

**Files:**
- Modify: `supabase/project-roles.sql`, appending a section.
- Modify: `supabase/tests/project-roles.test.sql`, adding cases.

**Interfaces:**
- Consumes: Task 1.
- Produces: the RPCs `set_general_member_role`, the new
  `invite_to_general_project` signature (old 2-arg calls still work through
  the default), `hand_over_general_project` and `assign_general_project_pm`.
  Event kinds `member_role` and `pm_handover`.

**Rules:**
- **`set_general_member_role`**:
  - The PM may set any non-PM role on anyone but themself.
  - A coordinator may switch people among `member` only in phase 2. The
    future rule is member/qa/stakeholder.
  - A coordinator may not change a coordinator or the PM.
  - Setting `pm` is refused: *"Use hand over to change the project
    manager."*
  - `qa`/`stakeholder` are refused (Global constraints).
  - Moving someone away from `member` deletes their grants and withdraws
    their open requests, as `set_general_member_level` does today
    (`general.sql:1126`).
  - Archived projects are refused.
- **`invite_to_general_project(p_project, p_user, p_role)`**:
  - The caller needs `manage_members`.
  - `p_role` must be `member` or `coordinator`, and only the PM may invite
    a coordinator.
  - The role is stored on `general_invitations.role`. The invite response
    RPC inserts with that role.
  - Inviting someone who is already a member is refused as today.
- **`remove_general_member`** and **`leave_general_project`** (last defs
  `general.sql:1184`, `:1228`):
  - The PM cannot be removed: *"Hand over the project before removing its
    project manager."*
  - The PM cannot leave: *"Hand over the project before you leave."*
  - A coordinator may remove members but not coordinators.
- **`hand_over_general_project(p_project, p_to)`**:
  - The caller must be the PM. `p_to` must be an active project member
    with `is_project_manager(p_to)`. If not: *"Only someone with Project
    manager turned on can run a project."*
  - In one transaction the old PM becomes `coordinator` and `p_to` becomes
    `pm`. Demote first, then promote, so the unique index holds.
- **`assign_general_project_pm(p_project, p_user)`**:
  - Allowed only when `general_project_has_pm(p_project)` is false.
    Otherwise: *"This project already has a project manager."*
  - The caller must be an admin or an owner of the project's space
    (`general_space_members.level = 'owner'`).
  - `p_user` needs `is_project_manager`.
  - Any existing `pm` row (an inactive PM, or one without the switch)
    becomes `coordinator` first. `p_user` is then set to `pm`, and inserted
    as a member first if they were not on the project.
- **`set_general_member_level`** stays for now. For work projects it maps
  owner→pm and manager→coordinator, then delegates to the new rules, so the
  current UI keeps working. Task 8 drops it.
- **Events.**
  - Widen the `general_project_events` kinds CHECK (`general-reports.sql:56`)
    with `member_role` and `pm_handover`.
  - `log_general_member_change` (last def `general-reports.sql:260`) writes
    `member_role` with `{from, to}` roles when `role` changes, and
    `pm_handover` with `{from_user, to_user}` from the hand-over RPC.
  - Stop writing `member_level` for work projects.
- **Notifications.** The "You are now X" label function
  (`notification-coverage.sql:86`) reads role labels for work projects:
  "You are now the project manager", "You are now a coordinator", "You are
  now a member".

**Tests** (added to `project-roles.test.sql`):
- A PM sets a member to coordinator; it is allowed and writes a
  `member_role` event.
- A coordinator sets a member to coordinator; refused.
- A coordinator sets a coordinator to member; refused.
- A PM sets someone to `pm`; refused with the hand-over message.
- Anyone sets `qa`; refused.
- A PM invites as coordinator and the invitee accepts: role is
  `coordinator`. A coordinator invites as coordinator; refused. A
  coordinator invites as member; allowed.
- Removing the PM is refused. A coordinator removing a coordinator is
  refused. A coordinator removing a member is allowed.
- The PM leaves; refused.
- Hand over:
  - to a member without the switch: refused;
  - to a member with the switch: exactly one `pm` afterwards, the old PM is
    `coordinator`, and one `pm_handover` event is written;
  - by a non-PM: refused.
- PM recovery:
  - Assigning while a PM is active is refused.
  - Deactivate the PM (inside the test), then:
    - a space owner assigns a PM-enabled outsider: allowed. The outsider
      becomes `pm` and the old PM `coordinator`;
    - a plain space member tries it: refused;
    - an admin assigns: allowed.
- A student invited as coordinator: allowed.

- [ ] **Step 1:** Add the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Apply with anon-lockdown, twice.
- [ ] **Step 4:** Run the test plus `general*.test.sql` and
  `notification*.test.sql` → PASS. `schema-drift` → clean.
- [ ] **Step 5:** `npm run build` → clean. Commit and push.

### Task 3: `project-visibility.sql`, see only your projects, enter spaces through projects

**Files:**
- Create: `supabase/project-visibility.sql`, `supabase/tests/project-visibility.test.sql`.
- Modify: ORDER and `docs/07-backup.md` (append after `project-roles`).

**Interfaces:**
- Produces:
  - narrowed `can_read_general_project`
  - helper `is_general_space_owner(p_space uuid) returns boolean`, if no
    equivalent exists already
  - membership trigger `add_general_member_to_space`

**Rules:**
- **Who can read a work project.** `can_read_general_project` (last def
  `general-project-archive-rbac.sql:39`):
  - a project member, OR
  - an owner of the project's space (read-only, because every write path
    goes through `general_can`, which requires membership).
  - The archived branch is unchanged.
- **Other readers to narrow the same way.** Audit each one that admits a
  plain space member to a work project, and narrow it to project member or
  space owner:
  - `general_projects_select` (`general-spaces.sql:352`)
  - `general_field_values_select` (`:366`)
  - the 18-table loop (`general-spaces.sql:333-347`), checking each policy
    body actually calls `can_read_general_project`; redefine any that
    inline `is_general_space_member`
  - `general_sprints_read` (`work-planning.sql:130`)
  - `general_milestones_read` (`work-milestones.sql:45`)
  - `list_general_project_members` (`one-workplace.sql:808,814`)
  - `general_report_can_read` (`general-reports.sql:122`)
  - the views `general_project_overview` (last `general-project-space.sql:22`)
    and `general_space_overview`, for project counts and lists a plain
    space member sees

  List each object and the decision in the report. Class-board projects are
  untouched.
- **Joining a project adds you to its space.** An `AFTER INSERT` trigger on
  `general_members` (work projects with a `space_id`) inserts
  `(space_id, user_id, 'member')` into `general_space_members` when
  missing. Losing a project role never removes space membership.
  - Backfill: the 6 live project members who are not in their project's
    space.
- **Space invites are for co-owners only.** `invite_to_general_space` (last
  `general-spaces.sql:700`):
  - The caller must be a space owner.
  - The invitee must pass `is_project_manager`. If not: *"Only people with
    Project manager turned on can co-own a space. Invite them to a project
    instead."*
  - The invitation response inserts level `owner`.
- **Space join codes stop admitting.**
  - `set_general_space_join_code` refuses opening a code: *"Space codes are
    retired. Share a project code instead."* Closing still works.
  - `join_general_space` (last `company-accounts.sql:645`) refuses with the
    same message.
  - Live: 0 open space codes.

**Tests** (`project-visibility.test.sql`). Fixture: a space with owner O; a
plain space member S who is not on project P; a project member M:
- S selects `general_tasks`, `general_members`, `general_repos`,
  `general_sprints` and `general_milestones` for P: 0 rows each.
  `general_projects` for P: 0 rows.
- M sees all of them.
- O sees P and its tasks, but O inserting a task into P is refused, and O
  updating P is refused.
- S calls `list_general_project_members(P)` and gets nothing (or an error,
  whichever the function's style is). O gets the list.
- A user added to P (insert as member) now has a `general_space_members`
  row for P's space. Removing them from P keeps the space row.
- Space invites: the owner invites a PM-enabled member, who accepts as
  `owner`. The owner invites a switchless member; refused. A plain member
  invites anyone; refused.
- Opening a space join code is refused; closing it is allowed.
  `join_general_space` with any code is refused.
- After the backfill, every member of a work project with a space is also
  in that space.

- [ ] **Step 1:** Write the test and run it. Expected: FAIL.
- [ ] **Step 2:** Write the file.
- [ ] **Step 3:** Apply with anon-lockdown, twice.
- [ ] **Step 4:** Run the test plus `general*.test.sql`, `work-planning`,
  `work-milestones`, `rls-coverage` → PASS. `schema-drift` → clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 4: `project-team-leads.sql`, team leaders and their task powers

**Files:**
- Create: `supabase/project-team-leads.sql`, `supabase/tests/project-team-leads.test.sql`.
- Modify: ORDER and `docs/07-backup.md`.

**Interfaces:**
- Produces:
  - `general_teams.leader_id`
  - `set_general_team_leader(p_team, p_user)`
  - `general_leads_user(p_project, p_lead, p_user)`: true when `p_lead`
    leads a team in `p_project` that `p_user` belongs to
  - event kind `team_leader`

**Rules:**
- **The leader.**
  - The leader must be on that team (`general_team_members`) and must not
    have role `stakeholder`. Enforce this with a trigger on
    `general_teams`.
  - `set_general_team_leader` needs `manage_structure`, so the PM or a
    coordinator. Null clears the leader.
  - Leading never changes `role`.
  - A trigger clears `leader_id` when the leader leaves the team, leaves the
    project, or becomes a stakeholder.
  - Changes write a `team_leader` event `{team_id, from, to}`. Widen the
    CHECK again.
- **What leading a team allows.**
  - `guard_general_task` (last `task-archive.sql:490`) and
    `sync_general_task_stage` (`task-stages.sql:165`): an update is also
    allowed when the actor `general_leads_user` any current assignee of
    the task. Rank and order changes are covered by the same update path.
  - Assignee insert policy (`general-tasks.sql:453`): a lead may assign a
    user they lead to any task in the project.
  - Assignee delete (`:463`): a lead may unassign a user they lead.
  - Changing the task's weight still needs `manage_tasks`.
- The project creation path that seeds teams from a space team sets no
  leader.

**Tests** (`project-team-leads.test.sql`). Fixture: teams A (lead L,
member U) and B (member V):
- L edits a task held by U: allowed. L edits a task held only by V: refused.
- L assigns U to an unheld task: allowed. L assigns V: refused. L
  unassigns U: allowed.
- L changes the weight of U's task: refused.
- `set_general_team_leader(A, U)` by a coordinator: allowed. By a member:
  refused.
- Setting a leader who isn't on the team: refused. Setting a stakeholder
  (set via service role inside the test): refused.
- Removing L from team A clears `leader_id`. A `team_leader` event is
  written on a change.

- [ ] **Step 1:** Write the test and run it. Expected: FAIL.
- [ ] **Step 2:** Write the file.
- [ ] **Step 3:** Apply with anon-lockdown, twice.
- [ ] **Step 4:** Run the test plus `general-tasks*.test.sql`,
  `task-archive`, `task-stages` (if one exists) → PASS. `schema-drift` →
  clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 5: Frontend role model and data plumbing

**Files:**
- Modify: `src/lib/general/permissions.ts`, `src/lib/general/types.ts`,
  `src/lib/api/general.ts`, `src/components/general/useGeneralProject.ts`.
- Modify: the raw `me.level` sites: `DiscussionTab.tsx:142,561`,
  `RequestAccessButton.tsx:37`, `RequestsPanel.tsx:118`.
- Test: `src/lib/general/permissions.test.ts` (create it if missing).

**Interfaces:**
- Consumes: the DB columns from Tasks 1–4.
- Produces, in `permissions.ts`:
  - `type ProjectRole = 'pm' | 'coordinator' | 'member' | 'qa' | 'stakeholder'`
  - `ROLE_LABEL: Record<ProjectRole, string>` (labels from Global
    constraints) and `ROLE_BADGE: Record<ProjectRole, string | null>`
    (member → null)
  - `rolePermissions(role: ProjectRole): GeneralPermission[]`: the same
    matrix as Task 1
  - `canAs(role: ProjectRole | null, grants: GeneralPermission[], p: GeneralPermission): boolean`.
    Member = grants only; null = false.
  - `assignableRoles(actor: ProjectRole, target: ProjectRole): ProjectRole[]`.
    Phase 2 rules from Task 2: the PM gets `['coordinator','member']` for a
    non-PM target, a coordinator gets `['member']` for a member target, and
    everything else gets `[]`.
  - `ROLE_MATRIX: { action: string; roles: Partial<Record<ProjectRole | 'lead', 'yes' | 'team' | 'grant' | 'own' | 'read'>> }[]`.
    Plain-words rows from the spec's "What each role can do" table. Every
    row of that table, including the QA and Stakeholder columns, so the
    table reads right in phases 3–4.
- In `types.ts`:
  - project summaries gain `my_role: ProjectRole | null` and
    `has_pm: boolean`
  - member rows gain `role: ProjectRole`
  - teams gain `leader_id: string | null`
- Add both columns to `general_project_overview` in Task 5's own SQL
  touch-up. Append them to the view in `project-roles.sql`, recreated the
  way `general-project-space.sql` does it. Re-apply.
- `useGeneralProject` exposes `myRole`, `can(p)` via `canAs`, and
  `leadsUser(userId): boolean` from teams + `leader_id`.
  - `levelPermissions`, `LEVELS` and `levelLabel` stay only where space and
    class-space code still uses levels (`SpaceMembers`, `GeneralTeams`,
    `FacultyPanel`, `SpacePicker`).
  - Work-project code stops reading `level`.

- [ ] **Step 1:** Tests in `permissions.test.ts`:
  - `rolePermissions('coordinator')` contains `manage_tasks` and not
    `edit_project`.
  - `canAs('member', ['edit_files'], 'edit_files')` → true and
    `canAs('member', [], 'manage_tasks')` → false.
  - `canAs(null, [...], 'edit_files')` → false.
  - `assignableRoles('pm','member')` equals `['coordinator','member']`.
  - `assignableRoles('coordinator','coordinator')` equals `[]`.
  - `ROLE_MATRIX` has a row whose `action` contains "Hand over" with only
    `pm: 'yes'`.
  
  Run `npx vitest run src/lib/general/permissions.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Implement, and switch the callers listed above.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Commit and push.

### Task 6: Members tab: roles, invite with role, hand over, "Who can do what"

**Files:**
- Modify: `src/components/general/MembersTab.tsx`,
  `src/components/general/InvitePanel.tsx`, `src/lib/api/general.ts`.
- Create: `src/components/general/RoleBadge.tsx`,
  `src/components/general/RoleGuide.tsx`, `src/components/general/HandOverDialog.tsx`.

**Interfaces:**
- Consumes: Task 5 (`assignableRoles`, `ROLE_MATRIX`, `ROLE_LABEL`,
  `ROLE_BADGE`, `myRole`) and Task 2's RPCs.
- Produces:
  - `RoleBadge({ role, lead }: { role: ProjectRole; lead?: boolean })`.
    Renders `ROLE_BADGE[role]` and, when `lead`, a "Lead" badge. It renders
    nothing for a member who is not a lead. Mono eyebrow style, design
    tokens, readable in light and dark.
  - API functions:
    - `setMemberRole(projectId, userId, role)`
    - `inviteToProject(projectId, userId, role = 'member')`
    - `handOverProject(projectId, toUserId)`
    - `assignProjectPm(projectId, userId)`

**UI:**
- **Member rows** show `RoleBadge`.
  - When `assignableRoles(myRole, row.role)` is non-empty, a role `Select`
    replaces the badge for that row.
  - The grants button shows only for `member` rows.
  - Remove follows Task 2's rules (hidden for the PM; hidden for
    coordinators when the actor is a coordinator).
- **Header copy** replaces "Owners and Managers do everything" (`:82`):
  *"The project manager runs the project. Coordinators handle members,
  tasks, files and meetings. Members do the work, plus anything the project
  manager grants them."*
- **Invite panel:** after picking a person, a role choice (Member, and
  Coordinator when `myRole === 'pm'`). Default Member.
- **Hand over** (PM only):
  - A "Hand over project" action opens `HandOverDialog`.
  - It lists active members who have Project manager turned on. If none
    qualify, it says so: *"Nobody here has Project manager turned on. Ask
    the admin to turn it on for the person you want, then hand over."*
  - Confirm copy: *"You become a coordinator. They become the project
    manager."*
- **"Who can do what":** `RoleGuide` renders `ROLE_MATRIX` as a table under
  the member list.
  - Columns are Project manager, Coordinator, Team lead, Member, QA and
    Stakeholder.
  - Cells are plain words: "Yes", "Their team", "If granted", "Their own",
    "Read only", or blank.
  - Collapsible, closed by default. Fits at 375 px with horizontal scroll
    inside the table only.

**Tests:**
- `src/components/general/RoleBadge.test.tsx`, using the repo's existing
  render-test setup if there is one. If not, test the pure
  `badgesFor(role, lead): string[]` helper exported from `RoleBadge.tsx`:
  - `badgesFor('member', false)` → `[]`
  - `badgesFor('member', true)` → `['Lead']`
  - `badgesFor('coordinator', true)` → `['Coordinator', 'Lead']`
  - `badgesFor('pm', false)` → `['PM']`

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Browser, on localhost signed in as Cloud (a PM of
  Capstone 2):
  - The Members tab shows Cloud's PM badge and the role select on member
    rows.
  - "Who can do what" opens.
  - The hand-over dialog opens and lists eligible people. Cancel, and do
    not hand over.
  - Change nothing in live data. If a write is needed, do it on a project
    you create and delete in the same step.
- [ ] **Step 5:** Commit and push.

### Task 7: Badges everywhere, team leaders in the UI, team filter

**Files:**
- Modify:
  - `src/components/general/StructurePanel.tsx` (team create and edit)
  - `TaskDialog.tsx` (holders `:205`, comments `:166`)
  - `TasksTab.tsx:325-334`
  - `DiscussionTab.tsx:690`
  - `src/components/messages/MessageBubble.tsx` (project chat)
  - the Tasks and Backlog filter components (find the filter state used by
    `TasksTab` and the work `BacklogView`)
- Modify: `src/lib/api/general.ts`, adding `setTeamLeader(teamId, userId | null)`.

**Interfaces:**
- Consumes: `RoleBadge`, `useGeneralProject().leadsUser` and member roles
  (Task 5), and `set_general_team_leader` (Task 4).
- Produces: `roleOf(userId): ProjectRole | null` and
  `isLead(userId): boolean` on `useGeneralProject`.

**UI:**
- **Badges.** Put `RoleBadge` next to names in:
  - task holders
  - task comments
  - discussion messages
  - project chat bubbles (only in conversations of kind `project`; load
    the project's member roles once per conversation)
- **Team leaders (StructurePanel):**
  - The create-team form gets a "Leader" select. It lists the team's
    chosen members, excluding stakeholders, with an option for no leader.
  - The team row shows "Lead: Name", plus a "Change leader" action when
    the user can manage structure.
  - Saving calls `setTeamLeader`. Errors go through `authErrorMessage`
    into a toast.
- **Team filter.** The Tasks and Backlog views get a "Team" filter, shown
  when the project has teams: All teams, or one team = tasks held by that
  team's members.
  - For a lead, it opens on their team the first time on this device
    (remember the choice in `localStorage`, inside try/catch).

**Tests:** extend the filter tests next to the existing task filter tests
(`taskFilterState` or the work backlog tests): filtering by team keeps
tasks held by any team member and drops the rest.

- [ ] **Step 1:** Write the filter test and run it. Expected: FAIL.
- [ ] **Step 2:** Implement everything above.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Browser as Cloud:
  - Badges show on the Members tab, a task's holders and comments, and
    the project chat.
  - The leader select appears in the create-team form. Do not save on a
    real project.
  - The Team filter appears on Tasks and Backlog.
- [ ] **Step 5:** Commit and push.

### Task 8: No-PM notice, admin project list, space pages, activity text, cleanup

**Files:**
- Create: `src/components/general/NoPmNotice.tsx`,
  `src/pages/app/admin/WorkProjects.tsx`.
- SQL: view `admin_work_projects`, with `security_invoker` and rows only
  for `is_admin()`. Add it to `project-roles.sql` and re-apply. Columns:
  `id`, `name`, `space_name`, `pm_name`, `has_pm`, `archived_at`.
- Modify:
  - `src/App.tsx`, adding `/admin/projects`
  - `src/components/app/nav.ts`, adding an ADMIN entry "Work projects"
    after Accounts
  - `src/lib/paths.ts`
- Modify:
  - `src/pages/general/SpaceMembers.tsx` (copy ~`:130`, join-code section
    ~`:148`, invite)
  - `src/components/general/SpaceDialogs.tsx` (`JoinSpaceDialog`)
  - `src/pages/general/SpacePicker.tsx` (Join a space entry)
  - `src/lib/general/history.ts` (`describeActivity`)
- SQL cleanup: drop `set_general_member_level` from `project-roles.sql`,
  once Task 6 no longer calls it (grep to confirm). Re-apply.

**Behaviour:**
- **`NoPmNotice`** shows on a work project's Overview when `has_pm` is
  false, to coordinators and to space owners: *"This project has no project
  manager. Work goes on, but only a project manager can change its details,
  archive it or hand it over."*
  - Space owners also get "Assign a project manager". It opens a picker of
    people with Project manager turned on and calls `assignProjectPm`.
- **`/admin/projects`** lists `admin_work_projects` with the PM's name, or
  "No project manager" as a `warning-*` status chip, plus an "Assign" action
  using the same picker.
- **Space pages:**
  - Copy becomes *"A space holds projects. You see the projects you're on;
    the space's owners see all of them."*
  - The space invite section becomes "Add a co-owner". It searches only
    people with Project manager turned on, and its error text comes from
    the RPC.
  - The space join-code section and the "Join a space" entry are removed.
- **`describeActivity`:**
  - `member_role` → "Ana is now a coordinator", using role labels.
  - `pm_handover` → "Ben handed the project to Ana".
  - `team_leader` → "Ana now leads Design", or "Design has no leader" when
    cleared.
  - Keep `member_level` text for old rows.
- Append a handoff.md section in house style (What / files table / Checked /
  Still to check by you / Deferred / Next = phase 3).
- Update CLAUDE.md: work projects use `general_members.role`; `level` is
  derived; the spec path.

**Tests:**
- `nav.test.ts`: the admin rail contains "Work projects".
- `history` tests: the three new event kinds produce the strings above.
- `project-roles.test.sql`: `admin_work_projects` returns rows for the
  admin and 0 for a member. `set_general_member_level` no longer exists.

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement and apply the SQL.
- [ ] **Step 3:** `npx vitest run`, `npm run build` and `npx eslint src`
  → clean. All `supabase/tests/*.test.sql` → PASS.
- [ ] **Step 4:** Browser:
  - As Cloud: the space page copy, no join-code section, and "Add a
    co-owner".
  - Ask the user to sign in as admin for `/admin/projects`. If they are
    unavailable, record it under "Still to check by you".
- [ ] **Step 5:** Commit and push.
