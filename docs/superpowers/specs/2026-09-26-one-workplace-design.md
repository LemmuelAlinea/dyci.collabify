# One workplace — design

Status: approved in brainstorming, 2026-09-26. Phase 1 (Access) is planned first.


## Context

Collabify runs two separate worlds. Education (classes → group sets → groups →
projects → tasks, plus syllabus weeks, submissions, reassignments, grading, all
keyed to `class_id`) and General (`general_spaces` → `general_projects` →
`general_tasks`, with levels, positions and grants). Separate rails, homes and
URLs, and a switcher between them.

The owner wants one workplace in which a **space** is either an education space
(today's class) or a work space (today's General space). They also want access
closed down so a school like DYCI can run it: nobody can do anything until
someone admits them. The admin admits faculty, and faculty admit students
through class codes and invite links.

Live data is small (24 accounts: 21 students and 2 professors; 3 classes;
6 spaces; 2 General projects; 6 Education projects), so moving the data is
cheap. The cost is in the logic.

## Decisions (agreed in brainstorming)

- **Approach A: one space, two engines.** Every class becomes a space with
  `kind = 'education'`, linked 1:1 to its `classes` row. Membership is unified
  on the space. The education engine keeps its tables and features.
- **Students** can be in a work space only when a faculty member invites them.
  They can never create a space, and never join a work space or a work-space
  project by code.
- **Faculty** replaces professor and also covers office staff. The admin
  admits faculty and sets **Can teach** per person. Only teaching faculty can
  create education spaces. Any admitted faculty can create work spaces.
- **Education-space roles:** faculty hold owner or manager (co-teachers and
  advisers). Students are always members and can hold free-text positions.
- **Number of students** is an optional join cap.

## Section 1: Access model

- Registration offers Student or Faculty. The workplace choice goes away.
- The product calls the role **Faculty** from phase 1. The enum value stays
  `professor` until phase 4, where it is renamed once the code that spells it
  (84 frontend and 21 SQL sites, most of them rewritten by phase 3) has
  settled. A new admin-only `profiles.can_teach
  boolean not null default false` column is protected by
  `guard_privileged_columns`, alongside role and status.
- Student: active at sign-up, but with no space membership home shows only
  "Join a class" (code or invite link), and the rail shows Home and Settings.
- Faculty: `pending` at sign-up, lands on `/pending`. The admin approves with a
  Can teach checkbox (`decide_professor` becomes `decide_faculty(p_user,
  p_approve, p_can_teach)`). Can teach can be toggled later on the Faculty
  approvals page, which lists every faculty account and its standing.
- SQL gates, in the security-definer functions and not only in the UI:
  - `create_general_space` / `create_education_space` refuse students and
    non-active faculty. The education variant also refuses when `can_teach` is
    false.
  - `join_general_space` refuses students when the space is a work space.
    `join_general_project` refuses students when the project's space is a work
    space.
  - `invite_to_general_space` lets a student invitee through only when the
    inviter is faculty.
  - `create_general_project` inside a space keeps requiring manage rights, and
    students can never hold manage in any space.
- `enter_education` is dropped. It is the one path that lets a role-less
  account choose a role itself.
- Existing accounts: both professors become faculty with `can_teach = true`.
  Students are unchanged.

## Section 2: One workplace

- Routes lose their prefixes: `/home`, `/spaces`, `/spaces/:id/…`,
  `/projects`, `/tasks`, `/calendar`, `/messages`, `/settings`, `/admin/…`.
  Old `/student/*`, `/professor/*` and `/general/*` paths redirect. The
  workplace switcher is removed.
- One rail (`nav.ts` + `SideNav.tsx`, following the MAIN / YOUR SPACES / YOUR
  PROJECTS structure shipped in `aaf9320`):
  ```
  MAIN            Home · My tasks · Calendar · Messages
  YOUR SPACES     live list; education badge amber, work badge navy · All spaces
  YOUR PROJECTS   live list · All projects
  TEACHING        Submissions · Reassignments · Syllabi & curriculum  (can_teach)
  ADMIN           existing admin groups                                (admin)
  ACCOUNT         Settings
  ```
  An unadmitted student sees Home and Settings only.
