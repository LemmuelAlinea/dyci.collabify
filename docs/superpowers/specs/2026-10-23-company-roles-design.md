# Company roles — design

Date: 2026-10-23. Status: draft for approval.

## Intent

Collabify's work spaces should feel like a real company's project tooling, not a
school's. The capstone adviser asked for company roles: project manager, project
coordinator, team lead, team member, stakeholder and QA specialist. Today an
account is only `student`, `faculty` or `admin`, and access inside work projects
is Owner / Manager / Member plus per-person grants.

This upgrade:

- removes **Faculty** as an account type, but none of its features;
- makes **teaching** depend only on the existing **Can teach** switch;
- adds **Project manager** as an account switch the admin sets;
- adds project roles that decide what each person can do inside a work project.

Classes, grading, reports and every other educational feature keep working. They
only change what they check, from "is faculty" to "can teach".

## Goals

1. Sign-up offers **Student** or **Member**. A new Member sees nothing but a
   waiting home until they are invited somewhere or made a project manager.
2. Admins set **Project manager** and **Can teach** per account. Nothing else
   about an account needs approving, so the faculty approval queue goes away.
3. Work projects use six roles with clear, enforced powers (enforced in the
   database, like today's levels, not only in the UI).
4. Stakeholders get a read-only view, a Feedback tab with statuses, and a slim
   sidebar.
5. QA gets a review gate on one task stage, plus Bug tasks.
6. Everyone can see what each role allows, and role changes are recorded.

## Non-goals

- No change to class spaces, classes, groups, grading or student records. The
  new roles apply to **work** spaces and their projects only.
- No new roles inside classes. Class groups keep their existing `leader_id`.
- No co-PMs. A project has exactly one PM.
- No billing, org charts, or HR-style titles beyond the six roles.

## Anti-goals (a failure even if it works)

- A teacher loses access to a class, a grade, a report or a syllabus because
  their account stopped being "faculty".
- Roles enforced only in the UI. A stakeholder must not be able to write through
  the API.
- A Member who signs up sees other people's spaces or projects before anyone
  invites them.
- Breaking `schema.sql` idempotency, or the `profiles_guard_privileged`
  invariant (only admins change role, status and the account switches).

## Accounts

### Account types

`profiles.role` becomes `student | member | admin`. `faculty` is migrated away
(see Migration). The enum value may stay in Postgres for safety, but nothing may
write it. The insert guard, `handle_new_user` and the admin RPCs must refuse it.

### Account switches (admin-only, guarded by `profiles_guard_privileged`)

| Switch | Who can have it | What it unlocks |
|---|---|---|
| `can_teach` (exists) | Members only | Everything faculty-teaching unlocks today: classes, class spaces, Teaching, Resources, the professor Home, direct messages with own students, section assignment. |
| `can_manage_projects` (new, shown as **Project manager**) | Members and admins | Creating work spaces and work projects, and being PM of a project. |

- Students can have neither switch.
- Admins still do not teach. An admin with `can_manage_projects` may create work
  spaces. Admins can already see everything through the admin pages.

### Sign-up

- `/register` shows **Student** or **Member**. Student keeps today's fields and
  behaviour. Member is a plain account.
- Both are `active` at once. `pending` and `rejected` stay in the status enum for
  existing rows and for deactivation, but sign-up no longer produces `pending`.
- Google sign-ups go to `/onboarding`, which offers the same two choices.
- A Member with no switches and no invitations sees a **Waiting for an invite**
  home. It says they need an invite from a project manager or a role from an
  admin. It shows Account and Inbox (so invitations show up), and nothing else.

### Admin

- **Accounts** page: each row shows the account type and two toggles, **Project
  manager** and **Can teach**, plus the existing Deactivate. **Make student / Make
  member** replaces Make faculty / Make student.
- Turning off Can teach while the person runs active classes is blocked, the
  same way demoting faculty with classes is blocked today.
- Turning off Project manager while the person is PM of active projects is
  blocked until those are handed over.
- **Professor approvals** is retired. Today's Faculty page becomes a filtered
  view: people with Can teach.
- Nobody can be made admin from the UI (unchanged).

### Everything that checks "faculty" today

About 45 frontend sites and about 22 live SQL sites check `role = 'faculty'`,
`is_faculty()` or `isFaculty()`. Each moves to one of two checks:

- **Teaching** checks become `can_teach`: `is_teaching_faculty`,
  `teaches_in_space`, class policies, meetings, notifications, nav teaching
  sections, `/teaching/*`, `RoleSwitch`, Calendar, search, archive, messages.
- **Work-space creation and invite** checks become `can_manage_projects`, or
  the project role (see below): `guard_general_creator`, space and project
  creation, inviting.

The builder lists every site and assigns it to one of the two, or to "admin",
before changing anything. The SQL helpers keep their names where callers are
many, but their bodies change: `is_faculty()` is retired; `is_teaching_faculty()`
becomes `can_teach and active and role = 'member'`.

**Co-teachers and advisers (decided).** Teaching anything needs Can teach,
including co-teaching or advising a class someone else owns.
- `teaches_in_space` becomes: an Owner or Manager seat in the class space, held
  by an active Member with Can teach. Today it checks `role = 'faculty'` and
  ignores Can teach.
- `search_faculty`, the co-teacher picker, returns only active Members with Can
  teach.
- Turning off Can teach is blocked while the person holds any teaching seat:
  classes they own and classes they co-teach or advise.
- The one active faculty account without Can teach loses co-teaching seats
  unless the admin turns Can teach on. The migration lists such seats so the
  admin can decide before phase 1 ships.
- *(My call:)* an admin seated in a class as a non-teaching Manager
  (`admin-invitable.sql`) stays as it is today.

## Work spaces

- Only people with **Project manager** (and admins with it) can create a work
  space. Class spaces are still created by people with Can teach.
- The creator is the space **Owner**. Other PM-enabled people can be invited to a
  space as co-owners. From now on, that is the only space-level invite.
- Everyone else joins a space **through a project**. Being given a role in a
  project adds them to its space as a plain member, if they aren't one already.
- **Space membership stays its own record (decided).** Losing a project role
  never removes anyone from a space. Existing plain members, including members
  on no project, stay. Space teams (`general_space_teams`, 2 live) stay as they
  are. Nothing in the migration deletes space membership.
- **Visibility changes.** A space member sees only the projects they have a role
  in. The space's Owners see every project in it, read-only unless they also
  hold a role in it. Today's "every space member can read every project"
  (`can_read_general_project`) is narrowed to this.
- **PM recovery (decided).** A space Owner who isn't on a project has one write
  action on it: assigning a new PM when the project has none. That happens when
  the PM is deactivated, or after an admin turns off their Project manager
  switch, which the admin can do only after the projects are handed over or
  have lost their PM. Admins can assign a PM for any project from the admin
  pages. A project with no PM shows a notice to its Coordinators and the
  space's Owners, and keeps working; Coordinators still do everything except
  the PM-only actions.
- Join codes still work for projects. They join as **Member**, and the PM can
  change the role afterwards. Students may use them. *(My call:)* space-level
  join codes stop admitting plain members. The 2 live codes are switched off,
  because entry is now through projects.
- **Excluded (my call):** the hidden Files projects behind class boards (rows
  with `class_board_id`, in the "Class project files" space) keep today's
  model entirely: grants, leader-based commits, no PM, no Feedback tab, and no
  visibility change. Every rule in this document applies only to work projects
  with `class_board_id is null`.

## Project roles

Each person in a work project has exactly one role. It replaces
`general_level`. **Team lead is not a role (decided).** It is a tag that comes
from leading a team, on top of whatever role the person has (see Teams).

| Role | Count | Today's equivalent |
|---|---|---|
| Project manager | exactly 1 (0 only while it is being recovered) | Owner |
| Coordinator | any | Manager |
| Member | any | Member |
| QA | any | — |
| Stakeholder | any | space watcher, but narrowed |

**Who sets roles (my call).**
- The PM sets any role and hands over PM.
- Coordinators can add and remove people, and switch people among Member, QA
  and Stakeholder.
- Only the PM can make someone a Coordinator, or remove or demote a
  Coordinator. This stops two Coordinators from removing each other.

- Students can hold any role except PM.
- The PM can be any account with **Project manager**.
- **Hand over:** the PM can transfer the PM role to another PM-enabled person
  already in the project or invited with it. The old PM becomes Coordinator.

### What each role can do

✓ = yes. "Team" = only for tasks of people on their team. "Grant" = not by
default, but the PM can grant it with today's grants. The Team lead column is
what the lead tag adds on top of the person's own role. A Member who leads a
team gets the Member column plus the Team lead column.

| Action | PM | Coord. | Team lead | Member | QA | Stakeholder |
|---|---|---|---|---|---|---|
| See project, tasks, sprints, milestones, files, meetings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (read-only) |
| Edit project details, stages, archive, delete | ✓ | | | | | |
| Mark the QA stage | ✓ | | | | | |
| Invite / remove people, set roles (not PM) | ✓ | ✓ | | | | |
| Hand over PM | ✓ | | | | | |
| Create and manage teams, pick leaders | ✓ | ✓ | | | | |
| Create, assign, edit any task | ✓ | ✓ | Team | Grant | | |
| Create tasks, edit own (today's member rules) | ✓ | ✓ | ✓ | ✓ | Bug tasks only | |
| Sprints and milestones | ✓ | ✓ | | Grant | | |
| Move a task out of the QA stage | ✓ | | | | ✓ (when the project has QA) | |
| Files tab: folders, move, rename, delete any | ✓ | ✓ | | Grant | | |
| Commit to main | ✓ | ✓ | Grant | Grant | | |
| Own drafts, submit changes for review | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Schedule and edit project meetings | ✓ | ✓ | own | own | own | |
| Task comments, discussion, project chat | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Post in Feedback | ✓ | ✓ | | | | ✓ |
| Change Feedback status | ✓ | ✓ | | | | |
| Read Feedback | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Grants and access requests | gives | gives | can get | can get | | |

Notes:

- **Grants** stay as extras on top of a role, for Members and Team leads only.
  QA and Stakeholders can neither be granted nor request access.
- Today's six permissions (`edit_project`, `manage_members`, `manage_structure`,
  `manage_tasks`, `edit_files`, `commit_main`) remain the unit of enforcement.
  Each role maps to a default set, and grants add to that set. `permissions.ts`
  and the SQL `has_general_permission`-style helpers derive from role plus
  grants.
- PM and Coordinator differ only in the PM-only rows: project details and stages,
  archive and delete, the QA stage, and hand over.

### Teams

- Project teams (`general_teams`) get an optional `leader_id`. It is picked when
  a team is created, and can be changed by the PM or a Coordinator.
- A leader must be on that team and must not be a Stakeholder. Their role does
  not change. A Coordinator who leads a team stays a Coordinator, and a QA who
  leads stays QA.
- Leading a team adds the **Lead** badge, plus the right to assign, edit and
  reorder tasks held by people on their team, and a team filter on the Tasks
  and Backlog views. It gives no power over other teams' tasks, files or
  people.
- If a leader is removed from the team or the project, or becomes a
  Stakeholder, the team simply has no leader until one is picked.

### QA

- In the stage editor, the PM marks one **middle** stage as the QA stage.
  Default: a stage named "Testing" if there is one, otherwise the stage just
  before the last.
- **When the project has at least one QA person:** only QA (and the PM) can move
  a task out of the QA stage forward to the last stage. Anyone who can move the
  task may still move it back.
  - As built (controller ruling, phase 4 final review): the gate blocks
    *crossing* the QA stage. Nobody but the PM, or QA from the QA stage itself,
    moves a task from the QA stage or before it to a stage after it, or adds a
    task after it. Moves among the stages after QA (Revision to Completed) stay
    free under the holder rules.
- **Pass** moves the task to the last stage (Done). **Send back** moves it to
  the stage before QA and requires a note, which is posted as a task comment
  and notifies the holders.
- **QA queue:** a view of tasks in the QA stage, oldest first, reached from the
  project's Work tab. QA's Home shows a count across their projects.
- **Bug tasks:** tasks get a `kind` (`task | bug`). QA can create Bug tasks but
  not edit others' tasks. Bugs show a badge and can be filtered.
- Without a QA person, the QA stage is an ordinary stage.

### Stakeholders

- **Read-only.** They can open everything a member can read (Overview, Work
  views, milestones and the timeline, Files, meetings they are invited to), with
  every edit control hidden and every write refused by the database. They are
  **not** in the project chat or the discussion.
- **Feedback tab** (new, on every work project; everyone in the project can
  read it):
  - A post has a type (**Input**, **Concern**, **Approval request**), a title, a
    body, optional attachments, replies, and a status: **Open → Acknowledged →
    Resolved**.
  - Stakeholders, the PM and Coordinators can post and reply. Only the PM and
    Coordinators change the status.
  - A new post notifies the PM and Coordinators in the bell. A reply or status
    change notifies the post's author.
- **Slim sidebar:** when every project role a person holds is Stakeholder, and
  they have no classes, no Can teach and no Project manager switch *(my call)*,
  the sidebar is Home, Projects, Inbox, Calendar and Account. A teacher or
  student who is also a stakeholder somewhere keeps their normal sidebar. Their Home lists their
  projects, with progress, the next milestone and open feedback counts. If they
  hold any other role anywhere, they get the normal sidebar.

## Seeing roles

- **Role badges:** PM, Coordinator, Lead, QA and Stakeholder badges next to names
  in project members, task holders, comments, Feedback and project chat. Member
  shows no badge.
- **Who can do what:** the permissions table above, in plain words, shown in
  each project's Members tab.
- **Activity log:** every account-switch change (Project manager, Can teach,
  account type) and every project-role change (including hand over and team
  leader changes) is recorded with who did it and when. Account-switch changes
  appear in the admin's view; project-role changes appear in the project's
  activity.

## Migration

Run once and idempotent, like everything in `supabase/`.

- `faculty` with Can teach (4 accounts) → `member`, `can_teach` stays true.
- `faculty` without Can teach, active (1) → `member`.
- `faculty`, rejected (1) → `member`, status stays `rejected`.
- `can_manage_projects` → true for every former faculty account that owns or
  manages a work space or work project today, so nobody loses the projects they
  run. False for the rest. The admin can change it afterwards.
- Project levels: `owner` → **PM**. If a project has several owners, the creator
  stays PM and the others become Coordinators. `manager` → **Coordinator**.
  `member` → **Member**.
- Space members who were reading projects they are not on lose that access,
  except space Owners, who keep read access.
- No space membership, space team or space team member is deleted.
- Existing grants are kept.
- Class-board Files projects (`class_board_id` set) are not touched.

## Rollout

Four phases. Each ships to `main` and goes live on its own. Each phase leaves
the app fully working.

1. **Accounts.** Member account type, sign-up, Project manager switch, the
   faculty → Can teach / Project manager rewrite of every check, the Accounts
   page, retiring approvals, the waiting home, and the migration of accounts.
2. **Project roles.** Role column and migration of levels, the permissions
   rework, visibility narrowing, entering spaces through projects, hand over,
   team leaders, role badges, the "Who can do what" table, and the activity log
   for roles.
3. **Stakeholders.** Read-only enforcement, the Feedback tab and its
   notifications, the slim sidebar and the stakeholder Home.
4. **QA.** QA stage marking, the gate, Pass and Send back, the QA queue, and Bug
   tasks.

## Left to the builder

- Table, column, function and enum names, and whether the role is a new enum
  or a widened `general_level`.
- How the six permissions map from role plus grants, as long as the table above
  holds.
- Feedback storage: new tables, or reuse of discussion tables with a kind.
- Exact copy, following the repo copy rules (sentence case, no "please", no
  "successfully", errors say what to do next).
- Layout of the Feedback tab, QA queue and stakeholder Home, within the design
  system and desktop → tablet → phone order.
- Tests: SQL tests for each role's write refusals, Vitest for the permission
  mapping and nav.
