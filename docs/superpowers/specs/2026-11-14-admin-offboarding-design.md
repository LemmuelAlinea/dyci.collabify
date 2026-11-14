# Admin upgrade, phase 2: offboarding and oversight by office

Date: 2026-11-14. Status: draft for approval. Phase 1 (offices and the organization overview,
`2026-11-14-admin-offices-overview-design.md`) is live.

## Why

School offices run real work in Collabify, and staff leave or move. Today, when the admin
deactivates someone:

- every project they manage loses its PM; Admin Home flags each one and the admin assigns a new
  PM project by project from Work projects;
- **every work space they are PM of is stuck**: `hand_over_general_space` (`space-roles.sql`) only
  lets the space's own PM hand it over, so once that PM is deactivated nobody can change it, the
  admin included;
- their open tasks stay assigned to someone who can no longer sign in;
- teams they lead keep an inactive lead, and a team needs an active lead to receive work.

The admin needs to offboard someone in one step and see projects by office.

## Goals

- Deactivating a member who holds anything opens an offboarding dialog that lists what they hold
  and hands it over in one atomic step.
- The admin can always give a work space a new PM when its PM is not active.
- Work projects shows each project's office and filters by office.

## Non-goals

- Classes. A teacher's classes keep the current warning ("those become unreachable … until this is
  undone or the classes are handed over"). Class handover is its own piece of work.
- Coordinator, QA, stakeholder and member seats: they stay as they are.
- Offboarding students or admins (Accounts already refuses admins; students hold no PM seats).
- Moving the person's office: phase 1's Accounts control does that.
- Bulk offboarding of several people at once.

## Anti-goals

- **Half an offboarding.** If any part fails, nothing changes: the person stays active and every
  seat stays where it was.
- **Silent loss of history.** Done tasks keep their assignee; every unassign writes a task history
  line; the offboarding writes the audit log.
- **Handing hands-on work to a manager by default.** Open tasks never move to the successor.
- **The admin reading inside a project.** The preview lists project and space names, team names
  and counts only, as phase 1 does.

## Decisions made with the user

- **One successor takes everything**, chosen from people with Project manager on. Each line in the
  dialog defaults to that successor and can be changed to another eligible person before
  confirming. (Rejected: picking per line from scratch, more work every time; leaving it to space
  PMs, which leaves things unowned and does not fix stuck spaces.)
- **Open tasks are unassigned**: the departing person is removed as an assignee from every open
  (not done), live task. The task goes back to its team lead's or PM's queue to reassign. Done
  tasks keep their name. (Rejected: giving tasks to the successor; leaving them.)

## Approaches

1. **One admin-only database function that does the whole offboarding in a single transaction,
   plus a preview function for the dialog (chosen).** Atomic, so the anti-goal "half an
   offboarding" holds by construction; it is also the place to fix stuck spaces.
2. **The page calls the existing functions one by one** (`assign_general_project_pm` per project,
   then `set_account_active`). A failure halfway leaves a half-offboarded person, and the space
   handover refuses the admin, so a new function is needed anyway.
3. **An automatic handover on deactivation** (a trigger picking the space PM or a coordinator).
   Chooses the successor for the admin, which the user rejected.

## Design

### Data (`supabase/offboarding.sql`, new; after `offices.sql`, before `anon-lockdown.sql`)

No new tables. New functions only; nothing an earlier file owns is redefined.

- `admin_offboarding_preview(p_user uuid)` (stable, security definer, admin only, active): returns
  one row per item the person holds:
  `kind` (`space_pm` | `project_pm` | `team_lead` | `reviewer`), `item_id`, `item_name`,
  `project_name` (team and reviewer lines: teams are per project, `general_teams.project_id`, and
  their names repeat across projects), `space_name`, `office_name`, plus a separate count of open
  tasks they hold (`open_tasks`). Work spaces and work projects only (`kind = 'work'`,
  `class_board_id is null`), live (not trashed); archived spaces and projects are included and
  marked `archived`, because they still need an owner if restored. A `reviewer` line is one per
  project where they are `reviewer_id` on tasks in `coordinator_review`, with the count.
- **Open tasks** (the count and the unassign), *my call*: tasks not `done`, not trashed, not
  archived (`archived_at is null`), in a project that is not archived, planning tasks included.
  Tasks in archived projects are frozen and left alone; the project's new PM handles them on
  restore.
