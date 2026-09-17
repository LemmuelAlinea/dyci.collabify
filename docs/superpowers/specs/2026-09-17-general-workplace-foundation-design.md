# General workplace — piece 1: two workplaces and the General workplace core

Status: design approved by the owner on 2026-09-17.

## Context

Collabify was built for BSIT class projects only. The owner's professor wants it usable across all of Dr. Yanga's Colleges, from preschool to college. It should cover classroom projects, faculty-only projects and the school's own projects, with GitHub-like collaboration on the work itself.

That is five pieces, built in this order, each with its own design, plan and build:

1. **Two workplaces.** Everything running today becomes the Education workplace, and registration picks a workplace. *(this plan)*
2. **General workplace core.** Editable projects, teams, custom positions, access levels, invitations and tasks. *(this plan; piece 1 alone ships an empty workplace, so they go together)*
3. **Project presets.** Templates drawn from DYCI and Philippine school practice. *(next)*
4. **Shared documents.** A built-in word processor with versions, reviewing and committing changes, and download.
5. **Code repository.** Files, commits, changes, reviews and history. Pushing from a local machine needs a real Git server, which Supabase cannot host. That decision belongs to piece 5's own design.

Research gathered for piece 3:
- DYCI runs preschool, elementary, junior and senior high, and college programs in Nursing, Accountancy, Commerce, Computer Science, Education, Tourism, HRM and Maritime, plus TESDA courses.
- Known DYCI projects include the Robotics Team's competition work, such as ALAB, gold at the World Robot Olympiad, and a FIRST LEGO League innovation project.
- They also include Project PAPEL, an app built by junior and senior high students, and an action research study on greening the campus.

## Decisions locked with the owner

| Topic | Decision |
|---|---|
| Accounts | One account for both workplaces. Registration picks where you land, and a top-bar switcher opens the other |
| Sign-up for General | Anyone, active immediately. A new account sees nothing until it is invited |
| Who is who | No school-wide positions. Each project's Owner or Managers create and name positions. Privacy comes from invitation |
| Joining | Invite existing accounts found by name or email, who accept or decline. A join code can also be turned on |
| Structure | A project has members and optional teams. A person can be on several teams |
| Access | Access levels Owner, Manager and Member, plus per-person extra permissions. Members can request a permission, and an Owner approves or declines |
| Fields | Core fields are name, description, start, end and status. Anyone with the permission adds typed fields |
| Tasks | Same features as Education. The 100-point share is an optional project setting |
| Architecture | Separate General tables. Only accounts, notifications, messages and storage are shared. No Education rule changes |

## Design

### 1. Accounts and workplaces
- **Registration asks for a workplace first.** Education continues to today's student or professor choice, and professors are still approved. General is active immediately with no role.
- **`profiles.home_workplace`** (`education` | `general`) decides where sign-in lands. Every existing account gets `education`.
- **`profiles.role` becomes nullable.** Null means the account has not entered Education yet. Opening Education asks for student or professor once, through a new `enter_education(p_role)` function. `profiles_guard_privileged` still blocks any other change.
- **`status` stays Education's approval state.** Education routes require an active role. General routes require only a session and a profile, so a pending professor can still use General.
  - The plan must confirm the Accounts page never uses `rejected` to block a whole account.
- **Web addresses.** Education keeps all current addresses. General lives under `/general/*`.
- **Shared screens.** Notifications, messages and settings are shared, and each item shows its workplace.
- **Administrators** see only counts for General, never project content.

### 2. Projects, teams, positions, invitations
- **Creating projects.** Anyone in General can create a project and becomes its Owner. A project with one member is an individual project.
- **Teams** are optional, named, and can have many members. A task belongs to the whole project or to one team.
- **Positions** are free-form names covering the whole project or one team. Owners and Managers can rename, remove and assign them. Holding is many-to-many.
- **Invitations.** Owners and Managers search accounts and invite them. The invited person is notified and accepts or declines. Pending invitations are listed and can be withdrawn.
- **Join code.** When turned on, a code joins you as a Member. It can be turned off or replaced, and entering it is rate-limited through the existing `rate_limit()`.
- **Ownership.** A project can have several Owners. The last Owner cannot leave without handing ownership over.
- **Archiving.** Owners archive and restore projects. Nothing is permanently deleted.

### 3. Access levels, permissions, requests
- **Permissions in this piece:** `edit_project`, `manage_members`, `manage_structure` for teams and positions, `manage_tasks`, and `edit_files`.
- **Level defaults.**
  - Owner has everything, plus changing levels, answering requests, archiving and handing over ownership.
  - Manager has all five permissions.
  - Member views everything, comments, creates, claims and works on tasks, and attaches files to tasks they hold.
- **Extra permissions.** An Owner can give one member any permission beyond their level and take it back later. Removing something a level already includes means changing the level.
- **Access requests.**
  - A member requests one permission with an optional reason, from a "Request access" button where they are blocked.
  - Every Owner is notified. Any Owner approves or declines with an optional note, and the requester is told the answer.
  - A member can have one open request per permission.
- **Enforced in the database** through one `general_can(project, permission)` helper used by row-level security and every write function.

