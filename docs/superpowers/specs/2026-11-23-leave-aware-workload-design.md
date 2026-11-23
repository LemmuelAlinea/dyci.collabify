# Leave-aware workload

Status: draft for approval · 2026-11-23 · builds on `2026-11-22-space-workload-balancing-design.md` (phases 1–3 live)

## Intent

When a member is away — planned leave, a half day, sudden sickness, a long absence, or leave while on several
projects — Collabify should see which of their work is at risk and help each project manager decide what happens to
each task. It does not run leave: no approval, no leave types, no balances, no reasons. HR systems do that. Collabify
only needs the days someone cannot work, and it should handle every kind of leave the same way.

Why: the capstone defense question about balancing work across members extends to "what happens when one of them is
on leave". Today time off lowers available hours silently; nobody is told, no task is flagged, and the only remedy is a
full reassignment.

## What the four tools do (prior art)

- **ClickUp**: time off shows as 0-hour days in Workload and on tasks while assigning or scheduling; you can still
  choose conflicting people or dates.
- **Asana**: an "away" status with a return date next to the name wherever they are mentioned or assigned; a ⚠ on
  tasks that overlap time off; capacity plans count it. Reassignment is manual, guided by a coverage plan.
- **Microsoft Project**: vacation is non-working time on the person's calendar, so their tasks take longer and the
  projected finish moves.
- **Jira Plans**: absences can lower sprint capacity; per-person support is weak.

None reassigns work on its own. Collabify follows that: it detects, explains and suggests; a person decides.

## Decisions (made with the owner)

1. **Who records leave:** the person, or their work space's project manager or coordinators (option B). Dates and
   hours only, never a reason. The person sees who added it and can edit it.
2. **Scope:** all four parts — leave impact check, AI suggestion per task, temporary cover, away badges and an
   at-risk forecast (including sprint hours).
3. **Temporary cover swaps in (A):** the away person comes off the task, the cover goes on, and Collabify remembers
   whose it is; when the leave ends both are asked to hand it back.
4. **Unknown end dates:** a planner enters a best-guess end date; on the leave's last day the project manager is asked
   to extend it or confirm the person is back. Extending re-runs the impact check.
5. **Storage (A):** away days stay one `user_time_off` row per day, as today. A "leave" is a run of consecutive
   weekday away days (a weekend between them does not split it), worked out when read.
6. **Who sees away dates:** anyone who shares a live work space with the person sees their away dates (never a
   reason, never per-day hours beyond "part day"), like Asana's away status. This covers the badges and the notices.
   Load, available hours and the Workload tab keep their phase-1 visibility.

## Goals

- Recording a leave, by the person or a planner, tells each affected project's manager and coordinators which of
  that project's open tasks are at risk, with a clear status per task.
- A project manager can ask for a suggestion per flagged task, then accept, edit or skip each one; nothing changes
  until they apply.
- A task can be covered while its holder is away and handed back in one click when they return.
- Anyone assigning work sees who is away, and a task shows when its remaining work no longer fits its holder's hours.
- Every kind of leave goes through the same flow: whole days, part days, sudden, long, open-ended (extended), and
  leave across several projects or spaces.

## Non-goals

- Leave approval, leave types, balances, accrual, policies, statutory rules, payroll, medical details or reasons.
- Moving work automatically. AI suggests; a person applies.
- Changing how load, room or estimates are counted (phases 1–3 rules stay).
- Class spaces, class boards and student groups.

## Anti-goals

- A planner learning why someone is away, or any field that invites a reason.
- A notice storm: one notice per leave per project, not one per day or per task.
- Cover that leaves the work orphaned (nobody reminded) or erases the away person's history.

## How it works

### Recording leave

- Settings → Time off (the person) keeps working as today, and gains a date range ("from–to", whole days or the same
  hours each day).
- A planner records leave from the space Workload tab's person row ("Mark away"): from, to (best guess allowed),
  whole days or hours per day. Allowed for the space's project manager and coordinators, for members of that space.
- Both go through one database action that writes the day rows (weekdays only), stamps `added_by`, and runs the
  impact check once for the resulting leave. Removing days also goes through an action (so a shortened leave updates).