- Home is one cross-space dashboard. It merges `GeneralHome` with the student
  and professor dashboards, and adds the submissions-waiting count for teaching
  faculty.
- Space tabs by kind:
  - Education: Overview (announcements, week tracker), Projects, Groups,
    Members, Syllabus, and for faculty Submissions, Analytics, Reports and
    Settings.
  - Work: the current `SpaceHome` set (Overview, Projects, Teams, Members,
    Reports, Archive).
- Class-scoped pages (groups, class projects, analytics, student reports)
  become tabs inside the space. Cross-class queues (Submissions,
  Reassignments) stay in the rail under Teaching.

## Section 3: Education spaces

- The New space dialog asks for the kind first. Education is shown only when
  `can_teach` is on.
- The education form is pre-filled with today's class fields, all editable
  later in Settings: name and initials, section (from `program_sections`), year
  level, semester, academic year (defaults to the current one, e.g.
  `2026-2027`), description, syllabus and curriculum (from
  `teaching_resources`), optional student cap, an auto-generated regenerable
  code, and an invite link `/join/<code>` that survives sign-up and sign-in.
- `create_education_space(...)` inserts `general_spaces(kind='education')`,
  `classes(space_id)` and the owner membership in one transaction.
- Membership: `general_space_members` is the source of truth for who is in.
  `class_members` stays as the student roster, because its removal and restore
  history is used by `recover-work.sql` and `removed-visible.sql`. It is
  written only by the join and remove functions, in the same transaction as
  the space row. `join_class` enforces the cap.
- `is_class_professor(class)` (`classes.sql:138`) is redefined as "faculty at
  owner or manager level in the class's space", so co-teachers get the full
  teaching tools. Other `professor_id` checks go through that helper.
- Everything else in the engine is unchanged: week tracking, the project wizard
  and its suggestions, group sets, tasks and claiming, reassignments,
  submissions and grading, announcements, analytics, reports.

## Section 4: Migration, phases, testing

**Migration.** New file `supabase/one-workplace.sql`, idempotent. Take a backup
per `docs/07-backup.md` first. It renames the enum value, adds `can_teach`,
`general_spaces.kind`, `classes.space_id` (unique FK) and `classes.student_cap`,
and backfills one space per class (professor as owner, active class members as
members). It drops `enter_education`. It leaves `home_workplace` unread until
phase 4. Register it in the `scripts/schema-drift.mjs` ORDER and the restore
line in `docs/07-backup.md`.

**Phases.** Each has its own implementation plan, and each ships leaving the
site working:
1. **Faculty wording (enum rename in phase 4).** `can_teach`, SQL gates,
   Student/Faculty registration, the approval checkbox, the empty home for
   unadmitted students.
2. **Education spaces underneath.** `kind`, `space_id`,
   `create_education_space`, dual-write join and remove, co-teacher levels,
   backfill, the `is_class_professor` redefinition, the `/join/<code>` invite
   link. The old UI still works.
3. **One workplace UI.** Routes, the one rail, the merged home, space tabs
   hosting the education pages, redirects.
4. **Cleanup.** Remove the switcher, `src/lib/workplace.ts`, `home_workplace`,
   dead routes and docs. Update the landing and auth copy to say faculty.
   Rename the `professor` enum value to `faculty`.

**Testing.**
- A new SQL suite in `supabase/tests/` (NOTICE PASS/FAIL inside `begin …
  rollback`) covering every gate: a student cannot create a space; pending
  faculty cannot; non-teaching faculty cannot create an education space; a
  student cannot join a work space or work-space project by code; a faculty
  invite to a student works and a student invite to a student is refused; a
  join over the cap is refused; a co-teacher passes `is_class_professor`.
- All 38 existing SQL suites and `npx vitest run` (443 today) pass after every
  phase. `npm run build` passes.
- Browser walk with five accounts: unadmitted student, admitted student,
  teaching faculty, non-teaching faculty, admin.

## Next steps after approval

1. Write this design to
   `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, self-review it,
   commit, and have the owner review the file.
2. Invoke `superpowers:writing-plans` for **phase 1 (Access)** only.
