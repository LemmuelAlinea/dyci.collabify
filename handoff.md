# Collabify — session handoff

**As of** 2026-08-21 · last commit `f1fc9f5` · deployed on
https://dyci-collabify.vercel.app

---

## The goal

Project management for BSIT programs in the Philippines. Roles: student, professor, admin.
Phase 1 (landing, auth, settings) shipped long ago. Phase 2 made a class somewhere work
actually happens.

**This session took the product from "work can be planned" to "work has a lifecycle and
somebody is accountable for it."** The arc, in the order it was built:

1. **Deadlines mean something.** `due_at` was decoration; it now stamps work late.
2. **A professor can close a project** — separately from its deadline.
3. **Work can change hands** when a member goes quiet, with a reason and an approval.
4. **A group hands in**, which freezes their board.
5. **The professor answers** — accepted, or returned to be fixed.
6. **A calendar** lays the term over the syllabus that produced it.
7. **An admin console**: professor approvals, accounts, an audit log.
8. **Analytics** — is this class going to finish, and who is carrying it.

The through-line, and the thing to preserve: **every rule lives in the database**, and every
one is proven by a rolled-back SQL suite that impersonates real users.

## Current state

Working tree is clean apart from this file. `main` is in sync with origin. `npm run build`
passes. **27 commits this session**, all deployed.

- **30 migrations** in `supabase/`, all applied live and all idempotent (each run twice).
- **9 test suites** in `supabase/tests/`, **203 assertions**, all passing:
  reassignments 40 · submissions 28 · deadline-lock 24 · accounts 23 · analytics 22 ·
  audit 22 · results 18 · approvals 15 · calendar 11.

Live data, small enough that every number is checkable by hand:

| | |
|---|---|
| classes | 2 (one dated with a syllabus, one not) |
| projects | 3 |
| tasks | 26 |
| boards handed in | 1 |
| results recorded | 4 |
| reassignments | 1, approved |
| audit entries | 7 |
| professors waiting for approval | **1 — `Astro Bori`** |

**Migration order matters.** Several files redefine the same functions and views wholesale,
so the later file wins. Two rules:

- `task_board_overview` lives **only** in `results.sql` now. `tasks.sql`, `dashboard.sql`
  and `task-points.sql` still hold older definitions, so `results.sql` must run last of the
  four. Before adding a column to it, run
  `grep -ln "create view public.task_board_overview" supabase/*.sql`.
- `submissions.sql` redefines `guard_task_edit`, `guard_task_assignee` and
  `guard_task_unclaim`; `deadline-lock.sql` and `solo-auto-claim.sql` hold older copies.
  Re-running an older file silently removes the submission freeze.

## Files actively being edited

**None.** `f1fc9f5` is complete, deployed and verified. Nothing is half-finished.

The files carrying the most weight, if the next work is nearby:

- `src/lib/types.ts` — the shared vocabulary, and both projections (`projectFinish`,
  `projectBurn`). It has grown a lot; if it grows again, split it by domain.
- `src/components/tasks/ProjectTasksTab.tsx` — still the largest file in the codebase, and
  it grew again. **Split it before adding to it.**
- `supabase/results.sql` — owns `task_board_overview`, so most view work lands here.
- `src/components/app/nav.ts` — every role's rail.

## What failed, and what to carry forward

All of this cost real time. None of it is hypothetical.

### The same mistake twice: one view defined in two files

`project_overview` is `select p.*`, and **Postgres freezes that star when the view is
created.** Adding `locked_at` to `projects` never reached it, so the whole UI read the
column as `undefined` — the Close button never flipped, and because it computed
`!project.locked_at`, **reopening was unreachable**. Enforcement worked the entire time,
because triggers read the table directly. That is exactly why the SQL suite passed while
the feature was broken, and why the user found it rather than me.

Then it happened again. `last_activity` was dropped from `task_board_overview` when
`deadline-lock.sql` redefined it. Nothing failed loudly: `findStalled` read `undefined`,
dated every unfinished board to the epoch, and reported the lot as stalled for twenty
thousand days — **unnoticed for most of the session**.

**Carry forward:** one file owns a view, and after adding a column, check the view really
has it before trusting the UI.

### A test suite that passed with the feature deleted

The first deadline suite "passed" a work-log assertion that was actually being refused by a
pre-existing *"start the task before logging time"* guard. It would have passed with the
entire lock feature removed.

**Carry forward, now the house rule:** every "X is refused" assertion is paired with a
control that does X **successfully**, on the same statement, seconds earlier.

### Verification that lied

- Grepping the live bundle for a string that **already existed** in the previous build
  reports "live" too early. Grep for a string unique to *this* change.
- Grepping a **stale bundle name** returns the SPA fallback at HTTP 200, so every string
  reads MISSING and looks like a failed deploy. A real bundle is about 1 MB; the fallback is
  about 1.5 KB.
- **A matching bundle hash proves nothing.** `core.autocrlf = true` with no `.gitattributes`
  means the working tree is CRLF and the committed blobs are LF, so a Windows build and
  Vercel's Linux build compile different bytes. It matched several times by luck, then
  stopped. For a change with no new strings, the honest check is that the bundle **differs**
  from the pre-change one.
- `str.replace` in a patch script **fails silently** when the anchor does not match. Three
  handoff sections were lost that way before I started asserting the anchor.
- A large heredoc breaks the Bash tool. Use the Write tool for big content.

### Claims I made that were wrong

- **"Announcement attachments have no UI."** They are fully built — `FileDrop`, a staged
  list, upload-with-rollback, `AttachmentRow`. My grep looked for `announcement_attachments`
  and `AnnouncementAttachment`; the component uses neither name.
- **"Task file upload is unverified."** It works, and had for sessions — three real files,
  each with a matching storage object.

**Carry forward:** open the file before reporting something missing.

### Built, then deleted at the user's request

A **Files page** and a **group drive** were built, shipped and removed the same day: file
handling does not belong in this product when students and professors already use tools they
trust. Reverted `d2932f3` and `7984346`; the `group-files` bucket was deleted after
confirming it held nothing. **Do not propose either again** unless the user raises it.

### Fixture traps that will bite again

- The fair-share cap refuses a fixture that gives one student too much — widen the board
  with filler tasks.
- Only the people on a task may attach files to it, so a fixture must claim before it
  uploads.
- `guard_task_edit` pins `late` back, so a plain `update` to backfill it is a silent no-op.
- `now()` is *transaction* time. Two rows written in one transaction tie, and "the latest"
  becomes whatever the planner returns. `clock_timestamp()` is what makes it meaningful.
- A `CASE` or `UNION` branch resolves its literals as **text** before meeting an enum
  column. Cast explicitly.
- Analytics views are scoped to the class's professor, so a fixture reading them must
  `act_as` that professor — service role sees nothing.

## Project creation now demands a brief and a rubric

`ProjectForm` refuses to submit without a name, non-empty guidelines, and at least one
criterion — and refuses a half-filled criterion in either direction (points with no name,
or a name worth nothing). One `ProjectWizard` serves the projects page, the class projects
tab and the edit path, so all three got it from one change.

A refused save scrolls the modal back to the message. The scroll lives in the failure
handler, **not** an effect on the message text — pressing save twice on the same mistake
leaves that text unchanged, so an effect keyed on it would not fire the second time. That
case is the one worth keeping in mind if this is ever refactored.

