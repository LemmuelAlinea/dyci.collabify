# Admin upgrade, phase 1: offices and the organization overview

Date: 2026-11-14. Status: draft for approval.

## Why

The school uses Collabify for more than classes: its offices (registrar, IT, events,
accreditation and the like) run their own projects in work spaces. The admin side never
caught up. Of the eleven admin pages, seven are about the BSIT program (Sections, Syllabi,
Curriculum, Classes, Faculty, Cohort, and Notices that reach professors and students). Admin
Home talks only about classes, and the work side gets one band of four counts. The Work
projects page does one job: it finds a project with no project manager and assigns one.

The admin should run the school's organization first and the academic program second.
Phase 1 lays the foundation every later phase builds on: offices, a regrouped rail and an
organization overview on Home.

## The whole upgrade (agreed order)

1. **Offices and the overview** (this document).
2. Spaces and projects oversight by office, plus offboarding (deactivate someone and hand
   over their PM and space roles in one step).
3. The office head: a read-only view of their own office's figures.
4. Notices by office or role.
5. Organization settings (the quiet threshold, defaults for new spaces, retention).

Each phase gets its own design. Nothing below builds phases 2 to 5.

## Goals

- The admin creates offices and gives each member one home office.
- Each work space belongs to one office.
- The admin rail reads as Organization, Academic program and Compliance.
- Admin Home shows the organization at a glance: offices, the projects that need attention,
  accounts still in setup and privacy requests near their deadline, with the academic program
  below.

## Non-goals

- Office heads and any non-admin office view (phase 3).
- Moving, offboarding or reassigning from the overview (phase 2).
- Notices by office (phase 4).
- A setting for the quiet threshold (phase 5).
- Offices for students, or for class spaces.

## Anti-goals

- **The admin reads inside a project.** Every figure stays a count or a name. No task,
  comment, file, milestone title or due date reaches the admin from these pages, and no link
  opens a project they are not on. This is the rule every admin page already follows
  (`AuditLog.tsx`, `ProgramClasses.tsx`, `WorkProjects.tsx`), and phase 1 must not become the
  way round it.
- **Offices break existing work.** A space or person without an office keeps working
  exactly as today and shows under Unassigned.
- **Members change their own office, or a space PM moves their space.** Both belong to the admin.

## Decisions made with the user

- **Office above spaces.** Offices are a new concept. A space belongs to an office; a person
  has one home office. (Rejected: a space is an office, which breaks for someone in two
  offices or an office with several spaces; no offices, which leaves nothing to group or
  target by.)
- **An office head exists, read-only**, but is phase 3. Phase 1 has no head field.
- **Needs attention** means exactly two things on a running (not archived) work project:
  - **No project manager**: what `has_pm` already reports.
  - **Gone quiet**: no change by a person for 14 days. Automation (sprint rollovers, workflow
    rules) does not count. A running project whose live tasks are all Done is never quiet.
  Overdue milestones and overdue tasks are deliberately not signals. They stay the office's
  business.

## Approaches

1. **New tables beside the existing ones, admin-only functions for the figures (chosen).**
   `offices`, a person-to-office table and a space-to-office table, with admin-only security
   definer functions that return counts. It keeps the counts-only rule in the database and
   touches no function another file owns.
2. **Columns on `profiles` and `general_spaces`.** Shorter to read, but an admin-only column
   on `profiles` means redefining `profiles_guard_privileged` (final copy in
   `company-accounts.sql`) and adding a re-run chain. A `general_spaces` column alone would
   be safe (spaces are written only through security definer functions), but splitting the
   two models, one table and one column, buys nothing.
3. **Derive a person's office from their spaces.** No home office, which the user chose, and
   someone in two offices' spaces has no answer.

Adding the figures up in the browser is not an option: the admin cannot read tasks.

## Design

### Data (`supabase/offices.sql`, new)

- `offices`: `id`, `name` (1 to 80 characters, unique case-insensitively among live
  offices), `description` (default `''`), `archived_at`, `created_by`, `created_at`,
  `updated_at` (`touch_updated_at`).
