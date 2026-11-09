# Space Settings and Space Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give work spaces the same roles as their projects, carry a space role into the person's projects, and move Teams, Members and Archive into a Settings tab built like a project's.

**Architecture:** One new SQL file adds `general_space_members.role` as the source of truth for work spaces and derives `level` from it, so existing `level` checks keep working. New RPCs set the role, cascade it to live projects, and hand over the space. The frontend replaces the four top tabs with one Settings page whose left menu reuses the existing page components.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Vitest with happy-dom, Supabase Postgres (plpgsql, RLS).

**Spec:** `docs/superpowers/specs/2026-11-10-space-settings-and-roles-design.md`

## Global Constraints

- Work spaces only (`general_spaces.kind = 'work'`). Class spaces keep Owner, Manager, Member and every current path.
- `general_space_members.role` is written; `level` is derived. Write `role`, never `level`, on a work space.
- All SQL lives in `supabase/space-roles.sql`, idempotent, wrapped in `begin; … commit;`, running after `project-member-import.sql` and before `anon-lockdown.sql`.
- Every redefinition starts from the live `pg_get_functiondef`, changing only what the task names.
- A space role change never touches a `general_members` row with role `pm`, and never an archived project.
- Launch changes no `general_members.role`.
- Do not hardcode colors; use the tokens in `src/styles/index.css`. Desktop first, then tablet, then phone.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Work-space UI says "Project manager", never "Owner". Class-space UI keeps "Owner".
- No SQL reaches the live database, and nothing is pushed, before Task 10's rollout gate.

## Review Focus

Each line's test is added in the task named.

1. A space PM who is a Member in a project led by someone else keeps that project's PM untouched when another person's role changes, and a person who is PM of a project stays PM when their space role changes (Task 2).
2. A person on an archived project and a live one: only the live one changes, and the preview counts only the live one (Task 2).
3. A space Coordinator removing the space PM or another Coordinator, or using a stale tab after being moved to Member, is refused by the database (Tasks 2 and 4).
4. Re-running `space-roles.sql` after roles have been set keeps those roles and leaves `general_members` unchanged (Task 1).
5. Old bookmarks, including `/spaces/:id/teams/archive`, land on the right section, and a Member opening the Archive section by URL lands on Details instead of a blank page (Task 6).

---

## Dry runs

SQL is tested without touching live data, as earlier phases did. The runner lives in the session scratchpad, not the repo. `dry-run.mjs <source.sql> <suite.sql>` reads `SUPABASE_DB_URL` like `scripts/db.mjs`, removes lines that are exactly `begin;`, `commit;` or `rollback;` from both files, runs `begin;` + source + suite on one client, always ends with `rollback;`, prints each `NOTICE`, and exits non-zero on error. Below, "dry run" means `node <scratchpad>/dry-run.mjs supabase/space-roles.sql supabase/tests/space-roles.test.sql`, and passing means every line is `NOTICE: PASS …` with exit code 0.

The suite copies the helpers from `supabase/tests/project-settings-general.test.sql` (`pg_temp.act_as`, `act_as_service`, `must_be`, `must_refuse_with`), creates its own people and spaces with random ids, and rolls back.

---

### Task 1: Role column, sync, launch backfill and read paths

**Files:**
- Create: `supabase/space-roles.sql`
- Create: `supabase/tests/space-roles.test.sql`

**Interfaces:**
- Produces columns: `general_space_members.role public.general_role` (null on class spaces), `general_space_invitations.invited_role public.general_role not null default 'member'`.
- Produces view column: `general_space_overview.my_role` (appended last).
- Produces: `list_general_space_members(uuid)` gains `role` as its last column; `list_general_space_invitations(uuid)` gains `invited_role` last.
- Produces: `general_space_default_role(p_project uuid, p_user uuid) returns public.general_role`: the person's space role for that project's space, `pm` becoming `coordinator`, null when the project is a class board or the person has no space role. Internal: `revoke execute` from `public, anon, authenticated`.

- [ ] **Step 1: Write the failing suite** with these labelled assertions:

```sql
must_be('owner backfilled to pm', role = 'pm' and level = 'owner')         -- for a row inserted with level 'owner' before the file's backfill is re-run
must_be('member backfilled to member', role = 'member')
must_be('class space row keeps null role', role is null)                   -- education space insert
must_be('role coordinator derives manager', level = 'manager')
must_be('role qa derives member', level = 'member')
must_be('older insert with level owner gets pm', role = 'pm')              -- insert (space_id,user_id,level) only
must_refuse_with('second pm refused', <update second row to pm>, 'general_space_members_one_pm')
must_be('student can be coordinator in a work space', role = 'coordinator') -- as a signed-in caller
must_refuse_with('student cannot be pm', <update>, 'student')
must_be('class space student level rule still holds', <refused for level manager>)
must_be('overview shows my_role', my_role = 'coordinator')
must_be('members list returns role', role = 'qa')
must_be('rerun keeps a set role', role = 'qa')                             -- Review Focus 4: re-execute the backfill statement
must_be('rerun leaves project roles', <count of general_members with changed role> = 0)
must_be('space role notice names the role', preview = 'You are now a coordinator')
```

- [ ] **Step 2: Run the dry run.** Expected: FAIL on `column "role" does not exist` (use `-- ` with an empty source to confirm).

- [ ] **Step 3: Write `supabase/space-roles.sql`**
  - Add both columns with `add column if not exists`.
  - `sync_general_space_member_role()`, a before-insert-or-update-of-role-level trigger named `general_space_members_a_sync_role` (the `a_` makes it fire before `general_space_members_student_level`). On education spaces set `new.role := null` and return. Otherwise reuse `general_member_role_for` with `coalesce(new.role, 'member')`, then `new.level := general_role_level(new.role)`.
  - Backfill work-space rows `where role is null`: owner to pm, manager to coordinator, member to member. Never touch a non-null role.
  - `create unique index if not exists general_space_members_one_pm on general_space_members (space_id) where role = 'pm'`.
  - Mark pending work-space invitations with `invited_level = 'owner'` as `withdrawn`.
  - `guard_student_level()`: live body plus a nested branch for `tg_table_name = 'general_space_members'`: if the space is `work`, refuse only `new.role = 'pm'` for a student with `A student cannot be the project manager.`, then return new. Other tables keep today's rule.
  - `notify_general_membership()`: live body, with `'You are now ' || general_role_phrase(new.role)` for a work-space row. Recreate `general_space_members_notify_level` as `after update of level, role … when (old.level is distinct from new.level or old.role is distinct from new.role)`.
  - `create or replace view general_space_overview`: live definition with `m.role as my_role` appended.
  - Drop and recreate both list functions with the appended column, restoring their grants.
  - `general_space_default_role` as above.