**This is form-level, not a database constraint, and that is deliberate.** Criteria are
written after the project row exists, so no simple check can see them at insert time. A
`check` on `guidelines` was also left out: **all three existing projects have empty
guidelines and zero criteria**, so a constraint would have refused rows that are already
there.

The consequence to know: those three legacy projects now cannot be saved through the wizard
until a brief and a criterion are added. That was accepted rather than worked around — it
is the same nudge the rule exists for. `total_points` and `project_criteria` had never been
used by anyone, which is why the numbers were meaningless.

## Analytics

`/professor/analytics`. `supabase/analytics.sql` holds four views —
`class_pace`, `class_gaps`, `class_health`, `class_member_load`, plus `board_burn` and
`task_state`. **No new tables or columns.**

**Filtering cascades:** class → project → group → student → task, each narrowing the next,
and choosing higher up clears everything below. Not five free dropdowns — most free
combinations return nothing, and an empty page then reads as "nothing there" when it means
"impossible question". `FilterChain.tsx` owns the whole chain; the page only reads `Scope`.

**Two projections, one function.** `projectFinish` (syllabus weeks) and `projectBurn`
(tasks per day) both live in `types.ts` so they cannot drift. Burn is measured from when a
board *actually started*, not when the project was set — a group idle for a fortnight then
working hard is moving at the rate they are moving now.

**`not_started` is its own state, not a rate of zero.** Zero a day reads as slow; a board
nobody has opened is a different problem with a different fix. Keep them apart. 16 assertions in `supabase/tests/analytics.test.sql`, including a pace figure
checked against a hand computation on a fixture with known week spans.

**"Predictive" here means arithmetic, and the arithmetic is printed on screen.** *"2 of 18
weeks covered in 4 weeks — 0.5 a week. The remaining 16 would take about 32 weeks, and 19
are left in the term."* Decided with the user: one class, one work-log row and four graded
results is not enough to train anything, and a model would have to be discarded once real
history existed. **Do not replace this with a model until several terms have completed.**

**A leak the suite caught, worth understanding before touching these views.** `class_gaps`
and `class_pace` both count what is *absent*. A student cannot see an unreleased project,
so without scoping they read a gap list of weeks the professor had in fact already set —
wrong, not just private. **A negative measurement is only true for somebody who can see
everything it measures**, so every view is scoped with `is_class_professor`.

`findStalled` in `src/lib/api/dashboard.ts` is the intended source for stalled boards and
depends on `last_activity`, which was silently missing for most of this session.

Effort only — no verdicts or feedback. Grading lives with the work; analytics answers who is
doing it. `CARRYING_ALONE_PCT` in `types.ts` is the one threshold on the page.

## Accounts

`/admin/accounts`, admin only. `supabase/accounts.sql`: `set_account_role`,
`set_account_active`, and the `account_overview` view. 23 assertions in
`supabase/tests/accounts.test.sql`.

**There is no delete, and that is the design.** `classes.professor_id` is
`on delete cascade`, along with seventeen other columns on `profiles` — deleting one
professor's row today would take 1 class, 3 projects, 26 tasks, 4 files and 16 enrolments
with it, irreversibly. Deactivating covers every honest reason to remove somebody. **Do not
add a delete button here**; if a row genuinely must go it should stay a deliberate database
operation.

Two guards that are easy to remove by accident and should not be:

- **A promotion lands the account `pending`**, so a new professor still meets the same check
  as one who signed up. A promotion is not a verification.
- **A professor still holding a live class cannot be demoted** — a class with no professor
  is unreachable to everyone in it. Hand it over or archive it first.

Also refused: promoting anyone to `admin` (that stays on the command line), and an admin
changing or deactivating themselves.

Both changes are audited for free — `log_profile_change` watches the columns rather than
the caller, so anything done here lands in the log.

**Worth reconsidering separately:** the `on delete cascade` on `classes.professor_id` is
live regardless of this page. Any route to a professor's row — the Supabase dashboard, a
stray statement — carries it. `on delete restrict` would force a hand-over first.

## Audit log

`/admin/audit`, admin only. `supabase/audit.sql`: `audit_events`, the `audit_action` enum,
two trigger functions, and the `audit_log` view. 22 assertions in
`supabase/tests/audit.test.sql`.

**The design is what it leaves out, and this is the thing not to erode.** An admin already
reads every profile and class and reads **nothing** of projects, tasks, comments, files,
messages, submissions, verdicts or reassignment reasons — verified empirically as the real
account, every academic table returning 0 rows. The log records administrative acts only:
account created, role changed, status changed, and class created/archived/restored/handed
over/deleted. **No academic content, not even a derived count.** The suite asserts the enum
itself has no label that could name one, so widening it means noticing.

Two rules hold it up, both tested by trying:

- **No insert policy at all.** Entries come only from `security definer` triggers, so no
  client can forge one — not a student, not the admin.
- **No update or delete policy for anybody.** A log its own subject can rewrite is worth
  nothing. The admin's edit and delete are both silently no-ops.

It watches the **columns**, not the caller, so a role change is caught whether it came from
the approvals console, `scripts/set-role.mjs`, or a hand-written update. The trigger is
`after`, not `before`, so a change `guard_privileged_columns` pins back is never logged as
though it happened.

**An unrelated narrowing shipped with it:** an admin could read every user's
`notification_prefs` — personal settings with no administrative purpose. Every read in the
app is already scoped to the signed-in user, so nothing broke. `prefs_select_own` is now
`user_id = auth.uid()` alone.

## The third role is `admin`, not `superadmin`

Renamed everywhere — the `user_role` enum, `is_superadmin` → `is_admin`, every source file,
`scripts/set-role.mjs`, and the docs (`docs/05-superadmin.md` → `docs/05-admin.md`). Same
powers, shorter name. `supabase/admin-rename.sql` does the database half, idempotently.

Worth remembering if another enum label is ever renamed: **a function body is stored as
text.** `role = 'superadmin'` inside one is an untyped literal cast at execution, so the
moment the label changes it stops matching and starts raising. The enum rename does not
reach inside function bodies, and neither does a call by name — both had to be rewritten
(`is_admin`, `guard_privileged_columns`, `decide_professor`).

**Policies were the exception**: they hold the function's OID, so all four —
`classes_select`, `prefs_select_own`, `profiles_select_own`, `profiles_update_admin` —
followed the rename untouched. Confirmed after the fact rather than assumed.

## Professor approvals

`/admin/approvals`, admin only. A professor signs up, lands `pending`, waits at `/pending`;
nothing in the product could move them on, so the only route was editing the row by hand.

**No security rule was loosened.** `profiles_update_admin` already let an admin write and
`guard_privileged_columns` already pinned `role` and `status` back for everyone else — that
guard *silently reverts* rather than raising, so the suite asserts the resulting value, not
an error. `supabase/approvals.sql` adds `decide_professor(uuid, boolean)`, the
`professor_accounts` view, and `profiles.decided_by` / `decided_at`.

Rejection is reversible in both directions, deliberately: a mistaken rejection otherwise
leaves a real professor with an unusable account and no way to appeal from inside the
product.

`supabase/tests/approvals.test.sql`, 15 assertions — including that a professor cannot
approve another, and that the pending account cannot wave itself through.

**Copy worth revisiting:** `Pending.tsx` tells the professor *"You'll get an email the moment
it's approved."* Brevo SMTP is still off, so no email is sent. They have to sign in again to
find out.

## Results

The work used to end in silence: hand in, deadline passes, professor closes it, nothing
recorded. A group that did everything and one that did nothing both finished on
"handed in". `supabase/results.sql` gives a board an answer — **accepted**, or **returned**.

