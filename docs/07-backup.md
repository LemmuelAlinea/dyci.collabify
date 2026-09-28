# Backup and restore

What exists, what is recoverable, and what is not. Measured on 23 August 2026
against the live database.

## What is in the database

| | |
|---|---|
| Database size | **17 MB** |
| Tables in `public` | 36 |
| Views in `public` | 35 |
| Rows in `public` | 591 |

Small enough that every option below finishes in seconds. That will not stay
true once a full cohort uses it for a term, so the figures are dated.

## The two halves of a restore

**The schema is code, and that is the stronger half.** Every table, policy,
trigger, function and view is defined by a file in `supabase/`, and every file
is idempotent. A database that vanished entirely can be rebuilt by running those
files in this order:

```bash
node scripts/db.mjs supabase/schema.sql supabase/classes.sql supabase/groups.sql supabase/projects.sql supabase/tasks.sql supabase/task-points.sql supabase/task-detail.sql supabase/task-claim-limit.sql supabase/task-unclaim.sql supabase/task-status-owner.sql supabase/solo-auto-claim.sql supabase/deadline-lock.sql supabase/submissions.sql supabase/reassignments.sql supabase/results.sql supabase/syllabus.sql supabase/syllabus-assessments.sql supabase/polls.sql supabase/messages.sql supabase/dashboard.sql supabase/realtime.sql supabase/recover-work.sql supabase/removed-visible.sql supabase/class-restore.sql supabase/approvals.sql supabase/accounts.sql supabase/audit.sql supabase/admin-rename.sql supabase/calendar.sql supabase/analytics.sql supabase/analytics-insight.sql supabase/reports.sql supabase/student-reports.sql supabase/admin-program.sql supabase/program-notices.sql supabase/program-registry.sql supabase/safety.sql supabase/live.sql supabase/notifications.sql supabase/rate-limit.sql supabase/class-notices.sql supabase/project-series.sql supabase/indexes.sql supabase/consent.sql supabase/privacy-requests.sql supabase/term-shifts.sql supabase/hardening.sql supabase/workplaces.sql supabase/general.sql supabase/general-tasks.sql supabase/general-notify.sql supabase/presets.sql supabase/general-repo.sql supabase/general-files.sql supabase/general-drafts.sql supabase/general-history.sql supabase/general-schedule.sql supabase/general-schedule-guard.sql supabase/general-spaces.sql supabase/general-project-archive.sql supabase/general-archive-rbac.sql supabase/general-folders.sql supabase/general-draft-restore.sql supabase/general-project-archive-rbac.sql supabase/general-reports.sql supabase/general-project-space.sql supabase/access.sql supabase/one-workplace.sql supabase/cleanup.sql supabase/admin-invitable.sql supabase/notification-coverage.sql supabase/inbox.sql supabase/class-files.sql supabase/general-draft-commit.sql supabase/teaching-guards.sql supabase/storage-sweep.sql supabase/trash.sql supabase/appearance.sql supabase/automation.sql supabase/work-automation.sql supabase/anon-lockdown.sql
```

After re-running any of `classes.sql`, `general-tasks.sql`, `general-schedule-guard.sql`,
`general-spaces.sql`, `general-project-archive.sql` or `general-drafts.sql` on
its own, re-run `general-archive-rbac.sql` — it restores the archive policies
and guard those files would otherwise put back to their older form. Likewise
re-run `general-folders.sql` after `general-repo.sql` or `general-files.sql`,
which would otherwise put back a file count that includes hidden `.keep` files.
And re-run `general-project-space.sql` after `general-project-archive.sql`,
which would otherwise put back a `general_project_overview` without the space
name the projects page reads.

`access.sql` runs last and redefines, as supersets, functions from
`workplaces.sql`, `consent.sql`, `audit.sql`, `admin-rename.sql`,
`approvals.sql` (which recreates `decide_professor`), `accounts.sql`,
`general.sql`, `general-spaces.sql` and the `classes_insert` policy from
`classes.sql`. Re-run it after re-running any of those on its own, or the
admission gates go back to their older, open form.

`one-workplace.sql` runs after `access.sql`. It gives every class an education
space and redefines, as supersets, the `general_space_overview` view and the
member lists (`general-spaces.sql`), `join_class` (`rate-limit.sql`),
`class_overview`, `is_class_professor` and the class policies (`classes.sql`),
the teaching helpers in `groups.sql`, `projects.sql`, `tasks.sql`,
`syllabus.sql`, `removed-visible.sql` and `messages.sql`. Re-run it after any
of those. Re-run `general-spaces.sql`, then `one-workplace.sql` — the first
now drops its view and its two member-list functions before recreating them,
so running it alone no longer fails, but it still puts back their narrower,
pre-education-space shape until `one-workplace.sql` runs again.

`cleanup.sql` runs after `one-workplace.sql` and drops the old sign-in landing
state (`profiles.home_workplace` and the `public.workplace` enum). Re-run it
after any old workplace-era file that might have been restored from history,
then re-run `anon-lockdown.sql`.

`admin-invitable.sql` runs after `cleanup.sql`. It redefines `search_faculty`
from `one-workplace.sql` so a class's faculty panel can find admins too, so
re-run it after `one-workplace.sql`.

`notification-coverage.sql` runs after `admin-invitable.sql`. It adds the
notifications for space invitations, accepted invitations, hand-ins, reviews,
project changes and membership changes, and the `submissions` and
`project_updates` switches. It only adds triggers and columns, so re-running
it is safe; re-run `anon-lockdown.sql` after it.

`inbox.sql` runs after `notification-coverage.sql`. It adds `space_kind` to
`list_my_general_space_invitations`, the same shape `general-spaces.sql` now
defines.