- `office_members`: `user_id` (primary key, references `profiles` on delete cascade),
  `office_id` (references `offices`), `assigned_by`, `assigned_at`. One row per person,
  meaning one home office. The person must be a `member` (a trigger refuses a student or an
  admin).
- **Role and status changes.** *My call:* a separate `after update of role` trigger on
  `profiles` deletes the person's `office_members` row when they stop being a member (to
  student or admin), and writes `office_changed` to the audit log. It does not touch
  `profiles_guard_privileged`. A deactivated, pending or rejected member keeps their office
  (reactivation restores it), is left out of the `people` counts, and does not block
  archiving; archiving an office clears the office of its inactive people.
- `office_spaces`: `space_id` (primary key, references `general_spaces` on delete cascade),
  `office_id`, `assigned_by`, `assigned_at`. Only work spaces (not a class's space).
- RLS: every authenticated account reads `offices` (names only). `office_members` and
  `office_spaces` are read by the admin and by the row's own person or the space's members.
  Every write goes through admin-only RPCs (`is_admin()`); there are no direct write policies.
- RPCs (all check an active admin and write the audit log):
  - `create_office`, `rename_office`, `archive_office`, `restore_office`, `delete_office`.
  - `set_member_office(user_id, office_id | null)`.
  - `set_space_office(space_id, office_id | null)`.
  - Admin-only listings, because RLS on `general_spaces` hides space names from a non-member
    admin: `admin_office_spaces()` (every work space: id, name, office, archived or not,
    running project count) and `admin_office_people()` (every member: id, name, email,
    status, office). Names and counts only. The Offices page, the Unassigned panel and every
    Change office picker read these.
- **A new space starts in its creator's home office**: an `after insert` trigger on
  `general_spaces` (security definer) inserts the `office_spaces` row when the creator has
  one. It is a separate trigger, so no existing space trigger is redefined.
- **Archiving an office** is refused while it still has active people or live (not archived,
  not trashed) spaces, and the message says how many and where to move them ("Move its 3
  people and 2 spaces first"). *My call:* archived and trashed spaces do not block it; they
  keep their office row, so they come back filed if restored. Archived offices are restored
  or deleted for good from the admin Archive page, which gains an Offices section. Delete
  for good needs an archived office with no rows left; its archived spaces' rows are removed
  with it and those spaces become Unassigned.
- **Audit.** `audit_action` gains `office_created`, `office_renamed`, `office_archived`,
  `office_restored`, `office_deleted`, `office_changed` (a person's office) and
  `space_office_changed`; the Audit log page labels each. `audit_events` has no office
  column, so the office name goes in the subject label or the before and after values, the
  way existing rows carry their detail.
- **Run order.** The file runs after the current last file before `anon-lockdown.sql`, is
  listed in `docs/07-backup.md`, and gets a CLAUDE.md section. It must be idempotent.

### Overview figures (in the same file)

- `admin_org_overview()` returns one row per live office, plus one Unassigned row (spaces
  with no office, people with no office): `spaces`, `running_projects`, `people`,
  `needs_attention`.
- `admin_attention_projects()` returns each running work project that needs attention:
  project name, space name, office name, `no_pm`, `quiet_since` (the last activity, or null
  when not quiet). Names and dates only.
- **Last activity** is the latest `general_task_events.created_at` with a non-null
  `actor_id` for the project, else the project's `created_at`. Automation leaves no
  person-actor event, so a rollover or workflow rule never resets the clock. *My call:*
  planning tasks' events count, because an office planning its next release is not quiet,
  and only a timestamp leaves the function. Quiet means that time is more than 14 days ago
  and the project has at least one live task that is not Done (a project with no tasks at
  all is quiet once it is 14 days old). The builder confirms which history tables carry
  person-made changes (`general_task_events` and any later history table with an actor) and
  indexes `(project_id, created_at)` accordingly.
- *My call:* these are new functions. `admin_work_project_rows()` stays as
  `project-roles.sql` wrote it, so no new ownership chain is created.

### Rail (`components/app/nav.ts`)

The single `ADMIN` group becomes three:

- **Organization**: Home, Offices, Accounts, Work projects, Notices. Home is listed here only
  when the rail has no other group carrying `HOME` (`OVERVIEW` and `ADMIN_INVITED` already
  do), so an admin who is in a space or invited to one never gets two Home links. An admin in
  nothing gains a Home link, which they have no rail entry for today.
- **Academic program**: Sections, Syllabi, Curriculum, Classes, Faculty, Cohort.
  Collapsible, and it remembers whether it was left folded (the existing `collapsible`
  support in `SideNav.tsx`).
- **Compliance**: Audit log, Privacy requests.

Account stays as it is. The rules for an admin who is also in a class or space are unchanged;
the three groups simply replace `ADMIN` wherever it appears. New path `paths.admin.offices`
(`/admin/offices`), inside the admin `RequireAdmitted` block in `App.tsx`.

### Offices page (`pages/app/admin/Offices.tsx`, new)

- A list of live offices: name, description, people count, spaces count. New office, Rename,
  Archive.
- Opening an office shows its people and its spaces, each with Move to another office.
- An Unassigned panel lists members and spaces with no office, so the admin can file them.
- Follows the existing admin page pattern (the banner title, `.eyebrow`, `EmptyState`,
  confirmation dialogs) and the copy rules.

### Accounts (`pages/app/admin/Accounts.tsx`)

- Each member's row shows their office and offers Change office. Students and admins have
  none.
- A filter by office.
- **Bulk CSV import** accepts an optional `office` column matched by name, case-insensitive.
  *My call:* an unknown office name imports the row with no office and reports it as a
  warning, rather than skipping a valid account. An office on a student row is ignored with a
  warning. On an overwrite, a blank `office` leaves the person's office alone, and a named
  one replaces it. This changes the `bulk-register-users` Edge Function, the overwrite path
  and the CSV preview, which means redeploying the function.

### Admin Home (`pages/app/AdminHome.tsx`)

The organization overview, top to bottom:

1. **Offices**: one row per office from `admin_org_overview()` (Office, Spaces, Running
   projects, People, Needs attention), Unassigned last. Each row opens that office on the
   Offices page.
2. **Needs attention**: from `admin_attention_projects()`. Each line names the project, its
   space and office, and why ("No project manager", "Quiet since 28 Oct"). No PM opens Work
   projects at its Assign; quiet is only named.
3. **Accounts in setup** (bulk imports not finished) and **privacy requests** due within two
   days or overdue, each a count that opens its page. *My call:* a request counts against its
   nearest unmet date (`acknowledge_by` until acknowledged, then `complete_by`), in calendar
   days to match the table.
4. **Academic program** band: classes that cannot start and a cohort progress summary, from
   the sources `ProgramClasses` and `Cohort` already use. *My call:* hidden when the program
   has no classes.

The intro copy and the three "upcoming" cards are rewritten for the organization. Desktop
first, then tablet, then phone; tokens only; every state (loading, empty, failed with retry)
is handled the way the current counts band is.

### Tests

- SQL suite `supabase/tests/offices.test.sql`: only an admin writes; a member cannot change
  their own office or a PM their space's; a student or admin cannot be given an office; the
  new space default; an archive with people or spaces is refused; both overview functions
  refuse a non-admin and return no project content; quiet at 13 and 15 days; an automated
  task change does not reset quiet; an all-Done project is never quiet; a member made student
  loses their office; the admin listings refuse a non-admin.
- Vitest: the three admin groups for an admin who is in nothing, and for one who is in a space.
- Every `data-walkthrough` marker is unaffected (admins get no walkthrough).

## Left to the builder

- Exact component split and file names under `pages/app/admin/`.
- The empty state and copy wording, within the copy rules.
- Whether Offices reuses the Sections page's list components.
- Index choices for the last-activity query.