**Returning is not a second state.** It un-submits the board, which unfreezes it, which is
exactly what "fix this and hand it in again" means. Accepting leaves it submitted, so it
stays frozen. That reuse is the reason there is no new freeze logic anywhere.

**Deliberately no score**, decided with the user: a number here would be a second grade
record beside the school's, and the one here would not be the one that counts. `total_points`
and `project_criteria` remain unused — that is not an oversight.

Two rules worth keeping: a **return must carry a reason** (a check constraint — a return
with no reason is a rejection slip, not a response), and results **only ever arrive through
`record_board_result`**. There is no insert policy at all, so neither a student nor the
professor can write a row that leaves the board out of step with it. Both tested.

A student's project card now shows four states apart: still going, **handed in and
waiting**, **accepted**, **returned**. The answer sits above the progress bar — once a
project is accepted, how far its tasks got is not what anyone is scanning for.
`task_board_overview` carries `result_verdict` / `result_at` so the card, which already
receives a `BoardSummary`, needed no extra query.

`supabase/tests/results.test.sql`, 18 assertions. A real bug the suite caught: `decided_at`
defaulted to `now()`, which is *transaction* time, so two answers in one transaction tied
and "the latest" became whatever the planner returned. It is `clock_timestamp()` now.

## Milestones — decided against

The `Milestones` nav placeholder came from the original landing-page pitch: a capstone
defense track, title defense → final defense with an adviser sign-off gate. **The product
outgrew it** — every project ever created is one week long and `capstone` has never been
used. The gap it pointed at was really "there is no verdict on work", which Results now
fills. The placeholder is still in the student rail; the user has not asked to remove it.

## Files and the group drive — built, then removed

Both were built and taken back out the same day, at the user's decision:
**file handling does not belong in this product.** Students and professors already use
tools they trust for files, and a second home here only competes with them.

Removed: the Files page for both roles, `file_overview`, `group_files` and its view,
functions, storage policies, and the `group-files` bucket. The drive never held a row or an
object, so nothing was lost. `git revert` of `d2932f3` and `7984346` did the source cleanly.

**Do not propose either again** unless the user raises it. If something similar comes up,
the reasoning to remember is theirs: a file store here duplicates tools people already have.

**What deliberately stayed**, and why — none of it is file management:

- **`task_files`** — attaching a deliverable to a task is how a board's work is evidenced.
  It drives `canChangeFiles`, the submission freeze and the professor's view of what a group
  handed in. 4 real rows.
- Project brief attachments, announcement attachments, syllabus and curriculum uploads.

The student rail lost its `Files` row **entirely** rather than reverting to `soon: true`,
since a placeholder promises something now decided against.

A duplication this cleared up: `formatBytes` already lived in `components/ui/FileDrop.tsx`
and is used by announcements, messages, projects and resources. A second copy had been added
to `lib/types.ts`; removing the files feature took it with it.

## Calendar

`/student/calendar` and `/professor/calendar`. Spec at
`docs/superpowers/specs/2026-08-19-calendar-design.md`.

**No schema change** — everything dated already existed. `supabase/calendar.sql` holds one
view, `calendar_events`, unioning project deadlines, scheduled releases, task deadlines and
board submissions.

The thing to understand before changing it: **the view has no role logic in it.** It is
`security_invoker`, so a student sees their own board's tasks and nothing at all of an
unreleased project purely because their own policies say so. That is why it cannot drift
out of step with the policies, and it is asserted directly —
`supabase/tests/calendar.test.sql` runs the same query as four different people and checks
they get different answers. 11 assertions.

The professor's query drops `task_due` server-side (`.neq`). Sixteen students holding nine
tasks each is 144 chips in a month, and none are the professor's to act on. **That is the
query choosing, not the view enforcing** — RLS would allow it.

**Syllabus weeks are the spine, not events.** `class_week_map` already computed
`week_start`/`week_end`/`phase`; each month row carries its week's title and `assessments`.
The point is a week that names an assessment with nothing set against it, which reads as
the gap it is.

Deliberately left off, and worth not "fixing" later: `polls.closed_at` and
`group_sets.closed_at` record when a thing *was* closed, like `locked_at` — state, not a
scheduled deadline. Task events and work-log entries are history, which is the activity
feed's job.

Still wanted, not built: **iCal subscribe.** It needs a tokenised per-user URL readable
without a session, which is its own security decision.

## Handing in a project

Finishing every task and finishing the project were the same thing; now they are not.
`project_boards.submitted_at` / `submitted_by` is the group's own word that they are done,
and it freezes their board.

**Three levels, undone by different people — do not collapse them:**

| | Set by | Taken back by |
|---|---|---|
| `project_tasks.status` | whoever holds the task | them |
| `project_boards.submitted_at` | any member of that board | any member, while the project is open |
| `projects.locked_at` | the professor | the professor |

The professor's close outranks the submission. The professor can also unsubmit one board
without reopening the whole project, which is how a single group gets to fix something.

Decisions the user made: reversible until the professor closes it; submitting with
unfinished tasks is allowed but the dialog says how many; any member may press it and the
name is recorded.

`supabase/submissions.sql`, 28 assertions in `supabase/tests/submissions.test.sql`.
**Comments stay open through submission and through the lock** — that is deliberate and
tested, and it is the one thing not to "tidy up" later.

`task_board_overview` now lives only in `submissions.sql`. It used to be redefined in
`deadline-lock.sql` too, and two definitions of one view is exactly how a column goes
missing — whichever file ran last silently won.

## Reassignment requests

`Reassignments` is no longer a `soon:` placeholder. The problem it solves: a started task
could not move off whoever held it, because `guard_task_unclaim` refuses the delete and
nobody was exempt. A member who claimed work, started it and went quiet held it for good,
and their groupmates were marked against a project that could never complete.

Decisions the user made:

1. The requester proposes — *take it on* or *release it to the group* — and the professor
   confirms or overrides.
2. Both directions, one mechanism: take over someone else's, or hand back your own.
3. The reason reaches the professor and its author. **Not the holder.**
4. No reply window; the professor messages the student if they want their side.

`supabase/reassignments.sql` holds it all: `task_reassignments`, a partial unique index for
one live request per task, a guard trigger, `decide_reassignment`, `withdraw_reassignment`,
and `reassignment_overview`. 40 assertions in `supabase/tests/reassignments.test.sql`.

Three things worth knowing before changing it:

- **Status only ever moves through the two functions.** There is deliberately no update or
  delete policy — one wide enough to let a student withdraw their own would also be wide
  enough to let them approve it. The suite checks an insert claiming `status: 'approved'`
  still lands pending.
- **The move reuses `collabify.releasing` / `collabify.restoring`** rather than weakening
  the guards. That also skips the fair-share cap, which is intended and tested: refusing a
  professor's ruling because the receiver is near their share would be the wrong answer.
- **An individual project refuses requests outright** — one owner, nobody to hand to.

## Two bugs the user found by clicking

**Every relative date in the app was off by one.** `dueSoonLabel` and `dueLabel` both did
`Math.ceil((due - now) / DAY)`. `Math.ceil` of a deadline that passed nine hours ago is
`-0`, which is neither `< 0` nor distinguishable from `0`, so anything under a day overdue
announced itself as "Due today". The same rounding called a five-day gap six and a deadline
later this evening "tomorrow". Five of six representative cases were wrong. Both now bucket
by calendar day via `calendarDaysUntil`, and decide overdue with `hasPassed` — the actual
moment, since a deadline is a time and not a date.