- [ ] **Step 4: Run the dry run.** Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/space-roles.sql supabase/tests/space-roles.test.sql
git commit -m "Add space roles and derive space levels from them"
```

---

### Task 2: Setting a space role and handing over the space

**Files:**
- Modify: `supabase/space-roles.sql`, `supabase/tests/space-roles.test.sql`

**Interfaces:**
- Consumes: `general_space_members.role`.
- Produces: `general_space_role_targets(p_space uuid, p_user uuid, p_role public.general_role, p_by_pm boolean) returns setof uuid`, internal. Live projects to change: `space_id = p_space`, `class_board_id is null`, `archived_at is null`, person on it, role not `pm`, role not `p_role`, and `p_by_pm or role <> 'coordinator'`.
- Produces: `preview_general_space_role(p_space uuid, p_user uuid, p_role public.general_role) returns table (project_count int, task_count int, qa_start_count int)`.
- Produces: `set_general_space_role(p_space uuid, p_user uuid, p_role public.general_role) returns int` (projects changed).
- Produces: `hand_over_general_space(p_space uuid, p_user uuid) returns void`.

- [ ] **Step 1: Add failing assertions**

```sql
must_be('member set to coordinator on both live projects', <both rows coordinator>)
must_be('project pm stays pm', role = 'pm')                                  -- Review Focus 1
must_be('archived project skipped', role = 'member')                         -- Review Focus 2
must_be('preview counts live projects only', project_count = 1)              -- Review Focus 2
must_be('a project override stands until the next change', role = 'qa')
must_be('qa releases held tasks', <assignee rows> = 0)
must_be('preview counts tasks', task_count = 2)
must_be('preview counts new qa gates', qa_start_count = 1)
must_be('grants cleared off member', <general_grants rows> = 0)
must_be('coordinator moves member to qa', role = 'qa')
must_be('space coordinator leaves project coordinators', role = 'coordinator')
must_be('space pm overwrites project coordinators', role = 'qa')
must_refuse_with('coordinator cannot make a coordinator', …, 'project manager')
must_refuse_with('coordinator cannot change a coordinator', …, 'project manager')
must_refuse_with('member cannot set roles', …, 'permission')
must_refuse_with('pm through set role refused', …, 'hand over')
must_refuse_with('cannot change the space pm', …, 'hand over')
must_refuse_with('archived space refused', …, 'archived')
must_refuse_with('stale coordinator refused', …, 'permission')               -- Review Focus 3
must_refuse_with('level rpc refused on a work space', <set_general_space_level>, 'role')
must_be('class space level rpc still works', level = 'manager')
must_be('hand over swaps', old role = 'coordinator' and new role = 'pm')
must_be('hand over changes no project role', <count changed> = 0)
must_refuse_with('hand over to a student', …, 'student')
must_refuse_with('hand over without the switch', …, 'Project manager turned on')
must_refuse_with('only the pm hands over', …, 'project manager')
```

- [ ] **Step 2: Run the dry run.** Expected: FAIL on the first new assertion.

- [ ] **Step 3: Implement the functions**
  - Shared gate in `set` and `preview`, in this order: work space; `general_space_has_invite`; not archived; `p_role <> 'pm'` (`Use hand over to change the project manager.`); lock the PM row then the target row `for update`; target exists and is not `pm`; a Coordinator caller only acts on `member`, `qa`, `stakeholder` and never gives `coordinator` (`Only the project manager can …`).
  - `set_general_space_role` updates the space row, then for each target project repeats the last three statements of `set_general_member_role` in `project-qa.sql`: update role; if not `member`, delete grants and withdraw open access requests; if `qa` or `stakeholder`, delete task assignees under `collabify.general_archive_op`. Project triggers do the logging, chat, team-lead and notice work. Returns the count.
  - `preview` uses the same targets: tasks are assignee rows only when `p_role in ('qa','stakeholder')`; `qa_start_count` counts targets with `not general_project_has_qa(project)` when `p_role = 'qa'`.
  - `hand_over_general_space`: caller is the space PM; not archived; target in the space, active, not a student, `is_project_manager(target)`. Set the old PM to `coordinator` first, then the target to `pm`, for the unique index.
  - `set_general_space_level`: live body with a first-line refusal on work spaces: `Use the space role to change this person.`
  - Grants: `revoke all … from public, anon; grant execute … to authenticated` for the three RPCs; none for the targets helper.

- [ ] **Step 4: Run the dry run.** Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/space-roles.sql supabase/tests/space-roles.test.sql
git commit -m "Carry a space role into the person's projects"
```

---

### Task 3: Invitations and joining projects

**Files:**
- Modify: `supabase/space-roles.sql`, `supabase/tests/space-roles.test.sql`

**Interfaces:**
- Consumes: `general_space_default_role`.
- Produces: `invite_general_space_member(p_space uuid, p_user uuid, p_role public.general_role default 'member')`; the two-argument form is dropped.

- [ ] **Step 1: Add failing assertions**

```sql
must_be('invite carries a role', invited_role = 'qa')
must_be('accepting gives the role', role = 'qa')
must_be('accepting starts no cascade', <existing project row unchanged>)
must_be('coordinator can invite', <row exists>)
must_be('coordinator can list invitations', <count> = 1)
must_refuse_with('coordinator cannot invite a coordinator', …, 'project manager')
must_refuse_with('invite as pm refused', …, 'hand over')
must_refuse_with('co-owner invite refused on work', <invite_to_general_space>, 'hand over')
must_be('class space invite still works', <row exists>)
must_be('code join uses the space role', role = 'coordinator')
must_be('code join: pending invitation wins', role = 'qa')
must_be('space pm joining by code is coordinator', role = 'coordinator')
must_be('team seed uses space roles', role = 'stakeholder')
must_be('team seed keeps the creator as pm', role = 'pm')
must_be('project coordinator may invite a space coordinator', role = 'coordinator')
must_refuse_with('project coordinator cannot invite other coordinators', …, 'project manager')
```

