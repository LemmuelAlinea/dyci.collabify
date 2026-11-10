# Collabify — working notes

Project management for BSIT programs in the Philippines. Roles: `student`, `member` and
`admin`. Teaching is the `can_teach` switch (members only; admins do not teach), and
creating work spaces is the `can_manage_projects` switch (members and admins). Admins have
it off by default: they create work spaces only once an admin turns it on for them. Every
planned phase has shipped and is live at dyci-collabify.vercel.app from `main`, and company
roles are complete: phases 1 (members and the two switches), 2 (project roles), 3
(stakeholders: read-only projects, the Feedback tab, the slim sidebar and the stakeholder
Home) and 4 (QA: the gate, Pass and Send back, bug tasks, the queue) are live, so
`docs/superpowers/specs/2026-10-23-company-roles-design.md` is fully shipped. Open work is
the **Deferred** notes in `handoff.md` plus whatever the user asks for next. Read the end of
`handoff.md` for the latest state.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
node scripts/db.mjs supabase/schema.sql
node scripts/set-role.mjs <email> <student|member|admin> [status]
```

Run `npm run build` before claiming anything works — `tsc -b` runs first and catches
most breakage.

## Design system

Do not hardcode colors. Everything reads from tokens in `src/styles/index.css`:

- Surfaces: `surface`, `surface-raised`, `surface-sunken`
- Text: `text-ink`, `text-muted`, `text-faint`
- Lines: `border-line`, `border-line-strong`
- Brand ramps: `navy-*` (600 is the brand), `amber-*` (400 is the accent)
- Status ramps: `success-*` (done), `warning-*` (in progress, needs attention),
  `danger-*` (late, errors), and `pending-soft` / `pending-ink` (not started). Never
  `emerald-*`, `red-*`, or brand amber for a status.
- Personal slots: `banner`, `banner-ink`, `banner-accent`, `banner-glow` (page
  banners; the ground itself is the `.banner-fill` class, its glow and grid carry
  `.banner-deco`, figure cells on it `.banner-cell`), `progress`, `nav-icon`,
  `nav-active`, `nav-marker`, `badge`, `icon-tile` / `icon-glyph` (card icon squares).
- Dark mode's app grounds read `--u-page`, `--u-surface`, `--u-sunken`, `--u-raised`
  first (the person's background depth), then fall back to the defaults.

Status ramps and personal slots can be recolored per person in Settings → Appearance
(`lib/palette.ts` sets them inline on `<html>`). Give them defaults in `:root` / `.dark`
only, never under `.app-ui`, or the person's colors stop reaching the page.

Both light and dark are defined in the same block — a raw hex breaks one of them.

- Display face `font-display` (Outfit), body `font-sans` (Instrument Sans), utility
  `font-mono` (JetBrains Mono) for eyebrows and numerals.
- `.eyebrow` for the small mono uppercase labels, `.shell` for page gutters,
  `.blueprint` for the grid motif.
- Dark mode is the `.dark` class on `<html>`, set pre-paint by the inline script in
  `index.html`. Never switch on a media query alone.
- Motion goes through `components/motion/Reveal.tsx` or Motion's `useReducedMotion`.
  Reduced motion must stay honored.

## Conventions

- Desktop layout first, then tablet, then phone. Not a widened mobile column.
- Auth state comes from `useAuth()`; theme from `useTheme()`. No direct `supabase.auth`
  calls in pages except the one recovery-session check in `ResetPassword`.
- New protected pages go inside `<ProtectedRoute>` + `<AppShell>` in `App.tsx`, and get
  a nav entry in `components/app/nav.ts` (`soon: true` marks an entry not built yet;
  none are today).
- `supabase/schema.sql` must stay idempotent — it gets re-run.
- Copy style: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.

## Project roles (work projects)

- A work project (`general_projects.class_board_id is null`) gives each person one
  `general_members.role`: `pm` (exactly one), `coordinator`, `member`, `qa`,
  `stakeholder`. `role` is the source of truth; `level` is derived from it by the
  `sync_general_member_level` trigger (pm → owner, coordinator → manager, else member)
  so older checks keep working. Write `role`, never `level`, on a work project. A class
  board's hidden Files project keeps the old level model.
- On the frontend, read `myRole`, `can`, `canGrant`, `leadsUser` from `useGeneralProject`
  and the helpers in `lib/general/permissions.ts` (`rolePermissions`, `canAs`, `canGive`,
  and the team-lead task rules `canEditTask`, `canUnassign`, `assignableTo`,
  `canStepRank`), which mirror `general_has`, `general_can_grant` and the task guards in
  SQL.
- The company-roles SQL is seven files that run last, in this order: `company-accounts.sql`,
  `project-roles.sql`, `project-visibility.sql`, `project-team-leads.sql`,
  `project-stakeholders.sql`, `project-feedback.sql`, `project-qa.sql`. Between them they are the final
  owners of functions, triggers and policies first written in many earlier files
  (`general.sql`, `general-spaces.sql`, `general-tasks.sql`, `general-drafts.sql`,
  `general-repo.sql`, `general-notify.sql`, `general-reports.sql`,
  `general-project-archive-rbac.sql`, `meetings.sql`, `trash.sql`, `access.sql`,
  `storage-sweep.sql`, `task-stages.sql` and more). Re-running ANY file one of them supersedes means
  re-running all seven in that order, then the later owners (the final rerun tail in
  `docs/07-backup.md`, through `project-workflow-rules.sql`, `project-member-import.sql` and `space-roles.sql`),
  then `anon-lockdown.sql`; re-running one of the seven means re-running the ones after it and
  those later owners, then `anon-lockdown.sql`. Re-running `general-project-archive-rbac.sql` alone reopens every
  work project to its whole space; re-running a file `project-stakeholders.sql`
  supersedes hands stakeholders back a member's writes. `docs/07-backup.md` lists what
  each of the seven owns. Always start a redefinition from the live `pg_get_functiondef`.
- Member writes in a work project gate on `general_can_write(project)` (a member (not
  rejected) who isn't a stakeholder); reads keep `is_general_member`. A new member-write path uses
  `general_can_write`.
- Work project Members can start Files and commit to Main without a grant;
  `project-files-access.sql` gives the role `commit_main` and keeps class-board
  Files projects on their existing grant and group-leader rules.
- A member whose live projects are all stakeholder roles, with no class, no teaching
  switch and no Project manager switch, gets the slim rail (Home, Projects, Inbox,
  Calendar, Account) and `StakeholderHome` (cards from `my_stakeholder_projects()`, which
  `project-feedback.sql` owns). The rule is `isStakeholderOnly` in `lib/access.ts`, from
  `membershipOf(...).allStakeholder`; students and the admin keep their own rails.
- QA (`general_members.role = 'qa'`, `project-qa.sql`): in a project with active QA
  (`general_project_has_qa`, `has_qa` on the overview) nobody crosses the QA stage (an
  update from it or before it to a stage after it, a status-only done included, or an
  insert after it) but the pm, or QA from the QA stage itself (not QA as a team lead from
  before it). Moves among the stages after QA, and back, keep the holder rules. The QA
  stage is `general_projects.qa_stage` (a middle stage), else Testing, else the one before
  the last; `lib/work/qa.ts` mirrors it (`qaStageIndex`, `inQa`, `qaBlocks`) and the app
  hides what the database refuses. QA passes with `qa_pass_general_task` or sends back with
  `qa_send_back_general_task` (a note, posted as a comment; holders get `task_sent_back`);
  the Work tab's QA queue and the task dialog call them, and both show only while
  `has_qa` is true. QA creates bug tasks only
  (`kind = 'bug'`, never changes a kind) and cannot hold tasks. Home's "Waiting for QA" tile
  reads `my_qa_queue()`.
- Project skill tags live in `general_member_skills`, from `member-skills.sql`
  (after the seven-file chain). The Edge Function matches positions and skills;
  `supabase/functions/_shared/assignPick.ts` selects teams or receiving-team people.
  Suggestions stay drafts until the Tasks review confirms them. From notes creates
  planning tasks and never releases or assigns them.
- `work-task-handoff.sql` is the final task owner, after `project-requests.sql`
  and the complete company-role/member-skills chain; the files after it
  (`project-settings-general.sql` through `space-roles.sql`) follow, then
  `anon-lockdown.sql`.
  Existing tasks remain released; every authenticated new work task starts in
  private planning, including direct inserts claiming `released`. PM/coordinators
  create regular tasks; QA creates private bugs and can read their own unsent bugs.
  Class-board tasks keep their existing behavior. Send/review/return/reroute use
  the atomic handoff RPCs, never direct routing edits. Teams need an active lead
  to receive work; leads assign only receiving-team members. Reroutes require a
  reason and confirmation, clear old holders, and preserve task work/history.
  QA/Done work must reopen first. The task history names every transition.
  Summaries, counts, search, calendars, notifications and related task tables
  honor the release boundary. Planner queues retain private task rows; do not
  count those rows as released progress. Assign by position uses
  `general_route_context` for planning teams and `general_lead_assign_context`
  for incoming team members; old unrestricted Edge Function modes are refused.
  Deploy the reviewed frontend, SQL and `work-ai` together after the owner role walk.
- Space roles (`supabase/space-roles.sql`, after `project-member-import.sql`, before
  `anon-lockdown.sql`): on a work space `general_space_members.role` (`pm`, `coordinator`,
  `member`, `qa`, `stakeholder`) is the source of truth and `level` is derived from it by
  `general_space_members_a_sync_role`; class spaces keep levels and a null role. A space has
  exactly one PM, changed only by `hand_over_general_space` (the old PM becomes a
  Coordinator, no project role changes). `set_general_space_role` (preview with
  `preview_general_space_role`) updates the person's live projects, never a project PM row
  and never an archived project; a space Coordinator's change leaves project Coordinators
  alone, a PM's change updates them. The flag `collabify.space_role_cascade` wraps only the
  delete from `general_task_assignees` for a move to QA or Stakeholder. Joining by code and
  team seeding start on `general_space_default_role`; a project invite starts there only in
  the app, and the database also lets a project Coordinator invite as coordinator when that
  is the person's space role. A space Coordinator gets no extra read; only the space PM
  reads every project, and Workspace visibility still applies. The space's top tabs are Overview, Projects,
  Reports and Settings; Settings (`SpaceSettings.tsx`) has Details (a Coordinator edits,
  only the PM archives), Teams and Members (PM and Coordinators change, others read), and
  Archive (PM and Coordinators only). Old `/teams`, `/members` and `/archive` links redirect
  into it. Re-running any file the backup doc lists under Space roles means re-running it
  afterwards. Suite: `supabase/tests/space-roles.test.sql`.
- Starting, finishing and reopening work-project sprints, and changing sprint settings,
  belong to the project manager and coordinators (`general_can_run_sprint`,
  `supabase/sprint-settings.sql`). Members with the `manage_tasks` grant still create
  sprints and plan tasks into them. The Settings tab (`components/general/settings/`)
  replaced People: `?tab=people` and `?tab=members` open Settings → Members.
- Workspace visibility (`general_projects.visibility = 'workspace'`,
  `supabase/project-settings-general.sql`): every member of the space reads the project
  like a non-member space Owner does, through `can_read_general_project`; writes still
  need membership. A space member who is not on it sees "Ask to join"
  (`general_join_requests`); the project manager and coordinators answer in Settings →
  Members & permissions, within the invite role rules (no pm, only the project manager
  gives coordinator; a Coordinator may also give it in a join request when coordinator is already the person's space role). The project color, icon and default view are set in Settings →
  General and read through `ProjectMark` and `lib/general/projectLook.ts`.
  `supabase/project-settings-general.sql` runs after `work-task-handoff.sql` and before
  `anon-lockdown.sql`. Re-running `project-visibility.sql`, `general-spaces.sql`,
  `general-project-archive-rbac.sql` or `work-task-handoff.sql` means re-running it
  afterwards; otherwise Workspace reads are silently lost. A viewer with no role on a work
  project is `readOnly` in `useGeneralProject` and gets no Conversations tab; an approval
  is refused once the project turns Private or the requester leaves the space.
- Task priority, subtasks, dependencies and task rules (`supabase/project-task-rules.sql`)
  run after `project-settings-general.sql` and before `anon-lockdown.sql`. Re-running
  `work-task-handoff.sql`, `task-stages.sql`, `project-qa.sql` or
  `project-settings-general.sql` means re-running it afterwards. The rules are separate
  triggers, `general_tasks_0_defaults` and `general_tasks_b_rules`, ordered around
  `general_tasks_a_stage`; none of the existing task guards is redefined. Subtasks are one
  level deep, follow their parent's release state and team, and are created through
  `create_general_subtask`. A Done parent cannot gain or reopen an open subtask, and a parent
  with a subtask in QA or Done cannot be returned or rerouted. A dependency blocks Done.
  The default stage never goes past an active QA stage or reaches the last stage.
  Suite: `supabase/tests/project-task-rules.test.sql`.
- Member options (`supabase/project-member-rules.sql`) run after `project-task-rules.sql` and
  before `anon-lockdown.sql`. Re-running `work-milestones.sql` or `project-task-rules.sql`
  means re-running it afterwards. The two switches, `members_manage_milestones` and
  `members_create_tasks`, are the project manager's and off by default. A Member's task
  (`create_general_member_task`) starts in private planning, and its creator cannot read it
  until a planner sends it; once sent it is the team's (`general_tasks_0_sent_creator`: holder
  and lead rights only). Suite: `supabase/tests/project-member-rules.test.sql`.
- Milestone rules (`supabase/project-milestone-rules.sql`) run after `project-member-rules.sql` and
  before `anon-lockdown.sql`. Re-running `work-milestones.sql` or `project-member-rules.sql`
  means re-running it afterwards. The project manager's four switches are `milestone_completion`
  (automatic reaches a milestone when all its live released tasks are done, writing
  `reached_auto`; manual leaves it to people), `require_milestone_due`,
  `allow_milestone_dependencies` and `milestone_overdue_alerts`. `due_on` is nullable; the rules
  are separate triggers and none of the existing milestone guards is redefined. The automatic
  path writes under `collabify.milestone_auto`. A milestone cannot be reached while one it waits for isn't
  (`general_milestone_dependencies`, through the add and remove RPCs). The daily cron
  `collabify-milestone-overdue` (`send_milestone_overdue_alerts`) sends `milestone_overdue` to the
  project manager and coordinators once per date. Suite: `supabase/tests/project-milestone-rules.test.sql`.
- Notification settings (`supabase/project-notification-rules.sql`) run after `project-milestone-rules.sql` and
  before `anon-lockdown.sql`. Re-running `project-milestone-rules.sql`, `general-archive-rbac.sql`,
  `general-notify.sql`, `sprint-settings.sql`, `sprint-reopen.sql` or `work-planning.sql` means
  re-running it afterwards.
  Five project manager settings on `general_projects`: `sprint_end_reminder_days`, `task_overdue_alerts`,
  `milestone_due_reminder_days`, `task_assignment_notices` and `sprint_completion_notices`. Reminder stamps
  (`end_reminded_at`, `due_reminded_at`, the side table `general_task_reminders`) are written only by the
  job, never by a person. The daily cron `collabify-project-reminders` (`send_project_reminders`) sends
  `sprint_ending_soon`, `general_task_overdue` and `milestone_due_soon`; finishing a sprint, by hand or by
  automation, sends `sprint_completed`. Each notice also needs the recipient's own preference. Re-running
  the file pre-marks everything that already qualifies, silently. Suite:
  `supabase/tests/project-notification-rules.test.sql`.
- Workflow rules (`supabase/project-workflow-rules.sql`) run after `project-notification-rules.sql`
  and before `anon-lockdown.sql`. Re-running `project-notification-rules.sql`, `work-task-handoff.sql`
  or `project-qa.sql` means re-running it afterwards, so the runner and its triggers stay last; the
  latter two list `rule_applied` in their history kinds check, so their re-runs keep rule history.
  A `project-notification-rules.sql` re-run's unflagged pre-mark may fire newly overdue rules
  before the workflow file restores the silent pre-mark flag. "When {trigger}, then {action}" rules
  (`general_workflow_rules`, up to 20 per project) are written by the project manager and
  coordinators (`general_can_manage_workflow`) and run for the project with their authority, limited
  by the rule limits; the one flag `collabify.workflow_rule_run` stops chains. Only released, live
  tasks fire them. A release fires only "sent" (a subtask never does). A rule never moves a task to
  the last stage, past an active QA stage or out of Done. A refused action is skipped and recorded
  on the rule (`last_skipped_at`, `last_skip_reason`) and never blocks the person's change. Each
  applied action writes a `rule_applied` history row with a null actor; the app folds the null-actor
  row a writing rule leaves (move, priority, assign; never notify) into the rule line
  (`foldRuleCompanions`, used by the task history and the report timeline and CSV). It redefines `mark_project_reminders_sent`
  to set `collabify.reminder_premark`. `collabify-workflow-overdue` polls due times each minute
  with its own stamp; the daily reminder is a fallback and retains its 08:00 Manila schedule.
  Suite: `supabase/tests/project-workflow-rules.test.sql`.

## Security invariants

- `role`, `status`, `can_teach` and `can_manage_projects` are only changeable by an
  admin — enforced by the `profiles_guard_privileged` trigger, not just by UI. Its final
  copy lives in `supabase/company-accounts.sql`; re-run that file after any earlier one
  that redefines the guard (see `docs/07-backup.md`).
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend code, in
  Vercel, or in any committed file.
- Avatar uploads are scoped to `avatars/<user-id>/…` by storage policy.

## Agent tooling

Installed under `.claude/` (see `.claude/skills/README.md`):

- **CodeGraph** — MCP server (`.mcp.json`). When `.codegraph/` exists, use
  `codegraph_explore` (or `codegraph explore "<question>"` in the shell) before
  grep/Read to locate code and check blast radius. Re-index with `codegraph init`.
- **Caveman** — `/caveman [lite|full|ultra]` for terse replies; `/caveman-commit`,
  `/caveman-review`, `/caveman-compress`; `cavecrew-*` subagents. Commit messages still
  follow this repo's style, and user-facing copy still follows the copy rules above.
- **Ponytail** — `/ponytail` for the simplest working solution; `/ponytail-review`,
  `/ponytail-audit`, `/ponytail-debt`. Never simplifies away a security invariant.