**An individual project's tiles could not be opened.** The selected board was found with
`boards.find(b => b.group_id === filters.group)`, and every board on an individual project
has `group_id = null`, so no tile on one was ever selectable and the Board view was
permanently stuck on "Open a group above". The filter state is now keyed on `board`, which
works for both kinds of project. `task_board_overview` grew `student_name` so a solo tile
can say whose board it is.

## What is verified, and what is not

**Confirmed working by the user on the live app:**

- Closing a project, and a student then unable to edit their tasks.
- The late stamp — their Summary showed *"9 handed in late"* after finishing work past a
  moved deadline.
- Professor approvals: four `accepted` decisions are in the database under their name.
- **The reassignment path, end to end.** One request exists, `release`, reason *"Di kaya"*,
  approved and decided. This was listed as unexercised for most of the session; it is not.

**Proven in SQL against real users, but never clicked end to end:**

- **Submission** — hand in, the board freezes, comments still work, take it back. One board
  is currently submitted, so the first half has happened.
- **Results** — accept and return. Four `accepted` rows exist, but no `returned` one, so the
  un-submit path has never actually run outside the suite.
- `TaskFileGrid` showing *"Locked — the project is closed"*.

**Never exercised at all:**

- AI task generation against a real project.
- The inline PDF preview. All real task files are images, so the PDF branch is unproven.

**Waiting on the user, unchanged:**

- The Anthropic API key pasted into chat early in the project is still unrotated.
- Brevo SMTP is not configured, so email confirmation is off in Supabase and must be turned
  back on before real use. `Pending.tsx` still promises a professor *"You'll get an email the
  moment it's approved"*, which is currently untrue.
- `assets/dyci-logo.png` was committed by an over-broad `git add -A`. Harmless.

## The next step I would take

**A class with no term dates is invisible to analytics, and says nothing about why.**

This is live right now. The professor created **ITP · Introduction to Programming** with no
`term_start`, no `term_end` and no syllabus. `class_pace` requires all of them, so the class
is simply absent — the professor sees one class on a page that should show two, with no
explanation. Verified through RLS as them: two classes visible, one row in `class_pace`.

It is the smallest, most concrete thing on the list, and it is a gap the user will hit
themselves within minutes of opening the page:

- Show undated classes on the analytics page with *"set this class's term dates to measure
  its pace"*, linking to the class page.
- The same for a class with no syllabus — a pace against nothing is meaningless, and saying
  so beats vanishing.

**After that, in order of how much they are worth:**

1. **`on delete cascade` on `classes.professor_id`.** Deleting one professor's row destroys
   1 class, 3 projects, 26 tasks, 4 files and 16 enrolments. This is live regardless of the
   Accounts page — the Supabase dashboard carries it too. `on delete restrict` would force a
   hand-over first, which is what anyone would want. **Ask before changing a constraint.**
2. **A `.gitattributes` with `* text=auto eol=lf`.** Would make local and Vercel builds
   byte-identical and restore hash-matching as a deploy check. Touches every file's line
   endings, so it is the user's call.
3. **Split `ProjectTasksTab.tsx`.** It has been the largest file for three sessions and grew
   again in this one.
4. **iCal subscribe for the calendar.** Wanted, deliberately deferred: it needs a tokenised
   per-user URL readable without a session, which is its own security decision.

**Do not build without asking:** auto-closing a project when its deadline passes. It quietly
reverts the "record late, do not block" decision the user made deliberately, and the honest
version is a per-project opt-in rather than a default.

---
---

# Session 2 — 2026-08-27

**As of** 2026-08-27 · last commit `d459476` · `main` in sync with origin ·
43 commits this session, all pushed.

---

## The goal

Session 1 gave the product a lifecycle. **This session was about making the product
defensible** — first against a formal quality standard, then against the ordinary ways a
web app disappoints people.

Two halves, in the order they happened:

1. **ISO/IEC 25010:2023, phase by phase**, riskiest first, at the user's request. Every
   phase measured before and after; the numbers became a 17-page PDF.
2. **Everything the user found by using it** — mobile card sizes, stale pages, dead
   notification switches, no rate limiting, announcements that never expire.

The through-line from session 1 holds and got stronger: **every rule lives in the
database, and every one is proven by a rolled-back SQL suite that impersonates real
users.** The suites went 203 → **435 assertions**.

---

## Current state

Working tree clean apart from this file. `npm run build` passes, `npm run check` passes
(0 errors, 23 warnings — all in two documented categories, see below).

|  | session 1 | now |
|---|---|---|
| migrations in `supabase/` | 30 | **41** |
| test suites | 9 | **18** |
| SQL assertions | 203 | **435** |
| JavaScript tests | 0 | **79** |
| linter | none | ESLint, 0 errors |
| CI | none | `.github/workflows/check.yml` |
| first-visit download | ~333 KB | **219 KB** |
| `dist/` total | 2,953,103 B | **1,332,038 B** |

**The 23 lint warnings are deliberate and documented in `eslint.config.js`:** 18
`react-refresh/only-export-components` (files exporting a helper beside a component), 4
`react-hooks/purity` and 1 `immutability` (reading the clock during render to decide
whether a deadline shows as overdue — moving it to state would freeze the answer at
mount). `set-state-in-effect` is switched **off** with the reason written next to it: it
fired 56 times on the `useEffect(() => { void load() })` pattern, which is how all
thirty-odd pages fetch.

### What was built, in order

**ISO phases**

