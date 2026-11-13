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
node scripts/db.mjs supabase/schema.sql supabase/classes.sql supabase/groups.sql supabase/projects.sql supabase/tasks.sql supabase/task-points.sql supabase/task-detail.sql supabase/task-claim-limit.sql supabase/task-unclaim.sql supabase/task-status-owner.sql supabase/solo-auto-claim.sql supabase/deadline-lock.sql supabase/submissions.sql supabase/reassignments.sql supabase/results.sql supabase/syllabus.sql supabase/syllabus-assessments.sql supabase/polls.sql supabase/messages.sql supabase/dashboard.sql supabase/realtime.sql supabase/recover-work.sql supabase/removed-visible.sql supabase/class-restore.sql supabase/approvals.sql supabase/accounts.sql supabase/audit.sql supabase/admin-rename.sql supabase/calendar.sql supabase/analytics.sql supabase/analytics-insight.sql supabase/reports.sql supabase/student-reports.sql supabase/admin-program.sql supabase/program-notices.sql supabase/program-registry.sql supabase/safety.sql supabase/live.sql supabase/notifications.sql supabase/rate-limit.sql supabase/class-notices.sql supabase/project-series.sql supabase/indexes.sql supabase/consent.sql supabase/privacy-requests.sql supabase/term-shifts.sql supabase/hardening.sql supabase/workplaces.sql supabase/general.sql supabase/general-tasks.sql supabase/general-notify.sql supabase/presets.sql supabase/general-repo.sql supabase/general-files.sql supabase/general-drafts.sql supabase/general-history.sql supabase/general-schedule.sql supabase/general-schedule-guard.sql supabase/general-spaces.sql supabase/general-space-teams.sql supabase/general-project-archive.sql supabase/general-archive-rbac.sql supabase/general-folders.sql supabase/general-draft-restore.sql supabase/general-project-archive-rbac.sql supabase/general-reports.sql supabase/general-project-space.sql supabase/access.sql supabase/one-workplace.sql supabase/cleanup.sql supabase/admin-invitable.sql supabase/notification-coverage.sql supabase/inbox.sql supabase/class-files.sql supabase/general-draft-commit.sql supabase/teaching-guards.sql supabase/meetings.sql supabase/general-shares.sql supabase/general-discussions.sql supabase/discussion-polls-voice.sql supabase/storage-sweep.sql supabase/trash.sql supabase/appearance.sql supabase/automation.sql supabase/work-automation.sql supabase/task-archive.sql supabase/archive-page.sql supabase/join-codes.sql supabase/anon-lockdown.sql supabase/section-faculty.sql supabase/announcement-links.sql supabase/group-leader.sql supabase/discussion-edit-delete.sql supabase/class-schedule.sql supabase/work-planning.sql supabase/class-planning.sql supabase/work-milestones.sql supabase/class-milestones.sql supabase/sprint-milestones.sql supabase/analytics-trends.sql supabase/peer-evaluation.sql supabase/scoring.sql supabase/class-notes.sql supabase/report-notes.sql supabase/report-deliverables.sql supabase/report-events.sql supabase/task-stages.sql supabase/company-accounts.sql supabase/project-roles.sql supabase/project-visibility.sql supabase/project-team-leads.sql supabase/project-stakeholders.sql supabase/project-feedback.sql supabase/project-qa.sql supabase/member-skills.sql supabase/project-files-access.sql supabase/sprint-archive.sql supabase/sprint-reopen.sql supabase/sprint-settings.sql supabase/project-requests.sql supabase/project-team-archive.sql supabase/work-task-handoff.sql supabase/project-settings-general.sql supabase/project-task-rules.sql supabase/project-member-rules.sql supabase/project-milestone-rules.sql supabase/project-notification-rules.sql supabase/project-workflow-rules.sql supabase/project-member-import.sql supabase/space-roles.sql supabase/sprint-organization.sql supabase/walkthroughs.sql supabase/task-comment-scope.sql supabase/class-files-teacher-read.sql supabase/anon-lockdown.sql
```

After re-running any of `classes.sql`, `general-tasks.sql`, `general-schedule-guard.sql`,
`general-spaces.sql`, `general-project-archive.sql` or `general-drafts.sql` on
its own, re-run `general-archive-rbac.sql` — it restores the archive policies
and guard those files would otherwise put back to their older form.

Never re-run `general-archive-rbac.sql` on its own, though. Later files in the
order redefine ten of its functions and its view, and it puts back its older
copies:

- `trash.sql`: `archive_general_task_file`, `restore_archived_general_task_files`,
  `delete_archived_general_task_file`, `delete_archived_general_task_files`,
  `list_archived_general_task_files`, `archived_general_task_file_objects`,
  `list_archived_general_draft_files` and `delete_archived_general_draft_path`
- `task-archive.sql`: `guard_general_task` and `archive_general_task`
- `work-planning.sql`: `general_task_overview` (`sprint_id` and `rank`)
- `work-milestones.sql`: `general_task_overview` (`milestone_id`)

Re-running `trash.sql` and `task-archive.sql` in turn reverts functions that
`archive-page.sql` and `class-schedule.sql` own, and `class-schedule.sql`
recreates the view `class-planning.sql` extends. So after
`general-archive-rbac.sql`, re-run the full ordered list from `trash.sql`
onward:

```bash
node scripts/db.mjs supabase/trash.sql supabase/appearance.sql supabase/automation.sql supabase/work-automation.sql supabase/task-archive.sql supabase/archive-page.sql supabase/join-codes.sql supabase/anon-lockdown.sql supabase/section-faculty.sql supabase/announcement-links.sql supabase/group-leader.sql supabase/discussion-edit-delete.sql supabase/class-schedule.sql supabase/work-planning.sql supabase/class-planning.sql supabase/work-milestones.sql supabase/class-milestones.sql supabase/sprint-milestones.sql supabase/analytics-trends.sql supabase/peer-evaluation.sql supabase/scoring.sql supabase/class-notes.sql supabase/report-notes.sql supabase/report-deliverables.sql supabase/report-events.sql supabase/task-stages.sql supabase/company-accounts.sql supabase/project-roles.sql supabase/project-visibility.sql supabase/project-team-leads.sql supabase/project-stakeholders.sql supabase/project-feedback.sql supabase/project-qa.sql supabase/member-skills.sql supabase/project-files-access.sql supabase/sprint-archive.sql supabase/sprint-reopen.sql supabase/sprint-settings.sql supabase/project-requests.sql supabase/project-team-archive.sql supabase/work-task-handoff.sql supabase/project-settings-general.sql supabase/project-task-rules.sql supabase/project-member-rules.sql supabase/project-milestone-rules.sql supabase/project-notification-rules.sql supabase/project-workflow-rules.sql supabase/project-member-import.sql supabase/space-roles.sql supabase/sprint-organization.sql supabase/walkthroughs.sql supabase/task-comment-scope.sql supabase/class-files-teacher-read.sql supabase/anon-lockdown.sql
```

On 7 October 2026 the live definitions of all ten functions matched
`trash.sql` and `task-archive.sql`, not `general-archive-rbac.sql`, and the
live `general_task_overview` had `sprint_id` and `rank`.

Likewise
re-run `general-folders.sql` after `general-repo.sql` or `general-files.sql`,
which would otherwise put back a file count that includes hidden `.keep` files.
And re-run `general-project-space.sql` after `general-project-archive.sql`,
which would otherwise put back a `general_project_overview` without the space
name the projects page reads.

Re-run `work-planning.sql` after re-running any of `general-tasks.sql`, `general-schedule.sql`, `general-project-archive.sql` or `general-archive-rbac.sql`. Each of those drops and recreates `general_task_overview` without `sprint_id` and `rank`, and `work-planning.sql` appends them again. `work-planning.sql` now drops and recreates the view too, without `milestone_id`, so follow it with `work-milestones.sql`, which appends that column. In short: re-run `work-planning.sql`, then `work-milestones.sql`, after any of the view's earlier owners.

Re-run `class-planning.sql` after `class-schedule.sql`. Both recreate `task_detail_overview`; `t.*` keeps every column either way.

Re-run `task-stages.sql` after any of those. It is the final owner of `task_detail_overview` (recreated so `t.*` includes `stage`) and appends `stage` to `general_task_overview` after `milestone_id`; `project-qa.sql` then appends `kind` and `qa_entered_at` and owns the view last, so re-run it after `task-stages.sql`.

`class-schedule.sql` redefines `guard_task_edit` (`task-archive.sql`),
`update_professor_task` (`tasks.sql`) and `apply_shift_to_deadlines`
(`term-shifts.sql`) with the planned start added. Re-run it after re-running
`task-archive.sql`, `tasks.sql` or `term-shifts.sql` on its own, or the planned
start goes back to being ignored by those three.

`results.sql` drops `task_board_overview` with `cascade` (so do `tasks.sql` and
`task-points.sql`, which hold older copies and must be followed by
`results.sql`). The cascade takes every
view built on it: the analytics views, the `report_*` views and the student's
`my_work_report` and `my_board_*`. After re-running any of those files, rebuild
the whole chain in one command:

```bash
node scripts/db.mjs supabase/results.sql supabase/analytics.sql supabase/analytics-insight.sql supabase/reports.sql supabase/student-reports.sql supabase/anon-lockdown.sql
```

`admin_class_overview` (`admin-program.sql`) is not in the chain: it counts off
the base tables, so the cascade leaves it standing. `task-archive.sql`
redefines it with archived tasks left out and the security barrier kept;
`admin-program.sql` builds that same shape once `project_tasks.archived_at`
exists, so re-running it, alone or with the chain, reverts nothing. Change one
definition and the other must change with it.

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

`general-shares.sql` runs after `class-files.sql` and `teaching-guards.sql`, before
`storage-sweep.sql`. It adds Shared with me: copies of draft files and folders passed
between members of one project, written only through its RPCs. `storage_orphans` counts
every `storage_path` in `general_shares.files` as used, so it must exist first.

`join-codes.sql` runs just before `anon-lockdown.sql`. It fixes every class, space and
project to one join code for good: triggers refuse any change to a code, and any direct
delete of a space or project code row. It relies on `set_general_join_code` (general.sql)
and `set_general_space_join_code` (general-spaces.sql) no longer making a new code.

`storage-sweep.sql` runs after `general-shares.sql`. It enables `pg_net` and schedules
the `collabify-storage-sweep` pg_cron job (every 15 minutes), which asks the Storage API
to remove files nothing references once they are a day old. The job reads the project
URL and service role key from Supabase Vault. After a restore into a new project, or
after rotating the service key, run `node scripts/sweeper-secrets.mjs` so the Vault has
them. Until then the job does nothing. `project-feedback.sql` later redefines its
`storage_orphans` to cover `feedback-files`, so re-run that file after this one.

`trash.sql` runs after `storage-sweep.sql`. It adds Trash for draft files, folders and
task files: a trashed row keeps `archived_at` set so every live listing skips it, and
`trashed_at` keeps it out of the project archive. It redefines, as supersets, the draft
file guard and archive functions from `general-drafts.sql` and the file archive functions
from `general-archive-rbac.sql`, so re-run it after either of those. It schedules the
`collabify-trash-purge` pg_cron job (daily), which deletes whatever has sat in Trash for
30 days; the storage sweep then takes the bytes.

`archive-page.sql` runs after `trash.sql` and `task-archive.sql`. It backs the Archive page
(`list_my_archive`) and gives classes, groups, class projects, class tasks, spaces, space
teams, work projects and work tasks the same 30-day Trash as files: `trashed_at`/`trashed_by`
on each, restrictive `<table>_not_trashed` read policies, and `trash_archived_item`,
`restore_trashed_item` and `delete_trashed_item`. It redefines, as supersets,
`guard_trash_columns`, `list_my_trash`, `empty_my_trash` and `purge_trash` (`trash.sql`),
`guard_general_project`, `guard_group_delete` (`groups.sql`), `list_general_space_teams` and
`list_my_archived_class_tasks` (`task-archive.sql`), so re-run it after any of those, then
`anon-lockdown.sql`.

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
`project-stakeholders.sql` later redefines `send_draft_reminders` to skip stakeholders,
so re-run it (then `project-feedback.sql` and `anon-lockdown.sql`) after this file.

`peer-evaluation.sql` drops and recreates the views `peer_results`, `peer_round_status`
and `peer_comments` without `cascade`. A later file that builds a view on
`peer_results` must drop that view before re-running `peer-evaluation.sql`, or the
drop fails. Re-run `anon-lockdown.sql` after it.

`scoring.sql` runs after `peer-evaluation.sql`. Its functions read `peer_results` from
string-bodied functions, so they record no dependency, and `peer-evaluation.sql` can
still be re-run on its own. It adds `board_scores`, `member_scores` and `score_releases`
to the realtime publication itself. Re-run `anon-lockdown.sql` after it.

`class-notes.sql` runs after `scoring.sql`. `nudge_board` (`automation.sql`) and
`remind_peer_round` (`peer-evaluation.sql`) write to `class_notes` and read it for their daily
limits. Those plpgsql bodies resolve the table at run time, so their files still load first.
Re-run `anon-lockdown.sql` after it.

`report-notes.sql` runs after `class-notes.sql`. It holds `class_note_log`, the notes with
student, group, project and author names, for the Intervention log report. Re-run
`anon-lockdown.sql` after it.

`report-deliverables.sql` runs after `report-notes.sql`. It holds `report_deliverables` (every milestone and hand-in per board, judged on time, late, missing or not due) and `report_sprints`, both staff-only, with archived projects and ended classes kept for the B3 reports.

`report-events.sql` runs after `report-deliverables.sql`. It holds `report_task_events` (every task event with its task, group or student, project and actor; staff-only, ended classes kept) for the Activity log, and an index on `task_events (at)`.

`company-accounts.sql` runs last of the list. It is the final owner of every function it
redefines — the account guards (`guard_privileged_columns`, which keeps `role`, `status`,
`can_teach` and `can_manage_projects` admin-only), `handle_new_user`, the teaching and
space helpers — and it drops `is_faculty` and `decide_faculty`. Re-run
`company-accounts.sql` (then `anon-lockdown.sql`) after re-running any of `access.sql`,
`accounts.sql`, `admin-invitable.sql`, `admin-rename.sql`, `approvals.sql`, `audit.sql`,
`class-files.sql`, `consent.sql`, `general.sql`, `general-spaces.sql`, `meetings.sql`,
`messages.sql`, `notification-coverage.sql`, `one-workplace.sql`, `schema.sql`,
`section-faculty.sql` or `workplaces.sql`. Each holds an older copy of one of those
functions or views: re-running `access.sql` alone lets anybody switch on their own
`can_manage_projects`; `access.sql`, `class-files.sql`, `one-workplace.sql` and
`admin-invitable.sql` put back bodies that call the dropped `is_faculty`; the rest put
back copies from before the Member account type.

`project-roles.sql` runs after `company-accounts.sql`. It adds the `general_role` enum,
`general_members.role` and `general_invitations.role`, the `sync_general_member_level`
trigger that keeps `level` in step with `role` on work projects, the one-PM index
`general_members_one_pm`, and the role-aware `general_has`. It is the final owner of
`general_has`, `guard_student_level`, `join_general_project` and the
`general_members_student_level` trigger. It adds the role RPCs
(`set_general_member_role`, `hand_over_general_project`, `assign_general_project_pm`)
and is also the final owner of `invite_to_general_project`
(now with a role; it drops the two-argument copy), `respond_general_invitation`,
`remove_general_member`, `leave_general_project`, `log_general_member_change`, the
`general_project_events` kinds check, `notify_general_membership` and the
`general_members_notify_level` trigger, and `notify_general_access_request` (an access
request on a work project reaches the project manager and the coordinators who can answer
it, not only level `owner`). It owns the grant rules too:
`general_can_grant` (a coordinator gives every permission it holds),
`grant_general_permission` and `answer_general_access_request` (grants go to members
only). It drops `general.sql`'s `set_general_member_level`, and adds
`search_project_managers` (the PM and co-owner pickers) and the admin-only
`admin_work_projects` view over `admin_work_project_rows()`. It also owns
`general_project_overview` (with
`my_role` and `has_pm` at the end) and `list_general_project_members` (with `role`), so
re-run it after `general-project-space.sql` or `one-workplace.sql`. Re-run `project-roles.sql` (then
`anon-lockdown.sql`) after re-running any of `access.sql`, `company-accounts.sql`,
`general.sql`, `general-notify.sql`, `general-reports.sql`, `notification-coverage.sql` or
`class-files.sql`: `general-notify.sql` puts back an access-request notice that only
level `owner` gets; `general.sql` puts back a `general_has` that hands a coordinator `edit_project`, an
owner-only `general_can_grant`, the level-only `set_general_member_level` and a second,
two-argument `invite_to_general_project` that makes old calls ambiguous; `access.sql` puts back a student trigger that ignores a change of
role; `company-accounts.sql` and `access.sql` put back a `guard_student_level` that
refuses student coordinators and a `join_general_project` that refuses students;
`general-reports.sql`, `notification-coverage.sql` and `class-files.sql` put back a log,
a notification and a trigger that ignore a change of role. Its migration
only touches rows whose role does not match their level, so re-running it changes nothing.
`project-visibility.sql` and `project-team-leads.sql` redefine some of what it defines, so
re-run those two after it, in that order, then `project-stakeholders.sql`.

`project-visibility.sql` runs after `project-roles.sql`. It narrows who reads a work
project to its members and the Owners of its space (a plain space member no longer sees
projects they are not on), seats anyone who joins a work project in its space (the
`general_members_space` trigger over `add_general_member_to_space`), and keeps work-space
invites for Owners only (`general_space_manages_invites`). It is the final owner of
`can_read_general_project` (from `general-project-archive-rbac.sql`, and before that
`general-spaces.sql`), `general_report_is_lead` (from `general-reports.sql`, now space
Owners only), the space invite and join-code functions and policies from
`general-spaces.sql` (`invite_to_general_space`, `respond_general_space_invitation`,
`set_general_space_join_code`, `withdraw_general_space_invitation`,
`list_general_space_invitations`, `set_general_space_level`, and the
`general_space_invitations_select` and `general_space_join_codes_select` policies),
`join_general_space` (from `company-accounts.sql`, and `access.sql` before it; space join
codes no longer admit anyone) and `guard_general_project` (from `archive-page.sql`, with
older copies in `general.sql` and `general-project-archive-rbac.sql`; it freezes a
project's `space_id` and `class_board_id`). Re-run it (then `project-team-leads.sql` and
`project-stakeholders.sql`, then `anon-lockdown.sql`) after re-running any of `general.sql`, `general-spaces.sql`,
`general-project-archive-rbac.sql`, `general-reports.sql`, `access.sql`,
`company-accounts.sql`, `archive-page.sql` or `project-roles.sql`. Re-running
`general-project-archive-rbac.sql` alone is the dangerous one: its
`can_read_general_project` reopens every work project to everybody in its space, and
nothing fails to tell you. `general-spaces.sql` alone gives space Managers invite power in
work spaces again and lets join codes admit people; `general-reports.sql` alone lets space
Managers read everyone's report rows; `company-accounts.sql` or `access.sql` alone lets a
space join code admit people again.

`project-visibility.sql` also owns `invite_general_space_member`: Owners can offer
space Member access without any project membership. `invited_level` defaults to
`owner` so existing pending co-owner invitations keep their meaning. The two pending
invitation lists append that level; `inbox.sql` owns the invitee list. Their changed
return types require dropping/recreating the functions with authenticated grants.
For this upgrade, run the following chain (never `general-spaces.sql` alone):

```bash
node scripts/db.mjs supabase/project-visibility.sql supabase/inbox.sql supabase/project-team-leads.sql supabase/project-stakeholders.sql supabase/project-feedback.sql supabase/project-qa.sql supabase/anon-lockdown.sql
```

A full restore already creates `invited_level` in `general-spaces.sql` before
`inbox.sql`; keep `anon-lockdown.sql` last after all function redefinitions.
That chain predates the later owners: today, after `project-qa.sql`, run the rest of the final
rerun tail below (through `project-workflow-rules.sql`, `project-member-import.sql`, `space-roles.sql` and `sprint-organization.sql`), then
`anon-lockdown.sql`.

`project-team-leads.sql` runs after `project-visibility.sql`. It adds
`general_teams.leader_id`, `general_leads_user`, `set_general_team_leader`, the
leader triggers (`general_teams_leader_guard`, `general_teams_leader_event`,
`general_team_members_leader_clear`, `general_members_leader_clear`) and the
`team_leader` event kind (its detail carries `team_name` for the activity log), and `general_archived_message` (an archived work project's
guards name the project manager; a class board's still name an Owner). It is the final
owner of `guard_general_task`, `sync_general_task_stage`, `guard_general_task_plan`,
`guard_general_structure`, the `general_task_assignees_insert` and
`general_task_assignees_delete` policies and the `general_project_events` kinds check
(`project-stakeholders.sql` now redefines the three task triggers and the two assignee
policies after it). Re-run it (then `project-stakeholders.sql`, then `anon-lockdown.sql`) after re-running any of `general.sql`,
`general-tasks.sql`, `general-archive-rbac.sql`, `task-archive.sql`, `task-stages.sql`,
`work-planning.sql` or `project-roles.sql`: they put back a task guard, stage sync and
planning guard that ignore team leaders, assignee policies without the lead branch, and a
structure guard that stops a leader leaving an archived project. `general-reports.sql`
and `project-roles.sql` list every kind (`member_role`, `pm_handover`, `team_leader`
included) in their own copies of the kinds check, so a fresh table takes them and
re-running `project-roles.sql` alone does not fail once those events exist.

`project-stakeholders.sql` runs after `project-team-leads.sql`. It adds
`general_can_write(project)` (a member (not rejected) who, on a work project, isn't a
stakeholder) and puts it at every member write; reads keep `is_general_member`. A
stakeholder's refused write says "Stakeholders can view this project but not change it."
where a trigger or function raises it, and a stakeholder's Trash leaves out (and Empty
Trash leaves alone) the draft files, task files and discussions they can no longer touch.
It is the final owner of `guard_general_task`,
`sync_general_task_stage`, `guard_general_task_plan` (from `project-team-leads.sql`),
`guard_general_task_child` (`general-tasks.sql`), `archive_general_task`
(`task-archive.sql`), `general_archive_guard` (`general-archive-rbac.sql`),
`archive_general_task_file` and `guard_general_draft_file` (`trash.sql`),
`archive_trash_block`, `list_my_trash` and `empty_my_trash` (`archive-page.sql`),
`my_general_draft`, `submit_general_draft`, `submit_general_draft_file`,
`submit_general_draft_folder` and `general_review_reviewers` (`general-drafts.sql`),
`commit_general_draft_path` (`general-draft-commit.sql`), `share_general_draft_path` and
`copy_general_share_to_draft` (`general-shares.sql`), `answer_general_repo_change`
(`general-repo.sql`), `guard_general_repo_change` (`general-repo.sql`; no stakeholder
reviewers on a change opened by hand), `request_general_access` (`general.sql`; QA and
stakeholders ask for nothing), `create_meeting`, `meeting_audiences`, `meeting_can_manage`,
`update_meeting` and `cancel_meeting` (`meetings.sql`; a meeting a stakeholder scheduled as
a member is no longer theirs to change); of the policies
`general_tasks_insert` / `_update` / `_delete`, `general_task_comments_insert` / `_update` /
`_delete`, `general_task_files_insert` / `_delete`, `general_task_logs_insert` / `_delete`
(`general-tasks.sql`, `general-archive-rbac.sql`), `general_task_assignees_insert` /
`_delete` (`project-team-leads.sql`), `general_repo_changes_insert` / `_update` and
`general_repo_comments_insert` / `_delete` (`general-repo.sql`); and on `storage.objects`
of `general_project_files_write` (`general-files.sql`), `general_files_write`
and `general_files_remove` (`general-archive-rbac.sql`). It drops
`general-drafts.sql`'s `general_drafts_own` and splits it into `general_drafts_select`
(members) and `general_drafts_insert` / `_update` / `_delete` (`general_can_write`).

It also keeps stakeholders out of the discussion and the project chat, and out of the
space when they join, and turns the role on. It is the final owner of the discussion read
policies `general_discussion_folders_read`, `general_discussions_read`,
`general_discussion_messages_read` (`general-discussions.sql`),
`general_discussion_polls_read`, `general_discussion_poll_options_read`,
`general_discussion_poll_votes_read` and `general_discussion_files_read`
(`discussion-polls-voice.sql`), all now on `general_can_write`; of
`discussion_voice_readable` and `discussion_voice_path_ok` (`discussion-polls-voice.sql`;
they guard discussion recordings and files in storage), `general_discussion_check` (every
discussion RPC passes it; somebody off the project is told they are not on it, a
stakeholder gets the stakeholder message) and `notify_discussion_started` (`general-discussions.sql`); of
`sync_general_conversation_member` and the `general_members_conversation` trigger, now
`after insert or update of role or delete` (`general-notify.sql`; joining as a stakeholder
adds no chat row, becoming one removes it, leaving the role puts it back); of
`add_general_member_to_space` (`project-visibility.sql`; a stakeholder is not seated in
the space, and space membership someone already has stays; its new
`general_members_space_role` trigger seats someone in the space when they leave the
stakeholder role, by a role change, a hand over or a PM assignment); and of
`set_general_member_role` and `invite_to_general_project` (`project-roles.sql`; the PM
sets or invites as stakeholder, a coordinator switches people between member and
stakeholder and invites as either, QA stays refused with "QA roles are not available
yet." — `project-qa.sql` now redefines these two, `guard_general_task` and
`guard_general_task_child` after it and turns QA on; becoming a stakeholder takes the person off every task they held in the project,
and `guard_general_task_child` refuses a stakeholder assignee with "Stakeholders can't hold
tasks. Pick someone else."). It is also the final owner of `send_general_deadline_reminders`
(`general-archive-rbac.sql`, first in `general-notify.sql`) and `send_draft_reminders`
(`work-automation.sql`), which skip stakeholders. A cleanup statement takes current
stakeholders out of project chats.

Re-run it (then `project-feedback.sql`, `project-qa.sql`, `project-task-rules.sql`, `project-member-rules.sql`, `project-milestone-rules.sql`, `project-notification-rules.sql`, `project-workflow-rules.sql` and `space-roles.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`) after re-running any of `general.sql`,
`general-tasks.sql`, `general-notify.sql`, `general-schedule-guard.sql`, `general-repo.sql`,
`general-files.sql`, `general-drafts.sql`, `general-archive-rbac.sql`,
`general-draft-commit.sql`, `meetings.sql`, `general-shares.sql`, `general-discussions.sql`,
`discussion-polls-voice.sql`, `trash.sql`, `task-archive.sql`, `archive-page.sql`,
`task-stages.sql`, `work-planning.sql`, `work-automation.sql`, `project-roles.sql`,
`project-visibility.sql` or `project-team-leads.sql`
(and so after any of the four files before it). Each of those alone hands a stakeholder
back a member's writes, or the discussion, the chat or the role refusal, and nothing fails
to tell you; `general-drafts.sql` alone also
recreates `general_drafts_own`, which sits beside the split policies and reopens drafts;
`general-notify.sql` alone puts every stakeholder back in the project chat (its backfill),
which the cleanup statement undoes; `project-roles.sql` alone refuses the stakeholder role
again; `general-notify.sql`, `general-archive-rbac.sql` or `work-automation.sql` alone sends
stakeholders deadline or draft reminders again.

`project-feedback.sql` runs after `project-stakeholders.sql`. It adds the Feedback tab's
data: the `general_feedback_kind` and `general_feedback_status` enums, the
`general_feedback`, `general_feedback_replies` and `general_feedback_files` tables (every
project member reads them; nobody writes them directly; all three are in
`supabase_realtime`; a deleted account leaves its posts and replies with no author), the
private `feedback-files`
bucket (25 MB, uploads by the PM, coordinators and stakeholders under
`<project>/<folder>/…`, read by members), the RPCs `create_general_feedback`,
`reply_general_feedback` and `set_general_feedback_status` (work projects only; an
archived project's feedback is read-only), and the `feedback_posted`, `feedback_reply` and
`feedback_status` notification types, added in their own transaction. It also holds
`my_stakeholder_projects()`, the stakeholder Home's one read (the caller's own live work
projects where they are a stakeholder, with progress, next milestone and open feedback).
It is also the final
owner of `storage_orphans` (`storage-sweep.sql`), which it redefines with `feedback-files`
and `general_feedback_files.path` in the used set; `storage-sweep.sql` runs earlier, before
that table exists. Re-run it (then `anon-lockdown.sql`) after re-running
`storage-sweep.sql`, which alone takes `feedback-files` out of the sweep (attached files
stay; unattached uploads are never cleared).

`project-qa.sql` runs after `project-feedback.sql`. It adds the `general_task_kind` enum
(`task`, `bug`; created in its own transaction), `general_tasks.kind` (default `task`) and
`general_tasks.qa_entered_at`, `general_projects.qa_stage` (the QA stage by name; null
means the default), `general_qa_stage_match` (a name's 0-based index among a list's
middle stages), `general_qa_stage_index(project)` (the QA stage: `qa_stage`, else a stage
named "Testing", else the one before the last; null for somebody off the project),
`general_project_has_qa(project)` (somebody active holds the qa role), and the
`general_projects_qa_stage` trigger (`general_projects_qa_stage_check`): a `qa_stage` that
is not a middle stage is refused with "The QA stage must be one of the middle stages.",
and a stage list change that leaves the old one out clears it. It is the final owner of
`general_task_overview` (`task-stages.sql`; `kind` and `qa_entered_at` appended after
`stage`), `general_project_overview` (`project-roles.sql`; `has_qa`, from
`general_project_has_qa`, appended after `has_pm`), `guard_general_task` (QA inserts bug tasks only, "QA creates bug tasks only.";
a kind changes only with `manage_tasks`; an archived task's kind is frozen),
`guard_general_task_child` (a qa assignee is refused next to a stakeholder one, "QA can't
hold tasks. Pick someone else."), `set_general_member_role` and
`invite_to_general_project` (all four from `project-stakeholders.sql`; the pm sets and
invites qa, a coordinator switches people among member, qa and stakeholder and invites as
any of the three, and becoming QA takes the person off every task they held in the
project). It also holds the QA gate and its upkeep: the `task_sent_back` notification
type (added in the enum's transaction), the `general_task_events_kind` CHECK (first in
`general-tasks.sql`, widened with `qa_passed` and `qa_sent_back`), `general_qa_stage_pick`
(the QA stage rule on a stage list), `general_task_stage_at` (a task's effective stage,
as `stageIndex` in `src/lib/stages.ts`), `general_qa_may_move` (active QA moving a task
from the QA stage to any stage after it or to the one before QA), the
`general_tasks_zz_qa_entered` trigger (`keep_general_task_qa_entered`, the one keeper of
`qa_entered_at`: set on arrival at the QA stage, kept while there, null elsewhere; named
to fire after every other BEFORE trigger on the table), the RPCs `qa_pass_general_task`
and `qa_send_back_general_task` (with `general_qa_task_waiting`, "This task isn't waiting
for QA."; send back needs a note, "Add a note saying what to fix.", posts it as a task
comment and sends holders `task_sent_back` behind `notification_prefs.task_assignments`),
and `my_qa_queue()` (QA's Home count per live work project). It is the final owner of
`sync_general_task_stage` (`project-stakeholders.sql`, before that `project-team-leads.sql`
and `task-stages.sql`): on a work project with active QA, judged on the stage a task ends
up on after alignment, crossing the QA stage (an update from it or before it to a stage
after it, or an insert after it) goes only by the PM, or by QA from the QA stage itself
("Only QA or the project manager can pass a task out of {stage}." from the QA stage,
"Only QA or the project manager can move a task past {stage}." from before it or on
insert; a QA who leads a team is refused too). Moves among the stages after QA (Revision
to Completed) and moves back are not crossings and keep the holder rule, and QA's own
moves pass the holder rule. This replaced an earlier rule that refused any move into the
last stage. `guard_general_task` lets those QA moves through when nothing else changes,
freezes an archived task's stage with its status, and reads a bug-only QA's role off
`general_members` (a pending account too).
Re-run it (then `project-task-rules.sql`, `project-member-rules.sql`, `project-milestone-rules.sql`, `project-notification-rules.sql`, `project-workflow-rules.sql` and `space-roles.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`) after re-running `task-stages.sql`,
`project-roles.sql`, `project-team-leads.sql` or `project-stakeholders.sql`, and so after any file whose re-run
calls for one of them (`general-tasks.sql`, `general-schedule-guard.sql`,
`general-archive-rbac.sql` and the rest of the `project-stakeholders.sql` list):
`task-stages.sql` alone drops the view and recreates it without `kind` and
`qa_entered_at`, which the app reads, and puts back a stage sync with no QA gate (a
holder marks a task done straight out of QA); `project-team-leads.sql` or
`project-stakeholders.sql` alone also drops the gate; `project-roles.sql` alone recreates
`general_project_overview` without `has_qa`, which the task pages read; `project-stakeholders.sql` alone
lets QA create plain tasks and hold tasks, and refuses the qa role again with "QA roles
are not available yet." Re-running `general-tasks.sql` leaves the widened CHECK alone (it
creates the table only if missing).

`member-skills.sql` runs after `project-qa.sql`. It owns only what it creates and
redefines nothing another file owns, so it stays out of the seven-file re-run chain. It
adds `general_member_skills` (per-project skill tags: primary key `(project_id, user_id,
tag)`, a cascade from `general_members`, a case-insensitive unique index, a CHECK that a
tag is trimmed with inner spaces collapsed and 1 to 40 characters; members read, a member
adds and removes their own, `manage_tasks` or `manage_structure` anybody's; no updates;
on `supabase_realtime`), the `general_member_skills_guard` trigger
(`guard_general_structure` from `project-team-leads.sql`, attached, not redefined, so an
archived project's tags are frozen; it skips deletes that run inside another trigger, so
leaving or being removed from an archived project still takes the tags along),
`general_member_skills_check` ("QA and stakeholders don't take tasks, so they have no
skills." and "Up to 12 skills each."), `general_member_skills_drop` (on `general_members`:
becoming QA or a stakeholder drops the person's tags in that project) and
`general_assign_context(project)` (what Assign by position drafts from: the candidates with
their open load, teams, positions and tags, the positions they hold, up to 60 unassigned
open tasks before the QA stage, oldest first, and how many are left). No other file
recreates what it owns, so it needs re-running (then `anon-lockdown.sql`) only after a
change to it.

`project-files-access.sql` is the final owner of `general_has` and
`general_commit_rights` and removes direct write policies from repository,
commit and blob tables. It gives work project Members Commit to Main by role,
including the ability to start Files and merge reviews. Class-board projects
keep their group-leader and grant rules. Re-run it after `general.sql`,
`general-repo.sql` or `project-roles.sql`, then `anon-lockdown.sql`.

`project-team-archive.sql` runs after `project-requests.sql` and before
`work-task-handoff.sql`. It stores each work team in its owning project's archive,
keeps its people and positions, and blocks archiving while live work remains.
`work-task-handoff.sql` runs after `project-team-archive.sql` and all earlier task owners,
then `anon-lockdown.sql` (and, before it, the files after it in the final rerun tail, through
`space-roles.sql`, which follows `project-member-import.sql` and the workflow rule runner). Adding routing metadata backfills existing tasks as
`released` without changing their holders. The final column default is `planning`;
the insert guard forces authenticated work inserts into planning even if an old
client sends `released`, and keeps class-board inserts released. Trusted service
imports may explicitly preserve released history. Re-running does not rewrite
existing routing states or assignments. It owns the restrictive task/child/notification read policies,
`general_task_readable`, `general_task_child_readable`, `general_task_released`,
`general_task_hidden`, `general_report_task_ok`, `general_user_sees_task`, the task
project/held/archived/assignee/file-hidden helpers, `general_assign_context`,
`my_qa_queue`, `general_since_last_visit`, `general_report_people`,
`general_report_activity`, `list_my_archive`, `list_my_trash`,
`archive_general_task`, `archive_general_task_file`, `general_qa_task_waiting`,
and both task and project overview views. Re-run it after any earlier file that
redefines those objects, including the company-role chain and `member-skills.sql`.
The shared task/report/storage/notification helpers protect their existing callers;
project, report, catch-up and QA summaries count released work only for every role.
Class-board reads retain their existing behavior. Home, Space overview, My tasks,
Calendar, search, project progress, forecasts, sprint/milestone progress and QA queues
read released work only. Private plans remain readable in planner queues and by
their QA bug creator. Generic task notifications require released work; handoff
notifications reach only the selected next actor.

The final rerun tail is `company-accounts.sql`, `project-roles.sql`,
`project-visibility.sql`, `project-team-leads.sql`, `project-stakeholders.sql`,
`project-feedback.sql`, `project-qa.sql`, `member-skills.sql`,
`project-files-access.sql`, `sprint-archive.sql`, `sprint-reopen.sql`, `sprint-settings.sql`, `project-requests.sql`,
`project-team-archive.sql`,
`work-task-handoff.sql`, `project-settings-general.sql`, `project-task-rules.sql`, `project-member-rules.sql`, `project-milestone-rules.sql`, `project-notification-rules.sql`, `project-workflow-rules.sql`, `project-member-import.sql`, `space-roles.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`. Re-run the applicable suffix
after any superseded owner. Activate the complete reviewed frontend and `work-ai`
function together; the function accepts only reviewed `route` or `lead` assignment
modes. Do not deploy earlier tasks independently. Task activity names coordinator
review, team send, return to planning and reroute, with the reason and destinations.

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

`sprint-milestones.sql` redefines `guard_sprint_state`, which `work-planning.sql` also defines with the same body (a finished sprint may still lose its milestone). Keep the two in step; re-running either is safe. Run `sprint-milestones.sql` after `work-milestones.sql` and `class-milestones.sql`.

## Reopening a finished sprint (2026-11-01)

`sprint-reopen.sql` owns `guard_sprint_state` (after `work-planning.sql`,
`class-planning.sql` and `sprint-milestones.sql`) and adds `reopen_general_sprint`.
Re-running any of those three files means re-running `sprint-reopen.sql` after them,
or reopening stops working. Suite: `supabase/tests/sprint-reopen.test.sql`.

## Project settings and sprint automation (2026-11-01)

`sprint-settings.sql` owns `general_sprint_settings`, `general_can_run_sprint`, the
`general_sprints_run_guard` trigger, `complete_general_sprint` (it supersedes the copy
in `work-planning.sql`), `run_sprint_automation` and the `collabify-sprint-automation`
cron job (every 15 minutes). Re-running `work-planning.sql` or `sprint-reopen.sql`
means re-running `sprint-settings.sql` after it, then `project-notification-rules.sql`, then
`project-workflow-rules.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`. `project-notification-rules.sql` now owns `complete_general_sprint` and
`run_sprint_automation` (it adds the finish notice to both). Suite:
`supabase/tests/sprint-settings.test.sql`.

## Project look, workspace visibility and join requests (2026-11-01)

`project-settings-general.sql` owns four `general_projects` columns (`color`, `icon`,
`default_view`, `visibility`), `can_read_general_project` (it supersedes the copy in
`project-visibility.sql` and adds the Workspace branch), the `general_join_requests`
table, its three RPCs (`request_join_general_project`, `withdraw_join_request`,
`answer_join_request`), the `general_join_requests_select` policy, the helper functions
`notify_join_requested` (tells the project manager and active coordinators) and
`close_general_join_request` (behind the `general_members_close_join_request` trigger, which
closes an open request as approved when the person joins another way), the two close
triggers `general_projects_close_join_requests` (`close_general_join_requests_private`: a
project that turns Private closes its open requests as withdrawn) and
`general_space_members_close_join_requests` (`close_general_join_requests_left_space`: a
person who leaves a space has their open requests on its projects closed as withdrawn), and
the `join_requested` and `join_answered` values of `notification_type`.
`answer_join_request` refuses an approval unless the project is still Workspace and the
requester still has a `general_space_members` row for its space; declining is always
allowed. Re-running `project-visibility.sql`, `general-spaces.sql`,
`general-project-archive-rbac.sql` or `work-task-handoff.sql` means re-running
`project-settings-general.sql` after it, then `project-task-rules.sql`, `project-member-rules.sql`, `project-milestone-rules.sql`, `project-notification-rules.sql` and `project-workflow-rules.sql`,
then `space-roles.sql` (it owns `answer_join_request` after this file) and `anon-lockdown.sql`. Suite:
`supabase/tests/project-settings-general.test.sql`.

## Task priority, subtasks, dependencies and rules (2026-11-01)

`project-task-rules.sql` owns:

- seven `general_projects` columns, written through the existing update policy
  (`edit_project`): `default_priority`, `default_stage`, `allow_subtasks`,
  `allow_dependencies`, `allow_multiple_assignees`, `require_assignee` and
  `require_subtasks_done`;
- two `general_tasks` columns, `priority` (no column default; the defaults trigger fills it)
  and `parent_id` (one level, same project), with the `general_tasks_parent_not_self`
  check and the `general_tasks_parent` index;
- the table `general_task_dependencies` (composite keys keep both tasks in the row's
  project), its `general_task_dependencies_select` policy (a row is readable when both tasks
  are), its grants (select only) and its `supabase_realtime` entry, with replica identity full;
- the triggers `general_tasks_0_defaults` (`apply_general_task_defaults`: priority and the
  default stage), `general_tasks_b_rules` (`check_general_task_rules`: parent, holder,
  completion and dependency rules, including reopening an open subtask under a Done parent), `general_task_assignees_single`
  (`guard_general_task_single_holder`), `general_tasks_c_follow_parent`
  (`follow_general_task_parent`: subtasks follow the parent's state, team and holders; a parent
  with a subtask in QA or Done cannot be returned or rerouted) and
  the deferred constraint trigger `general_tasks_subtask_state`
  (`check_general_subtask_state`);
- the RPCs `create_general_subtask`, `add_general_task_dependency` and
  `remove_general_task_dependency` (adding a dependency holds a row lock on the waiting
  task so a concurrent Done update cannot miss the new blocker);
- the helper functions `general_default_stage`, `general_task_link_readable`,
  `general_task_links_editable` and `general_task_links_check`.

It adds triggers beside the existing task guards and redefines none of them: the rules sit
in their own triggers, ordered around `general_tasks_a_stage` by name. Re-running
`work-task-handoff.sql`, `task-stages.sql`, `project-qa.sql` or `project-settings-general.sql`
means re-running `project-task-rules.sql` after it, then `project-member-rules.sql`, `project-milestone-rules.sql`, `project-notification-rules.sql` and `project-workflow-rules.sql`, then `space-roles.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`. Suite: `supabase/tests/project-task-rules.test.sql`.

## Member options (2026-11-02)

`project-member-rules.sql` owns:

- two `general_projects` columns, both off by default and written through the existing
  update policy (`edit_project`, the project manager): `members_manage_milestones` and
  `members_create_tasks`;
- the helper `general_can_manage_milestones` (`manage_tasks`, or the milestone switch on and
  the caller a writing Member; the member switch never applies on a class board or an
  archived project; the `manage_tasks` path is unchanged);
- the `general_milestones` insert, update and delete policies, which supersede the copies in
  `work-milestones.sql` and use that helper in place of `manage_tasks`;
- `release_milestone_tasks`, the milestone delete trigger function first written by
  `work-milestones.sql`, now owned here: it untags the milestone's tasks and sprints with the
  request's claims cleared, so a Member who may delete a milestone is not stopped by the task
  tagging and holder guards;
- the RPC `create_general_member_task`, which adds a private planning task for a Member while
  `members_create_tasks` is on. It inserts with the claims cleared (the task guard owned by
  `work-task-handoff.sql` lets only planners and QA insert) and restores them straight after.
  The task has no holder, sprint or milestone, and its creator cannot read it until a planner
  sends it;
- the trigger `general_tasks_0_sent_creator` (`guard_general_task_sent_creator`, before
  update or delete on `general_tasks`, after `general_tasks_0_defaults` and before
  `general_tasks_a_stage` by name). Once a Member's task is sent (released with `sent_at`
  set), it is the team's: a Member who created it, doesn't hold it and lacks `manage_tasks`
  can't edit, finish, archive (`archive_general_task` keeps `auth.uid()`, so its update is
  caught) or delete it as its creator. Holding it, leading a holder, holding a subtask's
  parent, and the team lead's description and dates edit still apply. Writes without claims,
  the handoff actions (`collabify.work_task_handoff`) and trigger cascades pass, and work
  released without a send keeps its creator rules. `guard_general_task` and
  `archive_general_task` are not redefined.

Tagging tasks and linking sprints keep `manage_tasks`; `guard_general_milestone` and the
`work-task-handoff.sql` guards are not redefined. Re-running `work-milestones.sql` or
`project-task-rules.sql` means re-running `project-member-rules.sql` after it, then
`project-milestone-rules.sql`, `project-notification-rules.sql` and `project-workflow-rules.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`; otherwise milestones go back to `manage_tasks` only and a Member's milestone
delete is refused once the milestone tags a task. Suite:
`supabase/tests/project-member-rules.test.sql`.

## Milestone rules (2026-11-02)

`project-milestone-rules.sql` owns:

- four `general_projects` columns, written through the existing update policy
  (`edit_project`, the project manager): `milestone_completion` (`automatic` or `manual`,
  default `automatic`), `require_milestone_due`, `allow_milestone_dependencies` and
  `milestone_overdue_alerts` (all on by default);
- two `general_milestones` columns, `reached_auto` (the database reached it, not a person) and
  `overdue_notified_at` (the overdue job's stamp), and a nullable `due_on`. A missing date is
  refused by `check_general_milestone_rules` while `require_milestone_due` is on (always on a
  class board's Files project), not by a column constraint;
- the table `general_milestone_dependencies` (a milestone waits for another in the same project,
  no self-links, no loops), written only through `add_general_milestone_dependency` and
  `remove_general_milestone_dependency`;
- the automatic reach: `settle_general_milestone` (released live tasks only; private planning
  work never counts, so a milestone with only planning work is never reached) and the triggers
  that call it, a task's release included
  (`general_tasks_zz_milestone_reach`, its `_insert` and `_delete` twins,
  `general_milestones_zz_waiters`, `general_milestone_dependencies_settle`,
  `general_projects_milestone_settle`), which write under the transaction-local
  `collabify.milestone_auto` flag so the people-only rules don't block them;
- the people-only rules and guards, added beside `general_milestones_guard` and not redefining
  it: `general_milestones_rules`, `general_milestones_0_deleting` and
  `general_milestones_overdue` (`guard_general_milestone_overdue`);
- the notification type value `milestone_overdue`, added in its own committed block before the
  main transaction, and `send_milestone_overdue_alerts`, which the pg_cron job
  `collabify-milestone-overdue` runs daily at 00:00 UTC (08:00 Manila). It alerts the project
  manager and each active coordinator once per milestone and date; signed-in roles can't call it.

Class milestones (`project_milestones`) are untouched. Re-running `work-milestones.sql` resets
the milestone policies and delete trigger that `project-member-rules.sql` owns, so re-run
`project-member-rules.sql`, then `project-milestone-rules.sql`, then `project-notification-rules.sql`,
then `project-workflow-rules.sql`, `sprint-organization.sql`, then `anon-lockdown.sql` to keep
the chain whole. Re-running `project-member-rules.sql` alone means re-running
`project-milestone-rules.sql`, `project-notification-rules.sql`, `project-workflow-rules.sql`, `sprint-organization.sql`, then `anon-lockdown.sql` after it.
`project-notification-rules.sql` now owns `send_milestone_overdue_alerts` (it adds the personal
preference check). The first cron run alerts every
milestone already past due and not reached; on 2026-11-02 there were none on live unarchived work
projects, so no pre-stamp of `overdue_notified_at` is needed (re-check at deploy). Suite:
`supabase/tests/project-milestone-rules.test.sql`.

## Project notification settings (2026-11-02)

`project-notification-rules.sql` owns:

- five `general_projects` columns, written through the existing update policy (`edit_project`,
  the project manager): `sprint_end_reminder_days` (1, 2 or 3, default 1; null is off),
  `task_overdue_alerts` (on), `milestone_due_reminder_days` (1, 2, 3 or 7, default 2; null is
  off), `task_assignment_notices` (on) and `sprint_completion_notices` (on);
- four notification type values, added in their own committed block before the main
  transaction: `sprint_ending_soon`, `general_task_overdue`, `milestone_due_soon` and
  `sprint_completed`;
- the reminder stamps `general_sprints.end_reminded_at` and `general_milestones.due_reminded_at`
  and the table `general_task_reminders` (a task's stamp lives in a side table so the job never
  writes a task row; RLS on, no policies, revoked from anon and authenticated, not in realtime),
  with the guard and clear triggers `general_sprints_zz_reminder`,
  `general_milestones_zz_reminder` and `general_tasks_zz_reminder`, added beside the existing
  ones. A signed-in person's stamp is dropped; a date moved later clears it;
- redefinitions from the live definitions: `notify_general_assignment` (live owner
  `general-archive-rbac.sql`; a work project with `task_assignment_notices` off sends no
  `general_task_assigned`, handoff notices are unaffected), `send_milestone_overdue_alerts`
  (`project-milestone-rules.sql`; each recipient also needs their own "Deadline reminders"),
  and `complete_general_sprint` and `run_sprint_automation` (`sprint-settings.sql`; each calls
  `notify_general_sprint_completed` just before unfinished work moves);
- `notify_general_sprint_completed` (`sprint_completed` to the project manager, active
  coordinators and the holders of released, live tasks in the sprint) and `send_project_reminders`
  with `mark_project_reminders_sent`. The pg_cron job `collabify-project-reminders` runs
  `send_project_reminders` daily at 00:00 UTC (08:00 Manila) on live work projects; signed-in
  roles can't call it.

Class boards and class tables are untouched. Re-running `project-milestone-rules.sql`,
`general-archive-rbac.sql` (or `general-notify.sql`, which means `general-archive-rbac.sql`
first), `sprint-settings.sql`, `sprint-reopen.sql` or `work-planning.sql` (the last two mean
`sprint-settings.sql` first) means re-running `project-notification-rules.sql` afterwards, then
`project-workflow-rules.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`; otherwise finished sprints stop being announced, assignment notices ignore
the switch and the overdue alert loses its personal check.

Re-running `project-notification-rules.sql` itself is not free. Its closing
`mark_project_reminders_sent` silently stamps everything that qualifies at that moment (overdue
released tasks, sprints within 3 days of ending, milestones due within 7 days), so those never
get a notice. The 3-day and 7-day windows apply only to a project with that reminder off; a project
with it on is stamped within its own setting. While "Overdue
task alerts" is off, newly overdue tasks are stamped silently, so turning it on later sends no
backlog. On 2026-11-02 the first apply would silence 14 overdue live tasks and 1 milestone due
within 2 days (by design; re-check at deploy). Suite:
`supabase/tests/project-notification-rules.test.sql`.

## Project workflow rules (2026-11-03)

`project-workflow-rules.sql` runs after `project-notification-rules.sql` and before
`anon-lockdown.sql`. It owns:

- the table `general_workflow_rules` ("When a trigger, then an action", up to 20 per work
  project, each on or off) with its guard `general_workflow_rules_guard`, its RLS (members and
  anyone who reads the project read; `general_can_manage_workflow`, the project manager and
  active coordinators of a live work project, write) and its realtime entry;
- the notification type value `workflow_rule`, added in its own committed block before the main
  transaction;
- the rewritten `general_task_events_kind` check, which adds `rule_applied` (the previous owner
  is `work-task-handoff.sql`; it and `project-qa.sql` list `rule_applied` too, so their re-runs
  keep a rule's history rows);
- `run_general_workflow_rules`, `apply_general_workflow_rule`, the fire functions and their
  triggers `general_tasks_zzz_workflow` and `general_task_reminders_workflow` (after insert on
  `general_task_reminders`), and `general_workflow_rule_sentence`;
- `general_workflow_overdue_runs` and `run_due_general_workflow_rules`, scheduled each minute
  as `collabify-workflow-overdue`; `clear_general_task_reminder` also clears its stamp when a
  deadline moves later, while the daily reminder keeps its 08:00 Manila schedule;
- a redefinition of `mark_project_reminders_sent` (previous owner
  `project-notification-rules.sql`) that sets `collabify.reminder_premark` around its stamps, so
  the silent pre-mark never fires "becomes overdue" rules.

Rules act for the project with the authority of the project manager and coordinators, limited
by the rule limits. The runner sets `collabify.workflow_rule_run` for the length of a rule's
action, so a rule's own change sets off no rules. Class boards and class tables are untouched.

Re-running `work-task-handoff.sql` or `project-qa.sql` means re-running
`project-workflow-rules.sql` afterwards, then `space-roles.sql`, `sprint-organization.sql`, then `anon-lockdown.sql`, so the runner and its triggers
stay last. Both files' copies of the history kinds check list `rule_applied`, so those re-runs no
longer refuse or drop a rule's history rows. Re-running `project-notification-rules.sql` also means
re-running `project-workflow-rules.sql` afterwards: it puts back `mark_project_reminders_sent`
without the pre-mark flag and `clear_general_task_reminder` without the workflow stamp reset.
Its closing pre-mark may fire newly overdue rules before the workflow file restores the flag.
The minute poll and daily fallback share a stamp, so neither repeats an action. The same
holds for any file whose re-run calls for one of those three, so a chain above that ends at
`project-notification-rules.sql` or `anon-lockdown.sql` and passes any of them takes
`project-workflow-rules.sql` before `anon-lockdown.sql`. Suite:
`supabase/tests/project-workflow-rules.test.sql`.

## Project member import

`project-member-import.sql` runs after `project-workflow-rules.sql` and before final
`anon-lockdown.sql`. It owns only `apply_general_member_import`, which checks an active
work project's PM/coordinator role and the complete reviewed member/catalog snapshot.
The RPC changes teams, scoped positions and skills atomically; Add preserves existing
values, Replace changes only stated fields, and an exact retry returns zero counts.
Project and structure parent-row locks also fence inserts through their foreign keys.
No older functions, policies or triggers are redefined. Suite:
`supabase/tests/project-member-import.test.sql`. Apply only after rollout approval.

## Space roles

`space-roles.sql` runs after `project-member-import.sql` and before final `anon-lockdown.sql`;
it is in both final rerun lists above. A work space's `general_space_members.role` is the
source of truth and `level` is derived by the new trigger `general_space_members_a_sync_role`
(`sync_general_space_member_role`). Class spaces keep the level model and a null role. The
launch backfill only fills a null role on work-space rows and never changes a set one, so a
re-run changes no project role. It owns:

- New: `sync_general_space_member_role`, `general_space_default_role`,
  `general_space_role_gate`, `general_space_role_targets`, `preview_general_space_role`,
  `set_general_space_role`, `hand_over_general_space`. The flag
  `collabify.space_role_cascade` wraps only the delete from `general_task_assignees` for a
  move to QA or Stakeholder, and only `guard_general_task_child` honors it.
- Schema: `general_space_members.role`, `general_space_invitations.invited_role` and the
  unique index `general_space_members_one_pm`.
- Triggers: `general_space_members_a_sync_role` (new), `general_space_members_student_level`
  and `general_space_members_notify_level` (recreated to fire on a role change).
- View: `general_space_overview`.
- Redefined functions: `guard_student_level`, `notify_general_membership`,
  `set_general_space_level`, `guard_general_task_child`, `general_space_manages_invites`,
  `invite_general_space_member`, `invite_to_general_space`,
  `respond_general_space_invitation`, `list_my_general_space_invitations`,
  `list_general_space_members`, `list_general_space_invitations`, `join_general_project`, `invite_to_general_project`, `create_general_project` (eight-argument
  form), `guard_student_invite`, `update_general_space`, `archive_general_space`,
  `general_space_team_can_manage`, `create_general_space_team`,
  `remove_general_space_team_member`, `list_general_space_teams` (both forms),
  `list_general_space_team_members`, `remove_general_space_member`, `answer_join_request`,
  `withdraw_general_space_invitation`.
- Policies: `general_space_teams_select`, `general_space_team_members_select`.

Re-run it (then `anon-lockdown.sql`) after re-running any of `general-spaces.sql`,
`general-space-teams.sql`, `one-workplace.sql`, `project-visibility.sql`, `project-roles.sql`,
`project-stakeholders.sql`, `project-qa.sql`, `work-task-handoff.sql`, `company-accounts.sql`,
`access.sql`, `general.sql`, `general-tasks.sql`, `general-files.sql`, `presets.sql`,
`inbox.sql`, `notification-coverage.sql`, `class-files.sql`, `archive-page.sql`,
`task-archive.sql` or `project-settings-general.sql`, since each defines an object above.
Re-running `one-workplace.sql` drops and recreates `general_space_overview` without `my_role`, so it means re-running
`space-roles.sql` afterwards, which restores the column.
Suite: `supabase/tests/space-roles.test.sql`. Apply only after rollout approval, and push the
frontend straight after: the old app cannot change space roles once the SQL is on.

## Sprint organization

`sprint-organization.sql` runs after `space-roles.sql` and before final `anon-lockdown.sql`. It is the last
owner of `guard_sprint_run`, `guard_general_task_plan`, `reopen_general_sprint`, `complete_general_sprint`,
`notify_general_sprint_completed`, `run_sprint_automation`, `send_project_reminders` and the
`general_sprints_update` policy, and it drops `general_sprints_one_running`, which `work-planning.sql` would
bring back. Re-running `work-planning.sql`, `sprint-reopen.sql`, `sprint-settings.sql`,
`project-stakeholders.sql` or `project-notification-rules.sql` means re-running this file afterwards, then
`anon-lockdown.sql`. Every rerun tail in this document ends with this file before `anon-lockdown.sql`, including
any that name only the earlier files. Suite: `supabase/tests/sprint-organization.test.sql`. Apply only after
rollout approval, and run it before pushing the frontend, which writes the new column.

## First-run walkthroughs

`walkthroughs.sql` runs after `sprint-organization.sql` and before final `anon-lockdown.sql`. It owns
`user_walkthroughs` (one row per person and flow, own-row policies, no delete) and
`keep_walkthrough_finished`, which keeps a skipped or done row from going back to active. Nothing earlier
supersedes it, so no other file's rerun means re-running this one. Its backfill, which marks every account that
has already signed in as done, runs only when the table is first created; a rerun leaves the rows alone.
Suite: `supabase/tests/walkthroughs.test.sql`, which needs the file applied or spliced in. Apply it right
before pushing the frontend, which reads and writes the table.

## Task comment scope

`task-comment-scope.sql` runs after `walkthroughs.sql` and before `anon-lockdown.sql`. It owns
`general_can_comment_task` and the policy `general_task_comments_insert`, which it takes over from
`project-stakeholders.sql` (first written in `general-tasks.sql`). Re-running either of those means
re-running it afterwards, or every member can comment on every task again. Suite:
`supabase/tests/task-comment-scope.test.sql`.

## Class files: teachers read

`class-files-teacher-read.sql` runs after `task-comment-scope.sql` and before `anon-lockdown.sql`. It owns
`class_board_teacher_reads` and `class_board_repo_id`, and the SELECT-only policies that let whoever teaches a
class (`is_class_professor`: the professor, or a co-teacher managing the class space) read its groups' hidden
Files projects: `general_projects_class_teacher_read`, and `<table>_class_teacher_read` on `general_members`,
`general_repos`, `general_commits`, `general_blobs`, `general_repo_changes`, `general_repo_comments`,
`general_shares` and `general_share_recipients`, plus `general_project_files_class_teacher_read` on
`storage.objects` for `<project>/files/...` in `general-files`. It also holds the final
`ensure_class_board_repo`: `class-files.sql`'s body with a per-board advisory lock, so two first opens at once
make one Files project instead of failing on the name. It redefines no other function or policy and
gives no write: teachers never become members, so every write path still refuses them. Re-running
`general-repo.sql`, `general-files.sql`, `general-shares.sql`, `class-files.sql` or
`project-settings-general.sql` means re-running it afterwards, then `anon-lockdown.sql`. Suite:
`supabase/tests/class-files-teacher-read.test.sql`, which needs the file applied or spliced in.

## Device push

`push-notifications.sql` runs before `anon-lockdown.sql`; its place among the other files does not
matter, since nothing earlier owns what it creates. It owns `send_notification_push` and the trigger
`notifications_z_push` (after insert on `notifications`), which posts each new row to OneSignal through
`pg_net` for the recipient's user id. The OneSignal REST API key lives only in the Vault as
`collabify_onesignal_rest_key`; without it the trigger does nothing, and a failed request is a warning,
never an error. Suite: `supabase/tests/push-notifications.test.sql`.