- [ ] **Step 2: Run the dry run.** Expected: FAIL on the first new assertion.

- [ ] **Step 3: Redefine, from live**
  - `general_space_manages_invites`: work branch becomes `general_space_has_invite`.
  - `invite_general_space_member`: gate on `general_space_has_invite`, refuse `pm`, refuse `coordinator` from a non-PM, write `invited_role`.
  - `invite_to_general_space`: work branch refuses with `A space has one project manager. Use Hand over instead.` Class branch unchanged.
  - `respond_general_space_invitation`: work branch inserts `(space_id, user_id, role)` from `invited_role`, `on conflict do nothing`. Accepting starts no cascade, because joining a space does not set a role on projects already held.
  - `join_general_project`: `coalesce(pending invitation role, general_space_default_role(p.id, auth.uid()), 'member')`.
  - `create_general_project` (eight-argument form): the team seed inserts `(project_id, user_id, role)`, the creator as `pm`, others `coalesce(general_space_default_role(p.id, tm.user_id), 'member')`.
  - `invite_to_general_project`: `coordinator` from a non-PM is allowed when `general_space_default_role(p_project, p_user) = 'coordinator'`.

- [ ] **Step 4: Run the dry run.** Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/space-roles.sql supabase/tests/space-roles.test.sql
git commit -m "Use space roles when people join projects"
```

---

### Task 4: Details, teams and removing people

**Files:**
- Modify: `supabase/space-roles.sql`, `supabase/tests/space-roles.test.sql`

**Interfaces:**
- Produces: `list_general_space_teams(uuid)` and `(uuid, boolean)` return every team in the space, `my_level` null where the caller is not on it. `list_general_space_team_members` returns every team's people.

- [ ] **Step 1: Add failing assertions**

```sql
must_be('coordinator edits details', name = 'New name')
must_refuse_with('member cannot edit details', …, 'permission')
must_refuse_with('coordinator cannot archive the space', …, 'project manager')
must_be('member reads every team', <count> = 2)
must_be('not on the team: my_level null', my_level is null)
must_be('member reads team people', <count> > 0)
must_be('coordinator creates a team', <row exists>)
must_refuse_with('switch holder who is a member cannot create', …, 'coordinator')
must_be('coordinator edits a team they are not on', name = 'Renamed')
must_refuse_with('team owner who is a member cannot edit', …, 'manage')
must_be('pm removes the only team owner', <row gone>)
must_be('member can still leave a team', <row gone>)
must_refuse_with('project seed needs team membership', <create_general_project with a team not joined>, 'team')
must_be('coordinator removes a member', <row gone>)
must_refuse_with('coordinator cannot remove the pm', …, 'project manager')    -- Review Focus 3
must_refuse_with('coordinator cannot remove a coordinator', …, 'project manager')
must_refuse_with('pm cannot leave without handing over', …, 'hand over')
must_be('coordinator gets no read of a project they are not on', not can_read_general_project(p))
must_be('coordinator on the project still reads it', can_read_general_project(p2))
```

- [ ] **Step 2: Run the dry run.** Expected: FAIL on the first new assertion.

- [ ] **Step 3: Redefine, from live**
  - `update_general_space`: allow `general_space_has_manage` or, on a work space, `general_space_has_invite`.
  - `archive_general_space`: refusal text on work spaces reads `Only the project manager archives a space.`; the check stays owner-level.
  - `general_space_team_can_manage(p_team)`: true when `general_space_can_invite(team's space)`.
  - `create_general_space_team`: gate on `general_space_can_invite`.
  - `remove_general_space_team_member`: drop the "at least one Owner" check; the rest stays.
  - Both `list_general_space_teams` (the two-argument form from `archive-page.sql`, keeping `trashed_at is null`): `left join` on the viewer's team row. `list_general_space_team_members`: drop the `exists mine`.
  - Policies `general_space_teams_select` and `general_space_team_members_select`: add `or is_general_space_member(space_id)`.
  - `remove_general_space_member`: a non-PM caller cannot remove `pm` or `coordinator` (`Only the project manager can remove …`). On a work space the last-PM message reads `Hand over the space before leaving.`
  - Leave the "ask for a project" rules (`project-requests.sql`) alone. Coordinators with the account switch keep what Manager had.

- [ ] **Step 4: Run the dry run.** Expected: all PASS.

- [ ] **Step 5: Run the neighbouring suites in dry runs** for `general-spaces`, `general-space-teams`, `project-visibility`, `project-settings-general`, `project-requests` and `one-workplace`. Expected: only failures that also occur with an empty source. Any new failure caused by the role change is fixed in the suite or the file, and noted in the commit.

- [ ] **Step 6: Commit**

```bash
git add supabase/space-roles.sql supabase/tests/
git commit -m "Open space details and teams to coordinators"
```

---

### Task 5: Frontend role helpers and API

**Files:**
- Modify: `src/lib/general/permissions.ts`, `src/lib/general/permissions.test.ts`, `src/lib/general/types.ts`, `src/lib/api/spaces.ts`, `src/lib/api/general.ts`, `src/lib/general/navigation.ts`, `src/lib/general/navigation.test.ts`, `src/lib/paths.ts`, `src/lib/paths.test.ts`, `src/components/general/NewProjectDialog.tsx`, `src/pages/general/GeneralReports.tsx`

**Interfaces:**
- Produces in `permissions.ts`:
  - `SPACE_ROLES: ProjectRole[]`, in the order `coordinator, member, qa, stakeholder`.
  - `spaceRoleChoices(mine: ProjectRole | null, target: ProjectRole): ProjectRole[]`.
  - `canEditSpace(mine: ProjectRole | null): boolean`, true for `pm` and `coordinator`.
  - `defaultInviteRole(spaceRole: ProjectRole | undefined, allowed: ProjectRole[]): ProjectRole`.
- Produces in `types.ts`: `GeneralSpaceSummary.my_role: ProjectRole | null`; `SpaceInvitation.invited_role: ProjectRole`; `GeneralSpaceTeam.my_level` nullable.
- Produces in `spaces.ts`: `setSpaceRole(spaceId, userId, role): Promise<number>`, `previewSpaceRole(spaceId, userId, role): Promise<SpaceRolePreview>`, `handOverSpace(spaceId, userId): Promise<void>`, `inviteSpaceMember(spaceId, userId, role = 'member')`. Type `SpaceRolePreview = { project_count: number; task_count: number; qa_start_count: number }`.
- Produces in `general.ts`: `listMySpaceTeams(spaceId)`, which is `listSpaceTeams(spaceId)` filtered to non-null `my_level`.
- Produces in `navigation.ts`: `SpaceSettingsSection = 'details' | 'teams' | 'members' | 'archive'`, `spaceSettingsSection(params: URLSearchParams, canSeeArchive: boolean): SpaceSettingsSection`.
- Produces in `paths.ts`: `spaceMembers`, `spaceTeams`, `spaceArchive` become `/spaces/${id}/settings?section=…`; `spaceTeamsArchive` becomes `/spaces/${id}/settings?section=teams&archived=1`.

- [ ] **Step 1: Write failing tests**

```ts
expect(spaceRoleChoices('pm', 'member')).toEqual(['coordinator', 'member', 'qa', 'stakeholder'])
expect(spaceRoleChoices('pm', 'coordinator')).toEqual(['coordinator', 'member', 'qa', 'stakeholder'])
expect(spaceRoleChoices('coordinator', 'qa')).toEqual(['member', 'qa', 'stakeholder'])
expect(spaceRoleChoices('coordinator', 'coordinator')).toEqual([])
expect(spaceRoleChoices('coordinator', 'pm')).toEqual([])
expect(spaceRoleChoices('member', 'qa')).toEqual([])
expect(defaultInviteRole('qa', ['member', 'qa'])).toBe('qa')
expect(defaultInviteRole('pm', ['member', 'coordinator'])).toBe('coordinator')
expect(defaultInviteRole('coordinator', ['member', 'qa'])).toBe('member')
expect(defaultInviteRole(undefined, ['member'])).toBe('member')
expect(spaceSettingsSection(new URLSearchParams('section=archive'), false)).toBe('details')
expect(spaceSettingsSection(new URLSearchParams('section=archive'), true)).toBe('archive')
expect(spaceSettingsSection(new URLSearchParams('section=nope'), true)).toBe('details')
expect(paths.spaceTeamsArchive('s')).toBe('/spaces/s/settings?section=teams&archived=1')
```

- [ ] **Step 2: Run `npx vitest run src/lib/general src/lib/paths.test.ts`.** Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement.** `defaultInviteRole` maps `pm` to `coordinator`, returns it when allowed, else `member`. `NewProjectDialog` and `GeneralReports` switch to `listMySpaceTeams`, so a person is offered only teams the database lets them use.

- [ ] **Step 4: Run the same tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/components/general/NewProjectDialog.tsx src/pages/general/GeneralReports.tsx
git commit -m "Add space role helpers and calls"
```

---

### Task 6: The Settings page, tabs and old links

**Files:**
- Create: `src/pages/general/SpaceDetails.tsx` (today's `SpaceSettings.tsx` body), `src/pages/general/SpaceSettings.test.tsx`, `src/pages/general/SpaceLegacyRedirect.tsx`
- Modify: `src/pages/general/SpaceSettings.tsx`, `src/pages/general/SpaceLayout.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `SpaceSettingsSection`, `spaceSettingsSection`, `canEditSpace`, `paths.*`.
- Produces: `SpaceLegacyRedirect({ section, archived }: { section: SpaceSettingsSection; archived?: boolean })`, replacing with the settings URL for the route's `:spaceId`.

- [ ] **Step 1: Write failing tests** in `SpaceSettings.test.tsx`, modelled on `ProjectSettings.test.tsx` (mock the four section components and `useGeneralNavigation`):

```ts
it('shows every section to a coordinator')   // nav labels: Details, Teams, Members, Archive
it('hides Archive from a member')            // nav labels: Details, Teams, Members
it('sends a member opening Archive to Details')  // ?section=archive renders 'Details content' (Review Focus 5)
it('opens a section and writes it to the URL')   // click Teams, location.search === '?section=teams'
it('counts members and archived projects in the menu')
it('redirects the old teams archive link')   // /spaces/s/teams/archive → ?section=teams&archived=1 (Review Focus 5)
it('redirects the old members link')         // /spaces/s/members → ?section=members
```

- [ ] **Step 2: Run `npx vitest run src/pages/general/SpaceSettings.test.tsx`.** Expected: FAIL.

- [ ] **Step 3: Implement**
  - `SpaceSettings.tsx`: left menu with the same layout and classes as `ProjectSettings.tsx`, sections Details (`settings`), Teams (`target`), Members (`users`), Archive (`archive`), rendering `SpaceDetails`, `GeneralTeams`, `SpaceMembers`, `SpaceArchive`. Archive shows only when `canEditSpace(space.my_role)`.
  - `SpaceLayout.tsx`: `TABS` becomes overview, projects, reports, settings. Settings shows for everyone.
  - `App.tsx`: routes `members`, `teams`, `teams/archive`, `archive` render `SpaceLegacyRedirect`.

- [ ] **Step 4: Run the test and `npm run typecheck`.** Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/general src/App.tsx
git commit -m "Move space admin pages into a Settings menu"
```

---

### Task 7: Details, Teams and Archive by role

**Files:**
- Modify: `src/pages/general/SpaceDetails.tsx`, `src/pages/general/GeneralTeams.tsx`, `src/pages/general/SpaceArchive.tsx`, `src/pages/general/SpacePicker.tsx`
- Test: `src/pages/general/SpaceDetails.test.tsx`, `src/pages/general/GeneralTeams.test.tsx`

**Interfaces:**
- Consumes: `canEditSpace`, `space.my_role`.

- [ ] **Step 1: Write failing tests**

```ts
it('a member sees details without inputs enabled or a save button')
it('a coordinator can edit details but sees no archive control')
it('the project manager sees the archive control')
it('a member sees every team with no edit, archive, add or remove controls')
it('a coordinator sees those controls on a team they are not on')
it('shows no Create team button to a member who has the Project manager switch')
it('reads the archived teams view from ?archived=1')
```

- [ ] **Step 2: Run the two test files.** Expected: FAIL.

- [ ] **Step 3: Implement**
  - `SpaceDetails`: no redirect for non-owners. Inputs disabled and Save hidden unless `canEditSpace`. Archive or restore section only for `my_role === 'pm'`.
  - `GeneralTeams`: `canManage = !archived && canEditSpace(space?.my_role)` for every team, and the Create button and empty-state copy use the same. `archivePage` reads `archived=1` from the query, and the switch link uses `paths.spaceTeams` and `paths.spaceTeamsArchive`. Remove the two `levelLabel` displays, since a team's own level no longer means anything to a reader.
  - `SpaceArchive`, `SpacePicker`, copy: "Owner" becomes "project manager" in work-space text. `SpacePicker` line 270 uses `ROLE_LABEL[s.my_role]` when `my_role` is set, else `levelLabel(s.my_level)`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/general
git commit -m "Show space settings by role"
```

---

### Task 8: Members section

**Files:**
- Modify: `src/pages/general/SpaceMembers.tsx`, `src/components/general/InviteToSpaceDialog.tsx`, `src/components/general/InviteToSpaceDialog.test.ts`
- Test: `src/pages/general/SpaceMembers.test.tsx`

**Interfaces:**
- Consumes: `spaceRoleChoices`, `SPACE_ROLES`, `ROLE_LABEL`, `setSpaceRole`, `previewSpaceRole`, `handOverSpace`, `inviteSpaceMember`.
- Produces: `InviteToSpaceDialog` prop `roles?: ProjectRole[]`. When given it shows a role select starting on `member`, and `invite` receives `(spaceId, userId, role)`.

- [ ] **Step 1: Write failing tests**

```ts
it('shows the project manager as a label with no dropdown or remove button')
it('offers four roles to the project manager, for a student too')
it('offers three roles to a coordinator and a label for another coordinator')
it('shows a member labels only, and still the leave section')
it('saves straight away when the preview releases nothing')       // setSpaceRole called, no dialog
it('asks first when tasks would be released')                     // dialog body names 1 project and 2 tasks
it('asks first when a QA gate would start')
it('does not save when the dialog is cancelled')
it('offers hand over to the project manager only, never for a student')
it('passes the chosen role through the invite dialog')
it('shows no Add a co-owner button in a work space')
```

- [ ] **Step 2: Run the two test files.** Expected: FAIL.

- [ ] **Step 3: Implement**
  - Rows show `Select` when `spaceRoleChoices(mine, m.role)` is non-empty, and `ROLE_LABEL[m.role]` otherwise. The current choice is always in the list because a pm's choices are all four and a coordinator's include the three it may act on.
  - `changeRole`: `previewSpaceRole`, then save if `task_count === 0 && qa_start_count === 0`, else open `ConfirmDialog`. Body: `This moves {name} to {role} in {n} projects.` plus `They let go of {t} tasks.` and `QA review starts in {k} projects.`, each only when non-zero, with singular and plural through `plural`.
  - Toast `{first_name} is now {role} in this space`, then `load()` and `reloadNavigation()`.
  - Hand over: a row action for the PM, with a `ConfirmDialog` titled `Hand over this space?`, body `{name} becomes the project manager, and you become a coordinator. Project roles stay as they are.`
  - Remove button shows when `spaceRoleChoices` is non-empty for that row (the same people a caller may act on).
  - Pending invitations and the invite button use `canEditSpace`. Remove `Add a co-owner` and its dialog. The Invited row shows `ROLE_LABEL[i.invited_role]`.
  - Class-space branches stay as they are. The file redirects class spaces already, so the level dropdown and `setSpaceLevel` import go away here. `FacultyPanel` keeps its own.
  - Leave section: the space PM sees `Hand over the space before leaving.` in place of the Leave button.

- [ ] **Step 4: Run the tests and `npm run typecheck`.** Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/general/SpaceMembers.tsx src/pages/general/SpaceMembers.test.tsx src/components/general/InviteToSpaceDialog.tsx src/components/general/InviteToSpaceDialog.test.ts
git commit -m "Set space roles from Members"
```

---

### Task 9: Project invites start on the space role

**Files:**
- Modify: `src/components/general/InvitePanel.tsx`, `src/components/general/settings/JoinRequestsPanel.tsx`, `src/components/general/settings/JoinRequestsPanel.test.tsx`
- Test: `src/components/general/InvitePanel.test.tsx`

**Interfaces:**
- Consumes: `listSpaceMembers`, `defaultInviteRole`, `inviteRoles`.

- [ ] **Step 1: Write failing tests**

```ts
it('starts the invite on the person\'s space role')              // space role qa → select value qa
it('falls back to Member when the person has no space role')
it('starts on Member when the space list fails to load')
it('offers a coordinator the Coordinator choice only for a space Coordinator')
it('starts a join request on the space role')                     // JoinRequestsPanel
```

- [ ] **Step 2: Run the two test files.** Expected: FAIL.

- [ ] **Step 3: Implement.** `InvitePanel.Search` loads `listSpaceMembers(project.space_id)` once into a `Map<user_id, ProjectRole>`, failing silently to an empty map. `pick(hit)` sets `role` from `defaultInviteRole(map.get(hit.person_id), options)`. A Coordinator inviting a space Coordinator gets `coordinator` added to `options`. `JoinRequestsPanel` keeps roles in its existing `listSpaceMembers` call and sets each row's starting role the same way once loaded. Update the old "Every pick starts at Member" comment and the join-code copy to say the person joins with their space role.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/general
git commit -m "Start project invites on the space role"
```

---

### Task 10: Docs, full checks and rollout

**Files:**
- Modify: `docs/07-backup.md`, `CLAUDE.md`, `handoff.md`, `supabase/tests/anon-lockdown.test.sql` if it lists functions

- [ ] **Step 1: Document.** In `docs/07-backup.md`, add `space-roles.sql` to the final rerun tail after `project-member-import.sql`, a section listing what it owns (`guard_student_level`, `notify_general_membership`, `general_space_overview`, the listed space, team, join and invite functions), and which earlier files mean re-running it: `general-spaces.sql`, `general-space-teams.sql`, `one-workplace.sql`, `project-visibility.sql`, `project-roles.sql`, `project-qa.sql`, `company-accounts.sql`, `archive-page.sql`, `task-archive.sql`, `notification-coverage.sql`, `project-settings-general.sql`. In `CLAUDE.md`, add a "Space roles" paragraph under Project roles. Append a section to `handoff.md`.

- [ ] **Step 2: Run the full frontend checks.** Run `npm run build`, `npm run lint`, `npx vitest run`. Expected: all pass.

- [ ] **Step 3: Check the page on localhost** with the built-in browser: start the dev server through `.claude/launch.json`, sign in with a test account or as the user directs, and confirm the tabs, the menu, and light, dark and phone widths. Against a live database that does not have the SQL yet, only layout can be checked, so note that here.

- [ ] **Step 4: STOP. Ask the user for the rollout go-ahead.** State exactly what will happen: apply the SQL to live and push `main`, one right after the other, because the old app cannot change space roles once the SQL is on and the new app needs the SQL. Do not continue without a yes.

- [ ] **Step 5: Snapshot and apply.** Save `select project_id, user_id, role from general_members` to the scratchpad. Run:

```bash
node scripts/db.mjs supabase/space-roles.sql supabase/anon-lockdown.sql
```

- [ ] **Step 6: Verify launch.** Run the suite with `node scripts/db.mjs supabase/tests/space-roles.test.sql` and `supabase/tests/anon-lockdown.test.sql`. Expected: all PASS. Compare the snapshot to a fresh select. Expected: zero differences. Check each work space has exactly one `role = 'pm'`, and no work-space row has a null role.

- [ ] **Step 7: Push and walk the roles.** Commit docs, `git push origin main` after the user's review, wait for Vercel, then walk the live site as space PM, Coordinator, Member and Stakeholder, using the user's sign-in when one is needed. Change a role on a test person, confirm their projects follow, then restore it.

- [ ] **Step 8: Commit any follow-up fixes** and update `handoff.md` with the outcome and the next step.