- The person sees "Added by <name>" on rows a planner added. Planners still see only hours through the workload reads.
- Time off is per person, not per space (one leave affects every space they are in), as today.
- *Builder answers (my calls):*
  - A planner of **any** work space the person is in may add away days for them; the days count everywhere, because
    the person is away everywhere. The check and notices then cover all their projects (decision 6 makes the dates
    visible to those planners anyway).
  - A planner may remove days that a planner added, never days the person added; the person may edit or remove any of
    their rows. `added_by` is null for the person's own rows.
  - Away dates are read through one new function returning ranges (person, first day, last day, part day or not) for
    people who share a live work space with the caller. `user_time_off`'s own-rows policy stays.
  - Adjacent leaves merge into one run; that is what happened (one continuous absence). Part days count as away days.

### Leave impact check (rules)

For a leave (a run of away days), take every open, released, live task the person holds in live work projects. For
each, a status from rules, in this order:

- **Blocks someone**: another open task waits for it (dependency) and its due date falls in or before the leave's end.
- **Due during leave**: its due date falls on an away day.
- **Won't fit**: remaining work (estimate minus all logged time, never below 0) is more than the person's available
  hours from today to the due date (the phase-1 hours function, so time off and other load count).
- **Fine**: everything else (including tasks with no estimate and a due date after the leave — shown as "No estimate"
  when it has none, so the manager knows the check is blind there).

Done, archived and trashed tasks, and tasks in archived or trashed projects, are left out. The check writes nothing to
tasks.

*Builder answers (my calls):*
- Remaining work is the person's share: (estimate − all logged time, at least 0) ÷ holders, as load splits it. Hours
  come from the phase-1/2 functions (`work_person_available`, `work_load_portions`), not new counting rules.
- "Blocks someone" means an open task depends on this one and this task's due date is on or before the leave's last
  day (or it has no due date). The dependent task's own date is not checked.
- A task with no due date is never "Won't fit" or "Due during leave"; it is "Blocks someone" or "Fine". A due date
  already past counts as "Won't fit" when work remains.
- "Held" means the person is in the task's holders; leading a team adds nothing.

Notice: each affected project's manager and coordinators (in any space) get one Inbox notice per leave ("Ivan is away 26–28 Nov. 3
tasks in Login work need a look."), linking to the review. Extending or shortening the leave sends an updated notice
only when the flagged set changes. A leave with no flagged tasks sends nothing. The notice respects each recipient's
notification preference, like other project notices.

*Builder answers (my calls):* a small side table keeps one row per person, project and leave (first and last day,
the flagged task ids, when it was sent). A recomputed run that overlaps a stored row is the same leave; the row's dates
and flagged set are updated and a notice goes out only when the flagged set grows or changes. The notices get one new
personal preference, "Leave and cover", on by default, beside the other project notices; no project manager switch.

### Leave review (project manager and coordinators)

A dialog for one project and one leave, opened from the notice or from the Workload tab:

```
Ivan is away Wed 26 – Fri 28 Nov (added by Lemmuel)
3 of 5 tasks need a look                                 [Suggest changes]

Authentication API    Due 26 Nov · 6 h left   Due during leave
  Suggestion: Cover by Keneth until 28 Nov — has Auth, 9 h free      [Apply] [Edit] [Skip]
Login integration     Due 27 Nov · 4 h left   Blocks "Deploy login"
  Suggestion: Move due date to 1 Dec — waits for Ivan, nothing else blocked
Bug fixes             Due 3 Dec · 8 h left    Won't fit (5 h short)
  Suggestion: Keep — 5 h short; ask Ivan or split after he returns
```

- Each action uses an existing path: move due date (task update), reassign (holders), cover (new), keep (nothing).
  Each is applied separately and refused with the existing guards' messages (QA stage, Done, handoff rules).
- A Member never sees this dialog; a team lead sees only what their existing rights let them change.

### AI suggestions

- "Suggest changes" calls `work-ai` with a new action. It sends task titles, statuses, remaining hours, due dates,
  the leave dates, and candidate people as opaque ids with skill tags and free hours (the same rule as Break down
  and balance: no names). Candidates come from the existing room and skill reads, limited to people the caller may
  assign.