### 4. Fields and tasks
- **Core fields.** Every project has a name, description, `starts_on`, `ends_on` and a status of Planning, In progress, On hold, Done or Cancelled.
- **Added fields.**
  - Types are short text, long text, number, money in pesos, date, single choice, multiple choice, yes or no, project member, and link.
  - Fields can be renamed, reordered and removed. Removing one with values asks for confirmation.
  - A field's type is fixed once it holds values.
- **Tasks.**
  - Title, description, due date, stages To do, In progress and Done, one or more assignees, an optional team, comments, attachments, a time log and change history.
  - Members claim unheld tasks. Anyone with `manage_tasks` reassigns at any time.
  - With points on, the project is worth 100 and tasks share it. With points off, progress is the count of finished tasks.
  - Board and list views, filterable by team, assignee and status.
- **Messages.** Each project gets one conversation for its members.
- **Notifications.** Invitations, access requests and their answers, task assignments, comments on your tasks, and a reminder the day before a task is due. Gated by the existing notification settings, except invitations and request answers, which a person must act on.
- **Out of scope:** presets, documents, code, and General calendar, reports and analytics.

## Implementation outline

The detailed step list comes from the writing-plans pass after approval.

### Database — new files, appended to `ORDER` in `scripts/schema-drift.mjs` and to `docs/07-backup.md` in step
- **`supabase/workplaces.sql`**
  - `workplace` enum, `profiles.home_workplace`, and `role` made nullable.
  - Redefine `handle_new_user`, whose last definition is in `supabase/consent.sql:210`, so `workplace = 'general'` creates a profile with no role.
  - Add `enter_education(p_role)`.
- **`supabase/general.sql`**
  - Tables: `general_projects`, `general_members` (with `level`), `general_teams`, `general_team_members`, `general_positions`, `general_position_holders`, `general_grants`, `general_access_requests`, `general_invitations`, `general_fields`, `general_field_values`, `general_tasks`, `general_task_assignees`, `general_task_comments`, `general_task_files`, `general_task_logs`, `general_task_events`.
  - Helpers: `is_general_member` and `general_can`, `security definer`.
  - Writes that need more than one row change go through RPCs, following the shape of `privacy_requests` and `task_reassignments`.
- **`supabase/general-notify.sql`** adds the new `notification_type` values in their own transaction, as `supabase/reassignments.sql:24-34` does.
- **Conversations** gain `kind = 'project'` with `general_project_id`, extending the shape check at `supabase/messages.sql:25`. A trigger creates one conversation per project.
- **Storage** paths use `general/<project-id>/…`, with policies through `is_general_member`.

### Client
- **Accounts.**
  - `src/lib/types.ts` gets a nullable `Role` on the profile plus a `Workplace` type.
  - `src/lib/roleHome.ts` becomes workplace-aware.
  - `src/routes/ProtectedRoute.tsx` gains `workplace="education" | "general"`.
- **Registration.** A workplace step is added to `src/pages/auth/Register.tsx`, and `src/pages/auth/Onboarding.tsx` asks the same for Google sign-ins.
- **Shell.** A workplace switcher goes in `src/components/app/TopNav.tsx`, and General's rail goes in `src/components/app/nav.ts`.
- **Pages** in `src/pages/general/`:
  - Home, with my projects, invitations and my open requests
  - New project
  - Project, with Overview (core and added fields), Tasks (board and list) and Members (levels, extra permissions, teams, positions, invitations, join code, requests)
- **Reuse, don't rebuild:** `DirectoryHero`, `FilterPopover`, `Modal`, `ConfirmDialog`, `EmptyState`, `useLive`, `authErrorMessage`, and `useToast`. Task board and task detail components get a data adapter where their shape allows.
- **Pure logic** goes in `src/lib/general/`, with vitest tests:
  - `permissions.ts`, which combines level defaults and grants into what a person can do
  - `fields.ts`, which validates each field type's values
  - `progress.ts`, which computes progress with points on and off

## Verification

- `npm run check` stays green, with lint holding at 23 warnings and 0 errors.
- `node scripts/schema-drift.mjs` reports `handle_new_user` with its last definition in `workplaces.sql`.
- `supabase/tests/general.test.sql` uses the rollback harness from `supabase/tests/reassignments.test.sql`, pairing every refusal with a succeeding control:
  - A non-member cannot read a project.
  - A Member cannot invite, while a Manager can.
  - An extra permission lets a Member edit files, and revoking it stops them.
  - A second request for the same permission is refused while the first is open.
  - The last Owner cannot leave.
  - A join code works when on and fails when off.
  - A field's type cannot change once it holds values.
  - Points-off progress counts finished tasks.
- `supabase/tests/workplaces.test.sql`:
  - A General sign-up gets no role and is active.
  - `enter_education('professor')` sets pending.
  - A user cannot set their own role any other way.
- **Browser, per role:**
  - Register for General and land on General home. Create a project, add a field, a team and a position. Invite a second account, which accepts.
  - The second account requests `edit_files`, the Owner approves, and file editing unlocks.
  - Switch to Education and pick professor, landing on pending while General still works.
  - Existing student and professor accounts still land in Education, unchanged.
  - Check both themes at 375px and 1440px.
