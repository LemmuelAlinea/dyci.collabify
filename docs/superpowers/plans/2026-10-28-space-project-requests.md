# Space Project Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Space member discuss a private project request with Space managers and let an authorized PM create a project from its agreed brief.

**Architecture:** Add request and message tables with server-enforced participants. A conversion RPC calls the existing project-creation function in the same transaction and links the result to the request. The Space Projects page gains Requests; the existing New project dialog takes optional request defaults.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres RLS and RPC, Vitest, SQL rollback suites.

**Spec:** `docs/superpowers/specs/2026-10-28-work-project-handoff-design.md`

## Global Constraints

- Apply only to work Spaces and work projects; class projects do not change.
- A Space is a reusable roster; project roles, leads, positions and skill tags stay project-specific.
- Request discussion is readable only by its author and Space Owners/Managers, before and after conversion. Other project members see the agreed brief in the project.
- Use existing design tokens and sentence-case copy from `CLAUDE.md`; design desktop, tablet and phone layouts.
- SQL stays idempotent. Register new SQL in `scripts/schema-drift.mjs` and `docs/07-backup.md`; re-run `supabase/anon-lockdown.sql` last after function changes.
- Never stage `.env.local`, `supabase/.temp/`, `.superpowers/`, or `graphify-out/`. Stage named files only; commit and push each verified task.

## Review Focus

- A request author removed from the Space loses access to the request and its messages (Task 1).
- A Space member in a different Space cannot read or comment (Task 1), or convert the request (Task 2).
- A stale author edit cannot change a brief after a manager marks it ready (Task 1).
- Two conversions of the same request produce exactly one project (Task 2).
- A failed project creation leaves the request ready and unlinked (Task 2).

## File Map

- `supabase/project-requests.sql`: request tables, reader rule, write RPCs and atomic conversion; final owner of these new objects.
- `supabase/tests/project-requests.test.sql`: permission, transition, conversion and rollback cases.
- `src/lib/api/projectRequests.ts`: typed request and message API; no new dependency.
- `src/components/general/SpaceProjectRequests.tsx`: request list, private discussion and conversion entry.
- `src/pages/general/SpaceProjects.tsx`: Projects/Requests switch inside the existing Space Projects tab.
- `src/components/general/NewProjectDialog.tsx`: optional request source, prefilled values and conversion call; existing blank creation remains.
- `src/components/general/OverviewTab.tsx`: link to the source request for authorized readers only.
- `scripts/schema-drift.mjs`, `docs/07-backup.md`: SQL order and ownership notes.

---

### Task 1: Private requests and discussion

**Files:** Create `supabase/project-requests.sql`, `supabase/tests/project-requests.test.sql`; modify `scripts/schema-drift.mjs`, `docs/07-backup.md`.

**Interfaces:**
- Produces `general_project_requests(id, space_id, author_id, title, brief, desired_outcome, target_date, status, converted_project_id, created_at, updated_at)`; status is `open | ready | converted | closed`.
- Produces `general_project_request_messages(id, request_id, author_id, body, created_at)`.
- Produces `general_project_request_reader(p_request uuid) returns boolean`, `create_general_project_request(p_space uuid, p_title text, p_brief text, p_outcome text, p_target_date date) returns uuid`, `edit_general_project_request(p_request uuid, p_title text, p_brief text, p_outcome text, p_target_date date) returns void`, `post_general_project_request_message(p_request uuid, p_body text) returns uuid`, `set_general_project_request_status(p_request uuid, p_status text) returns void`.
- Only active work-Space members create. The author edits while open. Author and Space Owners/Managers read and comment. Owner/Manager with `can_manage_projects` marks ready or closed. No direct client write privilege on the tables.

- [ ] **Step 1: Write the failing SQL suite.** Use the existing `pg_temp.act_as`, `must_allow`, `must_refuse_with` and `must_be` pattern. Assert Task 1's Review Focus cases; author/manager read and comment; ordinary Space member and outsider cannot; education Space refuses; only PM-enabled manager changes status; converted requests cannot be edited or commented on.
- [ ] **Step 2: Run `node scripts/db.mjs supabase/tests/project-requests.test.sql`.** Expected: FAIL because the tables/functions do not exist.
- [ ] **Step 3: Implement the schema and RPCs.** Put the file after `sprint-archive.sql` in `scripts/schema-drift.mjs` and before the final `anon-lockdown.sql` in the restore line. Use one reader predicate for both table policies; lock the request row in status/edit RPCs. Cap title at 200 characters, brief at 20,000, outcome at 2,000 and message at 5,000; return validation errors with actionable copy.
- [ ] **Step 4: Apply and verify.** Run `node scripts/db.mjs supabase/project-requests.sql`, `node scripts/db.mjs supabase/anon-lockdown.sql`, then the new suite and `supabase/tests/anon-lockdown.test.sql`; expected: all PASS and no FAIL/ERROR. Run the SQL file a second time to prove idempotence.
- [ ] **Step 5: Commit.** Stage only the four named files; commit `Add private Space project requests` with the agent trailer and push `main`.

### Task 2: One-time conversion to a project

**Files:** Modify `supabase/project-requests.sql`, `supabase/tests/project-requests.test.sql`.

**Interfaces:**
- Produces `create_general_project_from_request(p_request uuid, p_preset text default null, p_content jsonb default null, p_space_team uuid default null) returns uuid`.
- Calls the current eight-argument `create_general_project` (final owner: `general-space-teams.sql`) with request title/brief, null start, target date as end, and the request's Space. Sets `converted_project_id` and `status = 'converted'` in that same transaction. The request and project remain linked only for readers of the request.
- A PM-enabled Space Owner/Manager may convert only a ready request. Existing project creation, preset and team-seeding guards still apply.

