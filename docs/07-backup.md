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
is idempotent — the suites re-run them constantly, which is what proves it. A
database that vanished entirely could be rebuilt by running those files in
order:

```bash
node scripts/db.mjs supabase/schema.sql supabase/classes.sql supabase/groups.sql supabase/tasks.sql supabase/task-points.sql supabase/task-detail.sql supabase/task-claim-limit.sql supabase/task-unclaim.sql supabase/task-status-owner.sql supabase/solo-auto-claim.sql supabase/deadline-lock.sql supabase/submissions.sql supabase/reassignments.sql supabase/results.sql supabase/syllabus.sql supabase/syllabus-assessments.sql supabase/polls.sql supabase/messages.sql supabase/dashboard.sql supabase/realtime.sql supabase/recover-work.sql supabase/removed-visible.sql supabase/class-restore.sql supabase/approvals.sql supabase/accounts.sql supabase/audit.sql supabase/admin-rename.sql supabase/calendar.sql supabase/analytics.sql supabase/analytics-insight.sql supabase/reports.sql supabase/student-reports.sql supabase/admin-program.sql supabase/program-notices.sql supabase/program-registry.sql supabase/safety.sql
```

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