`class-files.sql` runs after `inbox.sql`. It gives each class project board a
hidden work project for its Files and redefines `guard_general_creator`
(access.sql) and three notification functions (notification-coverage.sql) as
supersets, so re-run it after either of those.

`general-draft-commit.sql` runs after `class-files.sql`. It adds
`commit_general_draft_path`, which commits a draft file or folder straight to
Main for whoever holds `edit_files`.

`teaching-guards.sql` runs after `general-draft-commit.sql`. A deactivated professor
stops teaching their classes, restoring a student respects the class size limit, and a
class only takes a syllabus the caller owns or the program office published. It
redefines `is_class_professor` (one-workplace.sql), `owns_resource`,
`is_privacy_handler`, `restore_class_member` (class-restore.sql) and the `classes` /
`teaching_resources` owner policies, so re-run it after any of those.

`storage-sweep.sql` runs after `teaching-guards.sql`. It enables `pg_net` and schedules
the `collabify-storage-sweep` pg_cron job (every 15 minutes), which asks the Storage API
to remove files nothing references once they are a day old. The job reads the project
URL and service role key from Supabase Vault. After a restore into a new project, or
after rotating the service key, run `node scripts/sweeper-secrets.mjs` so the Vault has
them. Until then the job does nothing.

`trash.sql` runs after `storage-sweep.sql`. It adds Trash for draft files, folders and
task files: a trashed row keeps `archived_at` set so every live listing skips it, and
`trashed_at` keeps it out of the project archive. It redefines, as supersets, the draft
file guard and archive functions from `general-drafts.sql` and the file archive functions
from `general-archive-rbac.sql`, so re-run it after either of those. It schedules the
`collabify-trash-purge` pg_cron job (daily), which deletes whatever has sat in Trash for
30 days; the storage sweep then takes the bytes.

`appearance.sql` runs after `trash.sql`. It adds `user_appearance` and
`appearance_palettes`, each person's own colours from Settings → Appearance, readable
by their owner only.

`automation.sql` runs after `appearance.sql`. It schedules two pg_cron jobs:
`collabify-scheduled-releases` (every 15 minutes) announces a scheduled project once its
release time arrives, and `collabify-overdue-notices` (hourly) tells a task holder once
when their task slips past its date. It also adds `nudge_board`, a once-a-day reminder
a professor sends to a quiet board, and `copy_class_projects`, which copies a past class's
projects into a new one as archived drafts.

`work-automation.sql` runs after `automation.sql`. It holds the work-space helpers:
`general_project_visits` and `general_since_last_visit` (what changed since a person's
last sitting in a work project), and the daily pg_cron job `collabify-draft-reminders`
(draft files left untouched and unsubmitted for three days), and
`general_project_templates`, each person's own saved project templates.

`anon-lockdown.sql` runs last and takes EXECUTE on every public function away
from the signed-out role, keeping signed-in access as it was. Re-run it after
adding or redefining any function; `supabase/tests/anon-lockdown.test.sql`
fails until you do.

`consent.sql` sits near the end for a reason: it redefines
`handle_new_user()` as a superset that also records what a person agreed to at
signup. Running `schema.sql` after it puts the older definition back and
silently stops recording consent, which nothing would fail on and nobody would
notice until somebody asked what a student had agreed to.

**This order is verified, and it was not always right.** When it was first
written the claim above was untrue: running the files in order produced a
database the application could not query. Three files redefined an object an
earlier file already owned, using an older copy, so whichever ran last quietly
undid the newer one — `task_board_overview` came out missing ten columns,
`guard_task_assignee` lost the locked-project and handed-in checks, and
`guard_reassignment_request` lost the handed-in check. None of it showed in the
live database, because the files had never actually been run in this order
against it.

It is now run end to end, twice, followed by all fifteen suites:
**379 assertions, 0 failures.** Repeat it the same way after changing anything
in `supabase/`, and run the drift check first:

```bash
node scripts/schema-drift.mjs
```

That lists every object more than one file defines and flags any whose **last**
definition is smaller than an earlier one — the shape all three faults had.

**The data is the weaker half**, and it depends on Supabase's own backups.
Where they are: Supabase dashboard → Database → Backups. What the plan includes
(retention, point-in-time recovery) is a property of the project's billing tier
and is **not verified here** — check it in the dashboard and write the answer
below before anybody relies on it.

> Retention actually available on this project: _to be filled in from the
> dashboard._

## Taking a copy by hand

The usual command, for a copy you hold yourself:

```bash
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -Fc -f collabify-$(date +%F).dump
```

**Not measured here.** `pg_dump` is not installed on the development machine
this was written on, so no file size or duration can be quoted. Install the
PostgreSQL client tools, run it once, and record what you get — a backup nobody
has ever taken is a plan, not a backup.

## What a restore cannot bring back

Storage objects — avatars, task files, project and announcement attachments,
syllabus uploads — live in Supabase Storage, not in the database. A database
restore returns the rows that *describe* those files while the files themselves
come back only if the bucket is restored too. Anybody testing a restore should
open a task with an attachment afterwards and confirm the file opens, not just
that the row exists.

## What protects the data day to day

Deleting is deliberately hard, and that is the first line of defence:

- **No delete button for an account.** The Accounts page deactivates instead,
  because deleting a person's row reaches into other people's work.
- **A professor holding a class cannot be deleted at all** — `on delete
  restrict` on `classes.professor_id` and `projects.created_by`, asserted in
  `supabase/tests/safety.test.sql`. Hand the class over or archive it first.
- **Archiving is offered everywhere deleting is**, and every destructive dialog
  names what will be lost rather than asking whether you are sure.
- **The audit log** records who changed a role, a status, or a class, and no
  policy lets anybody edit or delete an entry — not even the admin.