- The model returns one move per flagged task — keep, move due date (with a date), cover (person, until the leave's
  end), reassign (person) — and a one-line reason. The server validates each against the candidates and dates and
  drops anything invalid (shown as "No suggestion").
- Rate-limited like the other AI actions. Nothing is saved until the manager applies.

### Temporary cover

- Applying cover, in one transaction: remove the away person from the task's holders, add the cover, and record a
  cover row (task, away person, cover, until = the leave's last day, by whom). Holder rules apply as for any change of
  holders; a refusal saves nothing.
- The task shows "Covering for Ivan until Fri 28 Nov" in the dialog and a small marker on its card.
- When the leave ends (the day after its last away day), the cover and the project manager get "Ivan is back. Hand
  Authentication API back?" with Hand back (Ivan back on, cover off, cover row closed) and Keep with <cover> (closes
  the cover row). If Ivan's leave was extended, the reminder moves with it.
- Done or archived tasks close their cover row silently. History records "covered for" and "handed back".
- *Builder answers (my calls):* cover goes through the same holder rules as any change of holders, with no bypass
  (QA and Done refusals, handoff rules, a team lead's receiving-team limit, and the Open-flow room check for a Member,
  who cannot open the review anyway). A task has at most one open cover row. If someone else changes the task's
  holders before hand-back so the cover is no longer on it, the cover row closes and no reminder is sent. Hand back
  checks the away person can hold the task again and refuses with the holder rule's message if not. A shortened leave
  moves the reminder earlier; an extended one moves it later.

### Leave end and extension

- On a leave's last day, the project manager of each project that was notified gets "Ivan's leave ends today. Extend
  it or confirm he's back." Extend opens Mark away with the dates filled in; confirm does nothing else.
- A daily job (Manila morning, like the other reminders) sends these and the hand-back reminders, once each.
- *Builder answers (my calls):* "end" is the last away weekday. After a best-guess end the person counts as available
  as normal. Extending re-runs the check and moves the "ends today" reminder to the new last day; each last-day value
  is reminded once.

### Away badges and at-risk forecast

- **Away badge:** "Away until Fri 28 Nov" (or "Away today" for part days) next to a person in holder pickers, on task
  holders in the dialog and cards, and on the Workload tab row, for anyone sharing a live work space with them
  (decision 6). A future leave shows "Away 26–28 Nov" in pickers.
- **At-risk forecast:** on a task with an estimate and a due date, "Needs 5 h more than Ivan has before it's due"
  when remaining work exceeds the holders' available hours until due (split as load is split). Shown to planners and
  the holder.
- **Sprint hours:** on a sprint (running or planned), "Team hours 64 h (8 h away) · Planned 70 h" — the available
  hours of the people holding its tasks across the sprint's dates against the sprint's estimated work.
  *My calls:* hours use the project's space; a stream sprint counts its own tasks' holders; unassigned tasks count in
  Planned, not in hours, and are named ("2 tasks have no holder").

## Constraints

- Follow `CLAUDE.md`: tokens only, copy rules, desktop first, reduced motion, `useAuth`, idempotent SQL, a suite per
  SQL file, `anon-lockdown.sql` last, `npm run build` before claiming anything works.
- Reuse existing guards and RPCs for every task change; redefine no existing guard. New SQL goes in a new file after
  `work-workload.sql` and before `anon-lockdown.sql`, listed in `docs/07-backup.md`.
- Planners never read reasons or day-level time off beyond hours; the person's own rows stay theirs to edit.
- Ask before pushing to `main`.

## Phases

1. **Leave and impact:** planner-recorded leave with ranges and `added_by`, the impact check, notices, the review
   dialog with manual actions (move due date, reassign, cover), cover with hand-back, leave-end reminders.
2. **AI and signals:** Suggest changes, away badges, the at-risk forecast, sprint hours.

Each phase ships and is verified on its own.

## Left to the builder

- Table and function names, the notice kinds' names, and where Mark away sits on the Workload tab row.
- Whether the review dialog reuses Break down and balance's layout pieces.
- How a leave is identified in a notice link (for example the person and the leave's first day).