- **A — Reliability + Safety.** `ErrorBoundary` in two places, `onRetry` on 8 pages, an
  offline bar. `on delete restrict` on `classes.professor_id` and `projects.created_by`
  (this was session 1's top recommendation; the user approved it).
- **B — Performance.** 33 lazy routes, `manualChunks`, a 1.7 MB logo resized to 39 KB by
  `scripts/resize-png.mjs` (written rather than adding an image dependency). Query work:
  `class_actions` 421.8 → 116 ms, `class_participation` 133.2 → 8.9 ms, `board_diagnosis`
  91.9 → 4.5 ms — all by replacing correlated laterals with grouped joins.
- **C — Interaction.** `scripts/contrast.mjs` found 3 real failures, now 0. Focus trap and
  focus restore (`src/lib/focus.ts`), skip links, a `--control-line` token,
  `scripts/a11y-names.mjs`.
- **D — Maintainability.** 79 Vitest tests, ESLint, CI, and `ProjectTasksTab.tsx` split
  582 → 67 lines across five files. (Skipped at first, done later on request.)
- **E — Compatibility.** Browser floor measured from the built CSS — **Chrome/Edge 111,
  Safari 16.4, Firefox 128** — declared in `browserslist`, with a `CSS.supports` gate in
  `index.html`, because below the floor the page does not degrade: `oklch()` and
  `color-mix()` fail to parse and every colour resolves to nothing.
- **G — the PDF.** `docs/iso-25010-report.html` → `Collabify-ISO-25010-report.pdf` via
  `scripts/report-pdf.mjs` (headless Chrome). 17 pages.

**Then, from use**

- **Mobile card sizing**, three passes. First: padding plus two-up class cards. Second:
  group, project and analytics cards. Third: **container queries**, so a card sizes by its
  own width — one on a row keeps its full size, two share a row and go compact.
- **The calendar fits a phone** — dots instead of chips below a 720px container, tap a day
  to open it underneath with its syllabus week.
- **`useLive`** on all 32 data-loading places: realtime, focus, visibility, poll.
- **Every notification switch made real** — 3 of 6 controlled nothing; `pg_cron` installed
  for deadline reminders and the weekly digest.
- **Rate limiting** on 20 surfaces (`supabase/rate-limit.sql`). None existed before.
- **24-hour windows** on program notices *and* class announcements.
- **Two dialogs** (notices composer, sections) and a hideable page description.
- **The evaluation questionnaire** — 59 items, black only, as PDF and Word.

---

## Files actively being edited

**None.** `d459476` is complete, pushed and verified. Nothing half-finished.

New files worth knowing about:

- `src/hooks/useLive.ts` — the one mechanism keeping every page current. Caps realtime
  channels at 12 per tab.
- `src/lib/focus.ts` — `useFocusTrap`, used by `Modal` and `FilterPopover`.
- `supabase/rate-limit.sql` — the counter, a trigger factory, and 11 triggers.
- `supabase/notifications.sql` — every switch's trigger or scheduled job.
- `supabase/live.sql` — the realtime publication, 27 tables.
- `supabase/class-notices.sql` — the 24-hour policy on `announcements`.
- `scripts/` gained `contrast.mjs`, `a11y-names.mjs`, `schema-drift.mjs`,
  `resize-png.mjs`, `report-pdf.mjs`, `questionnaire-docx.mjs`.

Still carrying weight: `src/lib/types.ts` (1,473 lines — **split it by domain if it grows
again**), `supabase/results.sql` (owns `task_board_overview`).

---

## What failed, and what to carry forward

All of this cost real time. None of it is hypothetical.

### The environment lies about anything visual

The preview pane reports `visibilityState: "hidden"` and does not composite frames. This
misled three separate measurements before the pattern was recognised:

- **CSS transitions never advance.** `getComputedStyle` returns the pre-transition value
  forever, so a working animation reads as broken. Read the *inline* style, or inject
  `transition: none` and re-measure.
- **`:focus` does not match** even when the element is `document.activeElement`, because
  the window is not focused. Send a real `Tab` with the `computer` tool instead.
- **Screenshots are unavailable.** Every visual check has to become a measurement.
- **Anything guarded on `visibilityState === 'visible'` never fires.** Override the
  property to test it, then restore it.

Also: the console buffer persists across navigations in a tab. Stale errors from a deleted
probe route look like live failures — open a fresh tab to check.

### Tailwind compiles only whole class names

`const WIDE = '@min-[720px]:'` composed as a template string produced **no CSS at all**,
so the desktop calendar silently kept the phone layout. It surfaced only because the
1280px case was measured rather than assumed. Never build a class name by concatenation.

### A function name that was almost right

Wrote `notify_project_release`; the trigger calls `notify_project_released`, past tense.
Result: a second, unused function, the original still running on the wrong switch, and no
error anywhere. The test caught it. Same family as session 1's "one view in two files".

### A default that caused the same bug twice

`audience` defaulted to `mine` on `ProjectCard` / `ProjectsBoard`, so a professor was told
their own work was "accepted by your professor" — fixed on the projects page in one
commit, then found again inside the class projects tab. **The prop is now required**, and
making it required immediately exposed a third caller relying on the default. When the same
bug appears twice, remove the default rather than fixing the second call site.

### Two-up is not the same as smaller

Halving a card's width made it *taller* — the project card reached 339 px because every
line wrapped. Column count and content have to change together: the class line drops to its
initial, the week's assessment goes, the deadline loses its timestamp.

Related: `1fr` will not shrink below content width. Use `minmax(0, 1fr)`, which is what
Tailwind's `grid-cols-N` already is.

### Scoping a rule too widely

`[&>*:only-child]:col-span-2` made a lone card span two of three **desktop** columns —
715 px, bigger than it had ever been. Scoped to `max-sm:`.

### A refused statement takes its own counter back

The rate-limit increment shares the transaction with the work, so a failed statement rolls
it back. Fine for load; **exactly wrong for guessing a class join code**, where the
failures *are* the attack. Joining is therefore limited inside `join_class`, which answers
a wrong code with a verdict rather than raising, so the transaction commits and the guess
counts.

### A checker that crashed during normal work

`a11y-names.mjs` reads `git ls-files`, which still lists a file deleted but not yet staged.
It crashed and silently skipped its line in `npm run check`. A checker that falls over
mid-change is a checker people turn off.

### Measurements that were wrong until checked twice

- **The first a11y scanner reported 14 failures, all false** — it stripped `{expr}` as
  empty, and `onClick={() => x}` contains a `>` that ended the opening tag early.
- **"Zero focus rules in the stylesheet"** — a global `:focus-visible` already existed at
  `index.css:104`.
- **"`project_tasks.late` violates 3NF"** — 18/18 rows matched `done_at > due_at`, but that
  was a coincidence of current data. It is stamped against the *project* deadline as it
  stood at completion, and four triggers pin it. A historical fact, not a derivation.
- **`textContent` counts `display: none` nodes.** Twice it "proved" hidden content was
  visible. Walk the DOM and skip hidden elements instead.

### Optimisations that measured worse

`distinct on` with a window count would not hash-join and ran 78 ms × 20 boards inside
`class_actions`. A plain `GroupAggregate` does. Recorded in the file so it is not tried
again.

### Test fixtures that broke on live data

- `reports.test.sql` asserted week 8 was uncovered; a real project was set across week 8
  during the term. It now asks the view for an empty week and uses that same week for its
  control.
- Profiles inserted directly get no `notification_prefs` row, so every gated notification
  silently skipped them — every gate is an inner join. Fixed with a trigger on `profiles`
  itself plus a backfill; the row was previously created only by a trigger on `auth.users`.

### SQL quoting

Nesting `$$` inside `do $$ ... $$` ends the outer block at the first one. Use `$fn$` and
`$outer$`. Long bash heredocs containing SQL and Markdown are fragile — write the file with
the editor tools instead.

---

## What is verified, and what is not

**Verified:** 435 SQL assertions across 18 suites; 79 JavaScript tests; the documented
schema chain runs end to end twice, clean; contrast 0 failing pairs; 0 unnamed icon
buttons; no sideways scroll at 360/390/768/1024/1440; `useLive`'s four triggers each fire;
realtime channels subscribe; RLS still holds on all 27 published tables.

**Not verified, and it is the same gap every time:** anything needing a **signed-in
session**. Reaching a dashboard, a class page, a project board, the reports page or a real
dialog needs a password this environment does not have. Components were rendered with
fabricated props through throwaway `/__probe` routes — always created and deleted inside
the same commit — but no page was seen with live data.

**Also unverified:** the two `pg_cron` jobs firing (the first digest is a Monday); the edge
functions returning 429 (needs `supabase functions deploy generate-tasks parse-syllabus`);
a real print preview of a report; Safari, Firefox and Android.

---

## Outstanding owner decisions

The user's to make, stated rather than quietly carried:

1. **The Anthropic API key is still unrotated.** Named as residual risk in the PDF.
2. **Email confirmation is off**; outbound mail is not switched on. The UI no longer
   promises otherwise.
3. **Auth rate limits are not set.** Sign-in, sign-up and password reset never reach
   Postgres, so they cannot be limited from the schema — the exact dashboard values are
   written into `supabase/rate-limit.sql`.
4. **Backup retention is still blank** in `docs/07-backup.md`, and no backup has ever been
   taken by hand.
5. **Encryption of private columns** — the last conversation of the session. The user saw
   message bodies in the Supabase dashboard (which bypasses RLS by design, and is not a
   leak) and asked about hashing. Hashing is one-way and would destroy the data;
   encryption needs a key that cannot live in the database. **The open question, put to
   them and not yet answered: what are you defending against — a curious classmate, a
   panel question, or someone with your database password?** Only the third argues for
   encryption, and real protection means end-to-end in the browser, which would break
   notification previews, the AI features and search.

Tables holding genuinely private content, if that work starts: `messages.body`,
`task_comments.body`, `notifications.title/preview` (**178 rows, carrying copies of comment
bodies — the one nobody thinks of**), `profiles.email` and names, `board_results.feedback`,
`task_reassignments.reason/decision_note`, `audit_events.before_value/after_value`,
`task_worklog.note`.

---

## The next step I would take

**Click through the app signed in, on a phone.** It is the only real gap. Everything this
session was verified by measurement or by rendering components in isolation, and the things
most likely to be wrong are exactly the ones that need a session: the professor's project
card with a real accepted board, the reports picker with real reports, the notices and
sections dialogs, the tasks tab after its split, and the calendar with real events.

**After that, in order of what they are worth:**

1. **`docs/09-normalisation.md`.** The schema is in 3NF except in four places, each
   deliberate: `group_members.set_id` and `poll_votes.poll_id` hold enforceable constraints
   that cannot exist otherwise (a unique index cannot join), and
   `notifications.title/preview` and `project_tasks.late` are point-in-time records that
   must not change when their source does. A panel will ask. "It is 3NF except here, and
   here is why" reads as design; "we normalised everything" reads as a rule followed
   without thinking.
2. **Deploy the two edge functions**, so the AI rate limits are live rather than defined.
3. **Set the five auth rate limits** in the Supabase dashboard.
4. **Answer the encryption question** above before building anything for it.
5. **Fill in the backup retention line**, and take one backup by hand.

**Do not build without asking:** column encryption (see 5); auto-closing a project when its
deadline passes (still true from session 1); and anything that makes a notification a
person is waiting on subject to a preference switch — the rule established this session is
that **anything somebody asked for, or has to act on, arrives regardless of their
settings.**


---
---

# Session 3 — 2026-08-30

**As of** 2026-08-30 · last commit `fa79c4f` · `main` in sync with origin ·
2 commits this session, both pushed and deployed.

---

## The goal

One question from the user, and the whole session is its answer:

> A professor teaches the same course to four sections. Creating a project only ever
> assigned it to one class, so the same project had to be built four times and edited
> four times.

**A project can now be set for several sections at once, and every change afterwards is
scoped to the sections you choose.** The scenario that shaped the design was theirs: one
section asks for an extension, and the other three must be left exactly as they are.

---

## Current state

Working tree clean apart from this file. `npm run build` passes, `npm run check` passes
(0 errors, 23 warnings — the same two documented categories as session 2, none new).

|  | session 2 | now |
|---|---|---|
| migrations in `supabase/` | 41 | **42** |
| test suites | 18 | **19** |
| SQL assertions | 435 | **479** |
| JavaScript tests | 79 | 79 |

The whole 42-file rebuild chain was run in order against the live database, then every
suite: 479 assertions, none failing.

---

## How a series works

**The row stays per class.** `projects.class_id` is untouched and still single. A series
is a nullable `projects.series_id` shared by siblings, so every board, task, submission,
result, calendar event and analytics view keeps working exactly as before — each section
still has precisely the project row it already had. `series_id is null` is an ordinary
one-class project, which is every project that existed before this.

That is also **why the extension case works at all**: 9A's `due_at` is its own column on
its own row, so moving it cannot touch 9B. Every function takes the sections to act on as
an explicit `uuid[]`, never "the whole series".

`supabase/project-series.sql` holds all of it — the column, two views, and six functions:
`create_project_series`, `update_project_series`, `set_series_due`, `set_series_locked`,
`set_series_archived`, `release_series_now`, plus the `series_targets_check` helper.

Four decisions worth not undoing:

- **Nothing is `security definer`.** `projects_write` already says a professor may only
  write their own classes, so RLS is the enforcement and these run as the caller. The
  `is_class_professor` checks inside exist for the *message*, not the rule. The suite
  proves it by trying: another professor, and a student, are refused.
- **A fan-out is one transaction.** If any section refuses — a syllabus without those
  weeks, a group set from the wrong class — none are written. Half a fan-out leaves a
  professor with two sections holding a project, two not, and no record of which.
- **`audience` and `group_set_id` never propagate.** A group set belongs to one class
  (`group_sets.class_id`), so one value could not span sections even in principle. Each
  section names its own arrangement at creation and changes it on its own project.
- **A single section carries no series.** Creating for one class writes an ordinary
  project with `series_id` null, so a scope picker never appears in front of somebody
  with nothing to scope.

**The edit scope defaults to this section only, not all of them.** Deliberate: the
damaging mistake is the one that quietly reaches three sections that asked for nothing —
and a shared edit carries `due_at`, so an "apply to all" default would silently undo an
extension granted the day before. "All 4" is one press.

**The deadline has its own button** on the project page rather than living only in the
edit form. Moving one section's deadline is the commonest thing done to a series, and the
form would put four other steps in front of it — every one of which would then be saved
to whatever sections were in scope.

### The UI

- `components/projects/SectionPicker.tsx` — create-time. The class already picked is the
  first section and cannot be unticked. Other sections of the same course (same initial,
  semester and school year) are offered first, the professor's remaining classes behind a
  disclosure. A section with **no syllabus** is disabled; a section on a **different**
  syllabus is offered with a warning, because week 5 is then a different topic — a
  judgement, not something to refuse. In group mode each ticked section picks its own set.
- `components/projects/SeriesScope.tsx` — the checklist, used by both the edit modal and
  the action dialog. Each row shows that section's real deadline and lock state, because
  it is the last thing seen before something is overwritten.
- `components/projects/SeriesActionDialog.tsx` — close/reopen, archive/restore, publish
  now, and change the deadline, each asked once: which sections, then do it.
- `ProjectCard` says **"1 of N sections"**, counted client-side from the projects the
  board already holds — no extra query, and no column added to a view three files define.
- The project page header says which other sections it is set for.

---

## What failed, and what to carry forward

### The rebuild chain could not have rebuilt anything

`docs/07-backup.md` lists the files to run to recreate the database from nothing, and says
the order is verified. **`supabase/projects.sql` was not in the list.** `tasks.sql`
references `public.projects`, so a real restore would have failed on a missing table.

It survived because the chain had only ever been run against a database that already had
the table — every run was a re-run, never a rebuild. Both sessions that "verified" it,
including the one that found three files redefining each other, checked the wrong thing.

**Carry forward:** the chain is only proven by a database that does not have the objects
yet. Against a live one it proves ordering, not completeness. Fixed in `fa79c4f`, with
`project-series.sql` placed last so the `series_id` column survives every file that
redefines `project_overview`.

### Under RLS, "forbidden" and "absent" are the same observation

The first error message for fanning into another professor's class read *"One of those
classes no longer exists"* — because `classes_select` means the lookup genuinely returns
nothing. The class is not refused, it is invisible.

Two messages for one observable state is a lie in one of the two cases. It is now a single
sentence, *"You do not teach one of the sections you chose"*, which is true either way.

### `project_overview` is now defined in three files

`projects.sql`, `deadline-lock.sql` and `project-series.sql`. The last one had to rebuild
it, because `select p.*` freezes its star at creation and `series_id` would otherwise be
undefined in the UI — session 1's bug, twice over.

**The three definitions are deliberately byte-identical.** All are `select p.*`, so
whichever runs last now produces the same shape and re-running an older file cannot take
the column away again. Anything this feature needed beyond the star went into a second
view, `project_series_members`, precisely so that stays true. **Keep it that way.**

Checked rather than assumed: `information_schema.columns` really lists `series_id` on the
view, before trusting any page that reads it.

### Two self-inflicted test bugs, both cheap and both avoidable

- **The `fx` temp table cannot be written while impersonating.** `insert into fx` after
  `act_as(prof)` fails with *permission denied* — the fixture handoff between `do` blocks
  has to happen back in the service role. Every existing suite already did this; mine did
  not, and it read as a feature failure for a minute.
- **A variable declared `timestamptz` then given `count(*)`** raises *invalid input
  syntax for type timestamp*, which sounds like a data problem and is a typo.

### What went right and is worth repeating

The probe-route pattern from session 2 worked again: a throwaway `/__probe/series` route
rendering both new controls with fabricated props, measured at 375px (no overflow, no
sideways scroll), interactions driven through the DOM, then deleted before the commit.
It caught nothing broken, which is the point — it is cheap enough to be worth running.

---

## What is verified, and what is not

**Verified:** 479 SQL assertions across 19 suites, all passing after running the full
42-file chain in order; `npm run build`, `npm run check` (0 errors), 79 Vitest tests; the
new controls rendered and driven at 375px; and the deploy confirmed by grepping the live
bundles for strings unique to this change — `create_project_series` and the five other RPC
names in `projects-*.js`, the picker copy in `ProjectWizard-*.js`, the scoped-action copy
in `ProjectDetail-*.js`, and the card chip in `ProjectCard-*.js`.

**Not verified, and it is the same gap as every session:** nothing has been clicked
through **signed in**. Specifically unexercised by a real professor:

- Creating a project for two or more real sections from the projects page.
- The scoped deadline change, close, archive and publish on a real series.
- What a student in one section sees — proven in SQL (they see their own sibling and not
  the other), never seen on screen.

The live database still has **three classes, all one professor, no two sharing a course
initial** — so the "same course, other sections" list will be empty until a second section
exists. Making one is the first thing to do when trying this.

---

## Outstanding owner decisions

Unchanged from session 2, none of them answered:

1. The Anthropic API key is still unrotated.
2. Email confirmation is off; outbound mail is not switched on.
3. The five Supabase auth rate limits are still unset.
4. Backup retention is still blank in `docs/07-backup.md`, and no backup has been taken.
5. The encryption question — **what are you defending against?** Only "someone with your
   database password" argues for it, and real protection means end-to-end in the browser,
   which would break notification previews, the AI features and search.

---

## The next step I would take

**Make a second section of one course and use the feature once, signed in.** Create
`ITP · BSIT-4B` beside the existing `ITP · BSIT-4A`, attach the same syllabus, set one
project for both, then grant one of them an extension and confirm the other did not move.
That is fifteen minutes and it exercises everything built this session.

**After that, in order of what they are worth:**

1. **A real rebuild test.** The chain has never been run against an empty database. A
   scratch Supabase project, the 42 files, then the suites, would turn a documented claim
   into a verified one. This is now the oldest untested claim in the repo.
2. **`docs/09-normalisation.md`** — still unwritten, still the thing a panel will ask
   about. The four deliberate departures from 3NF are listed in session 2's notes.
3. **Deploy the two edge functions**, so the AI rate limits are live rather than defined.
4. **Split `src/lib/types.ts`** by domain. It gained `SeriesMember` this session and is
   past 1,500 lines.

**Do not build without asking:** column encryption; auto-closing a project when its
deadline passes; a Files page or group drive; and **making a series edit apply to every
section by default** — the "this one only" default is what protects a section that was
deliberately given different terms.

---

## Session — 2026-09-01 (later): the sticky the hero never had

The 3D board and the hero resize shipped as `be3b328` and `3d5e277`. A third commit,
`6aaf77c`, fixes what neither of those had ever actually been watched doing.

**`overflow-hidden` on the hero section was silently killing `position: sticky`.** An
ancestor whose overflow is anything but `visible` becomes the scroll container for a
sticky descendant. The board therefore never pinned: it scrolled away with the page and
left a full screen of empty navy where the three chapters were supposed to play. Nothing
errors, nothing warns, and `getComputedStyle(...).position` still reports `sticky` — the
only way to catch it is to scroll the page and look at where the element went. The
decoration (gradient, blueprint, amber glow, particle field) now lives in one
`absolute inset-0 overflow-hidden` layer and the section itself is `visible`.

This is the second time an ancestor's overflow has broken something in this repo — the
first was the nav dropdown that `overflow-x-auto` clipped. **When a positioned or
overflowing child misbehaves, walk its ancestors' `overflow` before anything else.**

Also fixed: the last chapter ended at progress `0.9`, so the final tenth of the pinned
scroll showed the board beside an empty column. It now runs to `1` and skips its
out-ramp, holding until the section unpins.

**Verified by measurement, not by screenshot:** sticky reads `top: 0` at every probe from
0.15 to 1.0 of the pinned range and releases after; no horizontal overflow at 1079px or
375px; on mobile there is no pin and all three chapters render as ordinary blocks. Build
clean, lint at the standing baseline of 23 warnings / 0 errors.

**Note for whoever tests the canvas next.** R3F leaves `preserveDrawingBuffer` off, so
sampling the canvas with `drawImage`/`getImageData` returns blank *whether or not the
scene rendered*. I read that as "the board is not drawing" and was wrong. Use a browser
screenshot — it captures the composited page — or flip the flag on temporarily and
remember to take it back off.

**Still unverified on the 3D board:** upward-scroll reversal, chapter crossfade timing,
pointer tilt, card hover, tablet width, and reduced-motion. The preview pane reports
`visibilityState: hidden`, so rAF ticks about once a second and observers fire
unreliably — anything time-based needs a real browser to judge.

## Session — 2026-09-01 (later still): the hero loops instead of scrolling

`80372f0`. The owner asked for the hero back at its normal size, the scroll
animation gone, and the timeline looping. So: no pin, no 200vh wrapper, no
ScrollTrigger, `BoardScrollStory.tsx` deleted, gsap uninstalled (it was only ever
here for ScrollTrigger — entry chunk 103.14 → 101.98 KB gzip). The hero is the
two-column screen it was before the board arrived, at 105vh desktop / 138vh phone.

**The loop is build → story → hold → dissolve, about 10.9s, in `story.ts`.** The
dissolve is the whole trick and is worth not undoing: every pose in `BoardScene`
is a pure function of the story fraction and accumulates nothing, so the fraction
can be reset at any moment — but resetting it while the board is visible
teleports the flying card home. The last second of each turn takes every part's
scale to zero and walks the entrance group backwards to its own starting
transform, so at the wrap there is literally nothing on screen to snap.

**That invariant is one careless line from being broken.** Anything that writes a
scale in the frame loop must carry the `alive` factor, or it survives the wrap and
hangs in the hero on its own. Two things already did:

- `BasePlate` was the one piece the staggered reveal skipped. It sat at full scale
  while everything above it vanished — the dissolve ended on a bare floating slab.
- **Card hover eased each card's scale toward full size, and it runs after the
  reveal, so it won every frame.** This was a pre-existing bug, not a new one: it
  had been quietly damping the entrance since the board landed, and it left the
  cards at ~12% through the dissolve. It now eases a 0–1 lift and *multiplies*
  whatever the reveal left. Card `z` had two writers for the same reason and now
  has one.

The three step captions ("Create the project" etc.) went with the scroll story
that owned them; "How it works" below covers the same ground.

**Verified:** hero 105vh, zero sticky elements, no horizontal overflow at 1079px
or 375px, no console errors on a fresh tab, build clean, lint at the standing 23
warnings / 0 errors. The loop was watched through a full turn — build, card
flight, landing with the right column's amber lifting, then the dissolve caught on
camera with plate and panels scaling away together.

**Still unverified:** reduced motion. The path is an unchanged early-return in the
frame loop plus a static effect that sets the finished pose, but neither this pane
nor these tools can emulate `prefers-reduced-motion`, so it wants a real browser.
Pointer tilt and card hover are also desktop-only and untested for the same reason
the rest of the timing work is — see the note on `visibilityState: hidden` above.

**Open, and mine to raise rather than decide:** the board still averages a very
dark navy against the navy hero. It reads because of the specular highlights and
the lighter plate, but it is close to the line the brief drew.

## Session — 2026-09-25: files, archive visibility, folders

Spec `docs/superpowers/specs/2026-09-25-general-files-archive-folders-design.md`,
plan `docs/superpowers/plans/2026-09-25-general-files-archive-folders.md`. Built
`8ee9f5e..3cf8078` on main, task by task with a review after each, plus a
whole-branch review and one fix round.

**What changed for users.** Every 3-dot menu is one `ActionMenu` rendered through a
portal, so it is never clipped by a closed folder or an `overflow-hidden` card, and
the trigger is darker in light mode and lighter in dark. Archive rows and sections
act through menus. For review is split into Submitted by me / Submitted to me /
Other open requests, and withdrawing asks first. Archive task sits at the top of
the task dialog. Files browse one folder at a time with breadcrumbs in the URL
(`?tab=files&view=draft&path=…`), folders rename, "+ New" offers New folder /
Upload a file / Upload a folder, and all four Files tabs search.

**The archive rule lives in Postgres.** An archived item is visible to whoever
archived it plus the project's Owners and Managers. `general-archive-rbac.sql`
enforces it in the task view, the RPCs, table RLS for tasks and task files, their
child tables (comments, logs, assignees, events), Storage, and guard triggers that
refuse direct writes to `archived_at`/`archived_by` unless an RPC set
`collabify.general_archive_op`. That file is now the only home of every archive
function; re-run it after any earlier General file (see `docs/07-backup.md`).

**Folders.** A folder is a path prefix; an empty one made in the site holds a
hidden `<folder>/.keep`, so submit, review, archive, restore and delete need no
new machinery. `.keep` is filtered wherever files are listed or counted, including
the server's `file_count`. `rename_general_draft_folder` (`general-folders.sql`)
moves draft-only folders, and turns a folder already in Main into remove + add
pairs in your own draft, so Main still changes only by review. Every path-prefix
match uses `left(path, n+1) = v || '/'`, never `LIKE` — folder names may contain
`_` and `%`.

**Verified.** 402 unit tests, lint 23 warnings / 0 errors, build, contrast,
a11y-names, schema-drift, motion-lint, legal-ready; every `general*` SQL suite
0 FAIL. In the browser: menus unclipped in both themes, archive per account,
New folder → folder page → rename → breadcrumbs → Back, archive and permanent
delete of a site-made folder, search on all four tabs.

**`npm run check` fails at lint** on the untracked `docs/redesign/serve-dashboard-preview.mjs`
(3 no-undef errors). Not from this work; commit it with an eslint env or ignore it.

**Follow-ups, since fixed:** "Discard it all" hides on an archived project.
Deleting an archived task file checks the project guard first, then asks
`archived_general_task_file_objects` about any path `remove()` did not report, so
a refused object stops the delete and a missing one does not; if the row step
still fails the message says the entry remains and deleting again clears it. A
change mixing files and a new empty folder names the folder ("2 files, 1
folder"). Assignment, comment and deadline notifications skip anyone who may not
see the task (`general_user_sees_task`), and the archived files list leaves out
files on a task hidden from the caller; all redefined in `general-archive-rbac.sql`.

**Archived tasks are read-only outside the archive RPCs**: new holders,
comments, logs, files, uploads, task edits, and deleting a holder, comment, log or
file row are all refused. `guard_general_archived_task_child` lets a delete
through at `pg_trigger_depth() > 1`, so task, project and membership deletes
still cascade. The two archived-file delete RPCs set the archive-op flag.

**Old notifications on a hidden task:** `notifications_select_own` is redefined in
`general-archive-rbac.sql` to leave out any notification whose `general_task_id`
is hidden from the reader (`general_task_hidden`). They return on restore. Re-run
the rbac file after `classes.sql`. The withdraw path and two-account archive visibility were covered
by SQL tests, not clicked through with a second account.

## Session — 2026-09-25 (later): General workplace reports

Built from `2026-09-25-general-reports-design.md`. Delivered as a patch, not committed.

**Database — `supabase/general-reports.sql`** (last in the chain; also needs
`general-space-teams.sql`, which is not in the `docs/07-backup.md` restore line).

- Access lives in the functions: `general_report_is_lead` (project Owner/Manager, or
  space Owner/Manager) sees everyone; anybody else gets totals plus their own rows,
  forced in `general_report_people_of`, whatever `p_people` says. Names of others come
  back null (`general_report_name`). Comment bodies and drafts are never read.
- `general_project_events` + three triggers record task archive/restore, project
  status/archive, member join/leave/remove/level. Only from install time
  (`general_report_history_since`); cascades from a project delete record nothing.
- `general_report_templates` with RLS (private / shared, author or space Owner edits)
  and a 50-per-person-per-space cap.
- Nine RPCs. `set jit = off` on each: JIT compile cost ~0.8 s against ~0.1 s of work on
  a 5,000-task project. All under 160 ms there with JIT on at the server.
- Progress per day is rebuilt from `general_task_events.status_from`; tasks archived now
  are left out of every day unless archived work is asked for.
- `supabase/tests/general-reports.test.sql`: 47 checks, all PASS on a local Postgres 16
  with Supabase stubs. The earlier `general-draft-restore` (15) and
  `general-project-archive-rbac` (22) suites also pass there.

**Client**

- `src/lib/general/report{Config,Range,Score,Narrative,Data}.ts` — pure, 26 Vitest tests.
  The URL is the source of truth (`toSearchParams`/`fromSearchParams`).
- `src/lib/api/generalReports.ts`, `src/hooks/useGeneralReport.ts` (debounced, abortable,
  only the enabled sections' RPCs).
- `src/pages/general/GeneralReports.tsx`, `src/components/general/reports/*`
  (builder rail, document, SVG charts, CSV), `src/components/ui/CheckboxList.tsx`.
- `Sheet` takes `letterhead`, `footerNote` and `id`; Education output is unchanged.
- Sidebar `ArchiveRow` became `SpaceRow`; Reports sits under Archive. Projects have a
  **Report** link in their header.

**Not checked here:** two real accounts in a browser, a real print to PDF, Excel opening
the CSV. The page was checked in a mocked harness at 1440 and 390, light, dark and print.

**Pre-existing, seen while testing, not fixed:** `general-notify` admin-count check and
`general-repo` "reviewer merges without edit_files" fail on the local stub chain;
`classes.sql`/`syllabus.sql` and `groups.sql`/`projects.sql` depend on each other, so a
fresh restore needs two passes.