- `admin_offboard_member(p_user uuid, p_successor uuid, p_overrides jsonb default '{}')` returns
  void. `p_overrides` maps `item_id` → another successor's user id for the lines the admin changed.
  In one transaction, under row locks:
  1. Refuse unless the caller is an active admin; the target is an active `member` (not admin, not
     self); every chosen successor is an active `member` (*my call:* not an admin, though
     `is_project_manager` accepts one — offices and successors are staff), has Project manager on,
     and is not the target. The copy names what is wrong and what to do.
  2. Each **space** where the target is PM: the successor joins the space if they are not in it
     (as a member, then promoted), becomes PM, and the target becomes Coordinator — the same end
     state `hand_over_general_space` produces. Archived spaces too.
  3. Each **project** where the target is PM: the successor becomes PM and the target becomes
     Coordinator, as `assign_general_project_pm` leaves it (the successor joins first if needed).
  4. Each **team** the target leads (`general_teams.leader_id`): the seat is emptied (null). The
     new PM picks a lead. `guard_general_team_leader` already allows null; `guard_general_structure`
     (final copy in `project-team-leads.sql`) refuses only on an archived project and honours
     `collabify.team_leader_clear`, so the function sets that flag. `log_general_team_leader` writes
     the project event itself.
  5. Each **review seat** (*my call*): tasks in `coordinator_review` with `reviewer_id` = target get
     `reviewer_id` = that project's new PM, so no review is stranded (`send_work_tasks_to_teams` and
     `return_work_task` let only the reviewer act).
  6. Each **open task** they hold: their `general_task_assignees` row is deleted under the existing
     `collabify.space_role_cascade` flag, which `guard_general_task_child` (`space-roles.sql`)
     already honours for assignee deletes. The `record_general_assignee_event` trigger writes the
     `unassigned` history row itself; the function writes none.
  7. The target's status becomes `rejected` (deactivated), as `set_account_active` does.
  8. Audit (*my call*): one new `offboarded` row for the person (after = successor's name, before =
     a short count such as "2 spaces, 3 projects, 1 team, 7 tasks"), plus the status row the
     existing trigger writes. Per-project PM changes are already in each project's own history.
  - `assign_general_project_pm` and `hand_over_general_space` cannot be reused inside the
    transaction (the first refuses while the PM is still active, the second refuses the admin and
    archived spaces), so their end state is reproduced, not called.
- **Stuck spaces, outside offboarding:** `admin_assign_space_pm(p_space uuid, p_user uuid)`, admin
  only, allowed only while the space has no working PM — *my call*, the project rule: no PM row,
  or the PM is not active, or their Project manager switch is off. Same end state as above. It
  writes a new `space_pm_assigned` audit row (subject the space, after the new PM). Admin Home uses
  it (see Oversight).
- **Guards.** Existing task, team and role triggers keep running. The two flags above are the only
  ones needed; the builder must not redefine an existing guard, and if another guard refuses the
  admin path, stop and report it rather than redefining it.
- Suite `supabase/tests/offboarding.test.sql`.

### Accounts (`pages/app/admin/Accounts.tsx`)

- **Deactivate** on an active member calls the preview first. With nothing held, the current
  confirmation stays. With anything held, an **Offboard** dialog opens instead:

```
Offboard Ana Cruz
Hand everything to: [ Ben Reyes ▾ ]       (people with Project manager on)

Spaces they run                  Registrar Ops      → Ben Reyes [change]
Projects they run                Enrollment 2027    → Ben Reyes [change]
                                 Records cleanup    → Ben Reyes [change]
Teams they lead                  Records team (Enrollment 2027) — seat emptied; the PM picks a lead
Reviews waiting on them          3 (Enrollment 2027) — move to that project's new PM
Open tasks                       7                  — unassigned, back to their teams

                      [Cancel]   [Deactivate and hand over]
```

- The confirm button stays disabled until every space and project line has a successor. A database
  refusal shows as-is (wrapped with `authErrorMessage`, as phase 1's walk taught).
- Students keep today's Deactivate behaviour.

### Oversight

- **Work projects** (`pages/app/admin/WorkProjects.tsx`): an Office column and an office filter
  (from phase 1's `admin_attention_projects` / `admin_office_spaces` data or a small extension of
  the page's own read; builder's call). Projects with no PM stay first.
- **Spaces with an inactive PM** appear on Admin Home's Needs attention list as "Space has no
  project manager" with an **Assign** action that calls `admin_assign_space_pm`. *My call:* this
  reuses the phase 1 band rather than adding a page.

### Tests

- SQL: refusals (non-admin, inactive admin, target is admin or self, successor without Project
  manager, successor inactive, successor is target); a full offboarding moves every space and
  project PM, empties team-lead seats (including on an archived project), moves review seats to the
  new PM, unassigns open tasks only (not done, archived, trashed, or in an archived project) with
  exactly one `unassigned` history row each, deactivates, and writes the `offboarded` audit row; an
  override sends one project to a second successor; an admin successor is refused; a forced failure
  (an invalid override) leaves everything unchanged; `admin_assign_space_pm` refuses while the PM
  is active with the switch on and works when the switch is off.
- Frontend: the dialog lists the preview, defaults every line to the successor, keeps confirm
  disabled until complete, sends overrides, and shows a refusal; a member who holds nothing gets
  the plain confirmation.

## Left to the builder

- Component split for the dialog.
- Whether the Work projects office data comes from an existing phase 1 read or a new admin read.
- The exact history event kind for an unassign, within the existing check constraint.
