# Project Settings Group 1 (General + Danger zone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give work projects a color, an icon, a default view, Private/Workspace visibility with "Ask to join", and a Danger zone in Settings → General with transfer ownership and delete.

**Architecture:** New `general_projects` columns plus a `general_join_requests` table and RPCs, all in a new `supabase/project-settings-general.sql` that runs last in the chain (after `work-task-handoff.sql`, before `anon-lockdown.sql`) and redefines `can_read_general_project` for Workspace visibility. The app reads color and icon through a small side lookup, the way `listProjectStages` works, so the shared `general_project_overview` view (owned by 9 files) is not touched.

**Tech Stack:** React + TypeScript (Vite), Tailwind v4 tokens in `src/styles/index.css`, Supabase Postgres (plpgsql, RLS), Vitest, SQL suites via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-01-project-settings-general-design.md`

## Global Constraints

- Work projects only (`class_board_id is null`). Class boards and class projects are untouched.
- Colors come only from tokens; never raw hex in components. The 8 swatches (navy, amber, green, teal, violet, rose, orange, slate) are new tokens defined for light and dark, and `node scripts/contrast.mjs` must still pass.
- The 20 icons are existing `Icon` names: `monitor, board, kanban, folder, book, calendar, clock, chart, shield, palette, spark, target, file, message, users, video, bell, mail, pin, crown`.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Layout: desktop first, then tablet, then phone.
- `supabase/*.sql` is idempotent. Redefinitions start from the live `pg_get_functiondef`. `docs/07-backup.md` records the new file. `anon-lockdown.sql` runs after it.
- Until the owner approves, SQL is dry-run only, inside the suite's rolled-back transaction (same method as phase 1). There's no push and no live SQL without the owner's go-ahead.
- Defaults: `color` null, `icon` null (today's look), `default_view` `'overview'`, `visibility` `'private'`.

## Review Focus

1. **A space member who is not on a Private project:** still sees nothing, either in lists or at the project URL. *(Task 1: "a private project stays hidden from space members")*
2. **A Workspace viewer:** can read but never write, sees no private planning tasks, and can't call member-only RPCs. *(Task 1: "a workspace viewer cannot write" and "a workspace viewer sees no private planning tasks")*
3. **Asking to join twice, or after being added:** no second open request is created, and the request closes when the person becomes a member. *(Task 1: "one open request per person", "an approved request makes them a member and closes it")*
4. **A coordinator approving someone as coordinator:** refused, because a coordinator can only give member, qa or stakeholder. *(Task 1: "a coordinator cannot approve as coordinator")*
5. **Opening a link that names a tab (a notification link to `?tab=plan`):** still opens that tab, never the default view. *(Task 3: navigation test "a named tab wins over the default view")*

---

### Task 1: Database — project look, visibility, join requests

**Files:**
- Create: `supabase/project-settings-general.sql`, `supabase/tests/project-settings-general.test.sql`

**Interfaces:**
- Produces:
  - `general_projects` columns:
    - `color text check (color in ('navy','amber','green','teal','violet','rose','orange','slate'))`
    - `icon text check (icon in (<the 20 names>))`
    - `default_view text not null default 'overview' check (default_view in ('overview','plan','tasks'))`
    - `visibility text not null default 'private' check (visibility in ('private','workspace'))`

    All are written through the existing `general_projects` update policy (`edit_project`).
  - `can_read_general_project(p_project)`: the live body, plus for work projects `or (p.visibility = 'workspace' and public.is_general_space_member(p.space_id))`.
  - Table `general_join_requests`:
    - `id uuid pk`
    - `project_id uuid → general_projects on delete cascade`
    - `user_id uuid → auth.users on delete cascade`
    - `status text check in ('open','approved','declined','withdrawn') default 'open'`
    - `role general_role` (null until approved)
    - `created_at`, `answered_by`, `answered_at`
    - a unique partial index `(project_id, user_id) where status = 'open'`

    RLS: the requester reads their own rows; the PM and coordinators of the project read all of them. No direct writes.
  - RPCs (security definer, `search_path = public`, granted to authenticated):
    - `request_join_general_project(p_project uuid) returns uuid`: needs a Workspace work project, the caller a space member who isn't a project member, and the project not archived.
    - `withdraw_join_request(p_request uuid) returns void`: the requester only.
    - `answer_join_request(p_request uuid, p_approve boolean, p_role general_role default 'member') returns void`: the PM or a coordinator. Roles follow the invite rules: the PM gives coordinator, member, qa or stakeholder; a coordinator gives member, qa or stakeholder. Approval inserts the `general_members` row with `role` and closes the request.
  - Notification enum values, each added in its own committed block at the top, as `sprint-settings.sql` does:
    - `join_requested`: to the PM and active coordinators. Title "{name} asked to join {project}", preview "Answer it in Settings → Members & permissions."
    - `join_answered`: to the requester. Title "You joined {project}" or "Your request to join {project} was declined", empty preview.

- [ ] **Step 1: Write the failing suite.** Use the phase 1 harness (see `supabase/tests/sprint-settings.test.sql`). Checks:
  - `'new projects are private with the overview as default view'`
  - `'the project manager can set color, icon, default view and visibility'`
  - `'an unknown color or icon is refused'`
  - `'a private project stays hidden from space members'`
  - `'a workspace project is readable by a space member'`
  - `'a workspace viewer cannot write'` (a task insert is refused)
  - `'a workspace viewer sees no private planning tasks'`
  - `'a member of another space cannot read it'`
  - `'a space member can ask to join a workspace project'`
  - `'asking to join a private project is refused'`
  - `'one open request per person'`
  - `'a coordinator can approve as member'`
  - `'a coordinator cannot approve as coordinator'`
  - `'an approved request makes them a member and closes it'`
  - `'a declined request notifies the requester'`
  - `'the requester can withdraw'`
  - `'others cannot read someone else's request'`
- [ ] **Step 2: Dry-run.** Expected: FAIL (`column "visibility" does not exist`).
- [ ] **Step 3: Implement** `supabase/project-settings-general.sql`.
- [ ] **Step 4: Dry-run to green.** Then dry-run `project-roles`, `project-visibility` (if a suite exists), `project-stakeholders`, `work-task-handoff`, `sprint-settings` with the file loaded. Expected: 0 failures.
- [ ] **Step 5: Commit**: "Add project look, workspace visibility and join requests".

### Task 2: App data layer

**Files:**
- Modify: `src/lib/general/types.ts` (`GeneralProject` + `ProjectColor`, `ProjectIcon`, `ProjectView`, `ProjectVisibility`, `JoinRequest`), `src/lib/api/general.ts`, `src/components/general/useGeneralProject.ts`, `src/lib/types.ts` (the notification union), `src/components/app/NotificationBell.tsx`
- Create: `src/lib/general/projectLook.ts`, `src/lib/general/projectLook.test.ts`

**Interfaces:**
- Produces:
  - Constants in `projectLook.ts`:
    - `PROJECT_COLORS: readonly ProjectColor[]`
    - `PROJECT_ICONS: readonly ProjectIcon[]` (the 20 names, typed as `IconName`)
    - `PROJECT_VIEWS`, with labels Overview, Plan, Tasks
  - `getGeneralProject` also returns `color`, `icon`, `default_view`, `visibility` (read beside `stages`). `ProjectPatch` accepts them.
  - `listProjectLooks(ids: string[]): Promise<{ id: string; color: ProjectColor | null; icon: ProjectIcon | null }[]>`, the same shape and pattern as `listProjectStages`.
  - Join request API:
    - `listJoinRequests(projectId): Promise<JoinRequest[]>`
    - `requestToJoin(projectId): Promise<string>`
    - `withdrawJoinRequest(id): Promise<void>`
    - `answerJoinRequest(id, approve: boolean, role?: ProjectRole): Promise<void>`
  - `GeneralProjectState.joinRequests: JoinRequest[]`, loaded in `reload`, with `'general_join_requests'` added to `useLive`.
  - Bell links:
    - `join_requested` → `?tab=settings&section=members`
    - `join_answered` → the project
- [ ] **Step 1: Write failing tests.** `projectLook.test.ts`: there are 8 colors and 20 icons, and every icon is a valid `IconName`.
- [ ] **Step 2: Run** `npx vitest run src/lib/general/projectLook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Load project look, visibility and join requests".

### Task 3: Look and default view in the app

**Files:**
- Modify: `src/styles/index.css` (swatch tokens: `--color-swatch-<name>` and `--color-swatch-<name>-ink`, defined in `:root` and `.dark`, never under `.app-ui`)
- Create: `src/components/general/ProjectMark.tsx` (`<ProjectMark color icon name size />`: a rounded tile in the swatch with the icon, falling back to today's letter tile when both are null)
- Modify:
  - `src/components/app/SideNav.tsx` (Quick access `LiveRowLink` uses `ProjectMark` for work rows; looks come from `listProjectLooks` on the visible ids)
  - `src/components/general/WorkProjectCard.tsx` (and any other work-project card)
  - `src/pages/general/GeneralProject.tsx` (the banner accent uses the swatch; with no tab in the URL, open `project.default_view`)
  - `src/lib/general/navigation.ts` (`generalTab(params, defaultTab?: GeneralTabId)`)
  - `src/components/general/settings/GeneralSection.tsx`: a "Look and access" panel with color swatches, an icon grid, a Default view select and a Visibility choice (Private: "Only members and space owners can open it." / Workspace: "Everyone in the space can view it and ask to join."), saved with `updateGeneralProject`. Editable with `state.can('edit_project') && !state.readOnly`; read-only otherwise.
- Test: `navigation.test.ts`, `settings/GeneralSection.test.tsx`, a new `ProjectMark.test.tsx`
- [ ] **Step 1: Write failing tests.**
  - `generalTab(new URLSearchParams(''), 'plan')` → `'plan'`
  - `'a named tab wins over the default view'`: `generalTab('tab=tasks', 'plan')` → `'tasks'`
  - `ProjectMark` with both null renders the first letter.
  - The General panel saves `{ color: 'teal', icon: 'monitor', default_view: 'plan', visibility: 'workspace' }`.
  - A member sees the controls disabled.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `node scripts/contrast.mjs` after adding the tokens.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `node scripts/contrast.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**: "Show project color and icon, and open its default view".

### Task 4: Ask to join

**Files:**
- Create: `src/components/general/JoinRequestButton.tsx`, `src/components/general/settings/JoinRequestsPanel.tsx`
- Modify:
  - `src/pages/general/GeneralProject.tsx`: a non-member viewer of a Workspace project gets an info banner, "You're viewing this project as a member of its space.", with the button. Its states: "Ask to join", then "Request sent · Withdraw".
  - `src/components/general/settings/MembersSection.tsx`: the panel at the top for the PM and coordinators lists open requests with name, time, a role select (choices limited as in Task 1), Approve and Decline.
  - `src/components/general/settings/ProjectSettings.tsx`: the Members menu count also includes open join requests.
- Test: `JoinRequestButton.test.tsx`, `settings/JoinRequestsPanel.test.tsx`
- [ ] **Step 1: Write failing tests.**
  - The button calls `requestToJoin`, then shows "Request sent".
  - Withdraw calls `withdrawJoinRequest`.
  - The panel approves with the chosen role (`answerJoinRequest(id, true, 'qa')`).
  - A coordinator's role choices exclude coordinator.
  - Decline calls `answerJoinRequest(id, false)`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Toasts: "Request sent", "Request withdrawn", "{name} joined as {role}", "Request declined".
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Let space members ask to join a workspace project".

### Task 5: Danger zone

**Files:**
- Modify: `src/components/general/settings/GeneralSection.tsx`. The archive zone becomes "Danger zone" (PM only, `state.isOwner`), with:
  - Archive and Restore, as today.
  - "Transfer ownership", which opens the existing `HandOverDialog`.
  - "Delete project", shown only when archived. A confirm dialog asks the person to type the exact project name. It calls `deleteGeneralProject(p.id)`, then navigates to `paths.spaceProjects(p.space_id)` with the toast "Project deleted".
- Test: `settings/GeneralSection.test.tsx`
- [ ] **Step 1: Write failing tests.**
  - Delete is hidden on an active project.
  - On an archived project, the Delete button stays disabled until the typed name matches exactly. It then calls `deleteGeneralProject`.
  - Transfer ownership opens the hand-over dialog.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Confirm copy: "Delete {name}? This removes its tasks, files, sprints and milestones for good. Type the project name to confirm."
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Add transfer ownership and delete to the danger zone".

### Task 6: Docs, checks, owner review

**Files:**
- Modify:
  - `docs/07-backup.md`: add `supabase/project-settings-general.sql` after `supabase/work-task-handoff.sql` in both restore commands and the rerun tail, plus a short section on what it owns (columns, `can_read_general_project`, join requests).
  - `CLAUDE.md`: one bullet under Project roles.
  - `handoff.md`: a new section at the end.
- [ ] **Step 1: Run checks.**
  - `npm run build`, `npx vitest run`, `npx eslint` on changed files, `node scripts/contrast.mjs`.
  - SQL dry-runs: `project-settings-general` plus the suites named in Task 1.

  Expected: all green.
- [ ] **Step 2: Commit**: "Document project look, visibility and join requests".
- [ ] **Step 3: Stop for owner review.** Then:
  1. `node scripts/db.mjs supabase/project-settings-general.sql supabase/anon-lockdown.sql`
  2. Read-only check of the columns, the table and the enum values.
  3. Re-run the suites.
  4. Push `main`.