- [ ] **Step 1: Extend the SQL suite with conversion cases.** Assert copied title, brief, end date and Space; preset/team arguments still work; an ordinary member cannot convert; closed/open requests refuse; a second conversion refuses and leaves one project; a deliberately failing project create leaves the request ready with `converted_project_id is null`.
- [ ] **Step 2: Run the suite.** Expected: FAIL on missing conversion function.
- [ ] **Step 3: Add the conversion RPC.** Lock the request `FOR UPDATE`, call the existing project RPC, update the request before returning the project id. Do not redefine `create_general_project`; keep its current permission and preset behavior.
- [ ] **Step 4: Apply and verify.** Re-run `project-requests.sql`, `anon-lockdown.sql`, the request suite and the anon-lockdown suite; expected: PASS. Re-run `project-requests.sql` to confirm idempotence.
- [ ] **Step 5: Commit.** Stage the two named files; commit `Create projects from approved Space requests` with trailer and push.

### Task 3: Request list, discussion and project creation UI

**Files:** Create `src/lib/api/projectRequests.ts`, `src/components/general/SpaceProjectRequests.tsx`, `src/components/general/SpaceProjectRequests.test.tsx`; modify `src/pages/general/SpaceProjects.tsx`, `src/components/general/NewProjectDialog.tsx`.

**Interfaces:**
- API exports `ProjectRequest` (the Task 1 columns), `ProjectRequestMessage` (the Task 1 message columns), `listProjectRequests(spaceId: string): Promise<ProjectRequest[]>`, `listProjectRequestMessages(requestId: string): Promise<ProjectRequestMessage[]>`, `createProjectRequest(input: { spaceId: string; title: string; brief: string; outcome: string; targetDate: string | null }): Promise<string>`, `editProjectRequest(input: { id: string; title: string; brief: string; outcome: string; targetDate: string | null }): Promise<void>`, `postProjectRequestMessage(requestId: string, body: string): Promise<string>`, `setProjectRequestStatus(requestId: string, status: 'ready' | 'closed'): Promise<void>`, `createProjectFromRequest(requestId: string, options: { preset?: string | null; content?: PresetPayload | null; spaceTeamId?: string | null }): Promise<string>`.
- `SpaceProjectRequests` accepts `{ spaceId: string; onCreateProject: (request: ProjectRequest) => void }`. `NewProjectDialog` adds `request?: ProjectRequest | null`; when set, it prefills the form and uses `createProjectFromRequest` on submit.

- [ ] **Step 1: Write the failing UI test.** In `SpaceProjectRequests.test.tsx`, assert a member can open their request thread and add a message; a manager can mark it ready and open New project with the request's fields; Requests remain reachable when the Space has no projects; creating from a request navigates to the new project. Mock only the API boundary; SQL tests own privacy.
- [ ] **Step 2: Run `npx vitest run src/components/general/SpaceProjectRequests.test.tsx`.** Expected: FAIL because the component/API are absent.
- [ ] **Step 3: Implement the API and UI.** Add Projects/Requests within `SpaceProjects` without a new route. Reuse `NewProjectDialog` and existing Space team selection; do not duplicate project creation logic. Show request status, author, target date and discussion; do not show unauthorized request details in the list. Keep blank New project unchanged.
- [ ] **Step 4: Verify.** Run the targeted test, `npx eslint` on changed TS/TSX files, and `npm run build`; expected: all exit 0. Browser-check request creation, discussion, ready state, conversion and blank project creation at desktop and phone widths.
- [ ] **Step 5: Commit.** Stage only the named app/test files; commit `Add Space project request flow` with trailer and push.

### Task 4: Source link and final read check

**Files:** Modify `src/components/general/OverviewTab.tsx`, `src/lib/api/projectRequests.ts`, `supabase/tests/project-requests.test.sql`; create `src/components/general/OverviewTab.test.tsx`.

**Interfaces:**
- API exports `requestForProject(projectId: string): Promise<ProjectRequest | null>`, filtered by the request's RLS. `OverviewTab` shows **Source request** only when the API returns a request, linking to the Space Projects Requests view with that request selected.

- [ ] **Step 1: Write a failing test.** Authorized PM/requester sees the source link; an ordinary project member sees none; the link selects the correct request. The SQL suite asserts a project member outside the request audience cannot read its source or messages after conversion.
- [ ] **Step 2: Run the targeted Vitest and SQL suite.** Expected: FAIL on the missing lookup/link.
- [ ] **Step 3: Add the lookup and link.** Use `paths.spaceProjects(spaceId)` with a `request` query parameter; the Requests panel opens that id only if its list contains it. Do not put the private discussion in `general_project_overview`.
- [ ] **Step 4: Verify.** Run targeted Vitest, request and anon-lockdown SQL suites, `npm run build`, and browser-check authorized/unauthorized views. Run `python -m graphify update .` after code edits.
- [ ] **Step 5: Commit.** Stage named files only; commit `Link projects to their source requests` with trailer and push.

## Plan Exit

- [ ] Run `npx vitest run`, `npm run build`, and `Get-ChildItem supabase/tests -Filter *.test.sql | ForEach-Object { node scripts/db.mjs $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }` after the final SQL owner is applied; confirm no failures.
- [ ] Browser-check as a requester, Space PM and ordinary project member; blank project creation still works.
- [ ] Append the shipped request flow and its SQL re-run order to `handoff.md`; commit and push that named file.
- [ ] Begin `2026-10-28-work-project-task-handoff.md` only after this plan is verified.
