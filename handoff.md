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

## Session — 2026-09-26: one workplace, phase 1 (admission-gated access)

Spec `docs/superpowers/specs/2026-09-26-one-workplace-design.md` (four phases);
plan `docs/superpowers/plans/2026-09-26-one-workplace-phase-1-access.md`. Pushed
`c56fa85..46910d4`. Owner ran the five-account browser walk; all as expected.

**Database — `supabase/access.sql`** (last in the chain, applied live). Re-run it after
re-running `workplaces.sql`, `consent.sql`, `audit.sql`, `admin-rename.sql`,
`approvals.sql`, `accounts.sql`, `general.sql`, `general-spaces.sql` or `classes.sql`.

- `profiles.can_teach` (admin-only, pinned by `guard_privileged_columns`); audit action
  `teaching_changed`. Helpers `is_faculty`, `is_student`, `is_teaching_faculty`,
  `am_i_admitted()`.
- `decide_faculty(user, approve, can_teach)` replaces `decide_professor`;
  `set_faculty_teaching`. `enter_education` and the role-less General signup are gone.
  `general_viewer_active` now needs an active account with a role.
- Triggers: only faculty insert `general_spaces`/`general_projects`; students stay
  `member` on spaces, projects and space teams; only faculty invite a student. Students
  can't join spaces or projects by code. `classes_insert` needs `can_teach`.
- **Security fix:** the admin RPCs (and seven older class/reassignment RPCs) were
  executable by `anon`, and their guards skipped a null `auth.uid()`. Execute is revoked
  from `anon`; the admin guards now refuse any API caller that isn't admin or service role.
- Role value is still `professor`; the UI says Faculty. Renamed in phase 4.
- Owner chose to delete the 4 student-owned General spaces and the Robotics project.

**Client:** Student/Faculty registration; `/pending` for pending or role-less accounts;
`src/lib/access.ts`, `useAdmission`; students nobody has admitted see Dashboard +
Settings; `JoinClassDialog`; Faculty approvals page with *Can teach*; create/join
buttons for faculty only.

**Tests:** `supabase/tests/access.test.sql` (66 checks); 38/38 SQL suites; 452 Vitest.

**Open:** the member level pickers still offer Owner/Manager for students (the DB refuses
it); the member payload has no role yet — due in phase 2. `general-space-teams.sql` is
still missing from the restore line.

**Next:** phase 2 — education spaces underneath (classes become spaces).

## Session — 2026-09-27: one workplace, phase 2 (education spaces underneath)

Plan `docs/superpowers/plans/2026-09-26-one-workplace-phase-2-education-spaces.md`.
Pushed through `1e2ee58`. Owner ran the browser check; all as expected.

**Database — `supabase/one-workplace.sql`** (after `access.sql`, applied live).
- `general_spaces.kind` (`work` | `education`). Every class owns an education space
  (`classes.space_id`, not null, unique). Triggers on `classes` create the space, keep
  its name/description/archive in step, swap the Owner on handover, delete it with the
  class. `classes.student_cap` (null or 1–500).
- `class_members` stays the roster; a trigger mirrors it into `general_space_members`
  under the transaction-local `collabify.class_sync` flag. Guards refuse every other
  write to a class space. Teachers can only update `status/removed_at/removed_by` on
  roster rows (column grants + identity guard).
- Co-teachers: active faculty at Owner/Manager (`teaches_in_space`). Class policies read
  the row's own `professor_id/space_id` — never `is_class_professor(id)` (a policy that
  re-reads its own table breaks INSERT/UPDATE … RETURNING). Owner decided advisers
  (no *Can teach*) get full teaching tools too. They moderate but aren't yet members of
  the class conversation (phase 3).
- `join_class`: size cap (row lock), refuses inactive accounts, results `full`/`inactive`.
  `class_join_preview` shows the class only when joinable. Member lists return `is_student`.
  `class_overview` carries `space_id`, `student_cap`.

**`supabase/anon-lockdown.sql`** runs LAST: the signed-out role executes no public
function (192 → 0); signed-in access unchanged (293). Re-run it after adding or
redefining any function — `supabase/tests/anon-lockdown.test.sql` fails until you do.

**Client:** General hides class spaces until phase 3; level pickers offer students only
Member; class form has a size limit; `/join/:code` invite link (1-hour pending code,
students only, asks before joining); "Copy invite link" on the class header.

**Tests:** 40/40 SQL suites (`one-workplace.test.sql` 73 checks); 457 Vitest.

**Deferred:** `create_general_project`'s oldest-owned-space fallback ignores kind;
deactivated professors keep teaching via `professor_id`; restoring a student can pass
the cap; space description can drift via `update_general_space`; `project_boards_write`
has the self-reference policy shape (unreachable today); `general-space-teams.sql`
missing from the rebuild line; `dotenv` 17 prints promo tips (pass `quiet: true` in
`scripts/db.mjs` to silence).

**Next:** phase 3 — one workplace on screen (routes, one rail, merged home, class pages
as space tabs, co-teachers in the UI and the class conversation).

## Session — 2026-09-27: one workplace, phase 3 (one shell + education space page)
Plans `docs/superpowers/plans/2026-09-27-one-workplace-phase-3a-shell.md` and
`…-phase-3b-education-space.md`. 3a pushed through `27ce821`; 3b through `d0c1445`.
Browser walk for both is done (owner confirmed 2026-09-27).

**3a — one shell.** `src/lib/paths.ts` owns every URL; `legacyPath()` redirects old
`/student`, `/professor`, `/general`, `/admin`, `/education` links (query and hash kept).
One `<ProtectedRoute open>` + `<AppShell>` parent; guard-only layouts via
`src/routes/gate.ts`. `RoleSwitch` picks the page by role behind one route. One rail
(`navFor`): MAIN, YOUR SPACES (classes amber, work navy), YOUR PROJECTS, CLASSES,
TEACHING, ADMIN, ACCOUNT. Home is stacked (role dashboard, then "Your work"). Messages,
My tasks and Calendar are one list with an All · Classes · Work filter in `?show=`.
The workplace switcher and its helpers are gone.

**3b — a class is its education space.** `/classes/:classId` renders `ClassSpace`
(keyed by class), tab in `?tab=`. Everyone: Overview (this week, announcements, about),
Projects, Groups, Members (Faculty panel, then Students), Syllabus. Faculty who teach it
(`teachesClass` = class professor or active faculty at Owner/Manager, same rule as
`is_class_professor`): + Submissions, Analytics, Reports (the teaching pages with a
`classId` prop that locks them to the class) and Settings (`ClassSettings`: edit,
archive/restore, delete for the professor only). The two old class detail pages are gone.
- Co-teachers: faculty in a class space always sit at Owner/Manager (accepted invite →
  Manager; Member refused). **Owner decision:** only a class's Owner invites or removes
  faculty; anyone can leave. Their seat puts them in the class chat
  (`class_space_conversation_sync`, handovers included). `search_faculty` RPC for the
  invite dialog. `listProfessorClasses` includes co-taught classes, so every professor
  list shows them.
- New space asks Education or Work for teaching faculty; "Create class" opens it at
  Education and lands in the new class.
- Printing a report from a class hides the class banner (join code).

**Tests:** 40/40 SQL suites; 505 Vitest; build clean.

**Deferred:** everything from phase 2's list, plus: space-level student positions
(positions exist only on projects); Analytics empty-state copy inside a class; an
archived class's Submissions tab is empty (lists exclude archived); losing a seat
mid-session keeps loaded data until reload; `listProfessorClasses` takes two queries;
`general_space_overview` is defined twice in `one-workplace.sql`; any teaching professor
can point `syllabus_id` at a known resource UUID (pre-existing); month-view work chips
look like class chips; `useConversations` subscribes three times on Home; `gate.test`
matrix gaps. **Open owner question:** should an admin without *Can teach* keep
"New message" in Messages (hidden now)?

**Browser walk:** 3a + 3b browser walk done.

**Next:** answer the open owner question, then phase 4 cleanup (drop `home_workplace`
and dead routes, rename `professor` → `faculty`, landing/auth copy).

## Session — 2026-09-27: one workplace, phase 4 cleanup
Plan `docs/superpowers/plans/2026-09-27-one-workplace-phase-4-cleanup.md`.
Committed and pushed `9d036d2..55ff39d`.

**Cleanup:** `src/lib/workplace.ts` and its test are deleted. `homeFor` now lives in
`src/lib/access.ts`. `profiles.home_workplace` and the unused `public.workplace` enum
are removed by `supabase/cleanup.sql`, which is registered in restore/docs order.

**Role rename:** account role storage is now `student | faculty | admin`. The live enum
was renamed from `professor` to `faculty`; fresh schema creates `faculty`; signup still
maps old metadata `role='professor'` to `faculty` for deploy safety. Teaching-domain
names remain on purpose (`professor_id`, `is_class_professor`, task author
`'professor'`, teacher-view props, and legacy `/professor/*` redirects).

**Owner decision:** admins do not teach. `canTeach()` and `is_teaching_faculty()` are
faculty-only; admins do not get the teaching/New message behavior.

**Copy:** current auth/join copy says faculty/faculty member. `JoinClassLink.preview.professor`
is only a data field name, not visible copy.

**Checks:** `npm run build`; `npx vitest run` (42 files, 504 tests); 41/41 SQL suites
(one transient DB timeout on first final run, clean on retry); `node scripts/schema-drift.mjs`
(same 11 review hints, proof is SQL suite); `node scripts/db.mjs -c "select role, count(*)…"`
shows `student`, `faculty`, `admin` only; required greps reviewed. Graphify updated; its
pre-existing parse warning remains `src/lib/api/generalReports.ts`.

**Deferred:** previous deferred list still stands unless fixed by phase 4. Additional
intentional leftovers: historical docs/plans still mention the old two-workplace fields;
`supabase/cleanup.sql` and `cleanup.test.sql` mention them to remove/prove removal.

**Browser walk:** owner confirmed 2026-09-27: Faculty signup copy/ pending state,
admin approval + Can teach toggle, faculty class creation with Can teach, legacy
`/professor/submissions` redirect, and student join copy all work.

## Session — 2026-09-27: phase 4 SQL apply and fixes

**Applied SQL to live DB.** Files applied in order: `schema.sql`, `consent.sql`,
`approvals.sql`, `accounts.sql`, `admin-rename.sql`, `workplaces.sql`, `access.sql`,
`one-workplace.sql`, `cleanup.sql`, `anon-lockdown.sql`. Worked around view-column
conflicts in `messages.sql` and `general-spaces.sql` by extracting only the changed
function bodies (`start_direct_message`) into a temp file.

**Bugs found and fixed during apply:**
1. Applying `schema.sql` overwrote `profiles_select_own` policy, removing the
   `shares_class_with(id)` check that `classes.sql` adds. This broke four test suites
   (`insight`, `reassignments`, `reports`, `student-reports`) because professors could
   not see student profiles through security-invoker views. Fixed by re-applying the
   policy from `classes.sql`.
2. Applying `audit.sql` (to fix a pre-existing `prefs_select_own` drift) overwrote
   `log_profile_change` from `access.sql`, losing the `can_teach` audit tracking.
   Fixed by re-applying `access.sql`.
3. Messages.tsx admin moderation bug (already committed as `ad294cb`): Codex dropped
   `|| profile?.role === 'admin'` from `canModerateHere`.

**Lesson:** when applying SQL files individually, respect the file order in
`schema-drift.mjs`. Later files redefine objects from earlier ones; applying them
out of order (e.g. `audit.sql` after `access.sql`) overwrites the authoritative
definition. The safe order for manual applies: follow the ORDER array, and always
finish with `anon-lockdown.sql`.

**Checks:** `npm run build` passes; 41/41 SQL test suites pass clean.

**Next:** browser walk for phases 3a+3b (needs user sign-in); the open owner question
about admin "New message" in Messages.

## Session — 2026-09-28: draft commit, work tasks redesign, space cards, class header

**Task dialog:** "Add a file" and "From project files" now line up (the margin moved
from one button to their wrapper).

**Commit to main (item 1):** `supabase/general-draft-commit.sql` adds
`commit_general_draft_path(repo, path, folder, message)`. It commits one draft file or
a draft folder through `commit_general_files`, so only `edit_files` holders can do it
and class-board freezes still apply. Then it drops those files from the draft and
moves the draft's `base_seq` forward. Registered in `schema-drift.mjs` ORDER and
`docs/07-backup.md` after `class-files.sql`. Applied live; `anon-lockdown.sql` re-run.
In the UI, `DraftPanel` shows "Commit to main" in the ⋯ menus (rows and folder bar)
only for `edit_files`. The confirm dialog needs the file or folder name typed in.
Test: `supabase/tests/general-draft-commit.test.sql` (11 PASS).

**Work tasks (item 2):** `general/TasksTab.tsx` now uses the class layout: a
Summary/Board/List switch (`TaskViewSwitch`), a filter row, "X of Y done" plus Add task,
coloured column headers, the class card style with Start / Mark done / Reopen, the
class list table, and a Summary (tiles and donut shared with `TaskSummary`, whose
`SummaryTile` and `StatusDonut` are now exported, plus who is carrying what).

**Spaces (item 3):** `SpacePicker` cards copy `ClassCard`: an eyebrow with a number, a
status pill, a monogram, a description and a footer.

**Space shortcuts (item 4):** `QuickActions` is always one row with equal columns
(`repeat(n, 1fr)`), and each card has a navy outline. Container queries drop the hint
and then the label as a card gets narrower (the label stays as sr-only text and as a
title). This also affects Home's "Your work" row, which uses the same component.

**Class project header (item 5):** a student's result (Accepted / Returned / Waiting)
is now a pill next to the week and status pills (`BoardVerdict variant="pill"`), and it
opens the details and feedback. The student Tasks tab no longer shows the card. A
professor's view still shows the full card, because it holds Accept/Return. The header
says "Closed" once the deadline has passed, the same rule `ProjectsBoard` uses. This
changes only the label: late work is still accepted.

**Checks:** `npm run build`; `npx vitest run` (44 files, 528 tests); new SQL suite and
anon-lockdown suite pass.

**Browser walk:** pending the owner's sign-in.

**Owner decision (2026-09-28):** a class project locks only when a professor closes it.
Past the deadline, students can still upload and hand in; the header's "Closed" is a
label only. Owner checked all five changes in the browser; merged to `main` as `79639ef`.

**Work project cards:** `components/general/WorkProjectCard.tsx` replaces the two local
`ProjectCard`s in `GeneralProjects` (All projects, with `showSpace`) and `SpaceHome`
(a space's All projects). It is built like `ClassCard`: an eyebrow with a number, a
status pill coloured by status, a monogram showing the preset icon (or the initial), a
meta line (space · kind · dates), a description, a progress bar, and a footer with your
role, members and access requests. Build and 528 tests pass.

## Session — 2026-09-28 (later): three teaching guards, class board deletes

**`supabase/teaching-guards.sql`** (after `general-draft-commit.sql`, applied live):
1. A deactivated professor no longer teaches. `is_class_professor`, `owns_resource`,
   `is_privacy_handler` and the `classes_select/update/delete` and
   `teaching_resources_own` policies now also require `general_viewer_active()` when
   they trust `professor_id` directly. Reactivating restores everything.
2. `restore_class_member` checks `student_cap` under the same row lock `join_class`
   uses, and returns `full` when there is no seat. `RosterTable` now shows an error for
   `full` and `not_allowed` instead of always saying the student is back.
3. A `classes_guard_syllabus` trigger allows a new `syllabus_id` only when the resource
   is a syllabus the caller owns or one marked `program_wide`. An unchanged syllabus
   on re-save is not checked. The UI picker already offered only those.
Test: `supabase/tests/teaching-guards.test.sql` (14 PASS).

**Class board delete bug (found by `analytics.test.sql`):** deleting a class project
whose board had Files commits failed with "A commit cannot be changed or removed". The
cascade reached the hidden Files project's commits. `class-files.sql` now has a
`project_boards` before-delete trigger that notes the board's Files project in
`collabify.class_board_delete`, and a superset `guard_general_commit` lets those
commits go. A lone commit delete is still refused. `class-files.test.sql` gained 3
checks. Storage objects under a deleted board's Files are not cleaned up (deferred).

**Checks:** all 45 SQL suites pass with no failures; `npm run build`; `npx vitest run`
(528).

**Space delete (2026-09-28):** the Archive/Restore/Delete buttons moved into the space
banner (`DashboardSummary` gained an `action` slot), and Delete shows only on an
archived space. `delete_general_space` (general-spaces.sql, applied live as a
function-only apply) now also refuses a space that is not archived (`check_violation`).
It also fixes an older bug where any space holding a project with Files commits could
not be deleted. Each project is now removed the way `delete_general_project` removes
one (un-archived for the transaction, tasks first, then deleted under
`collabify.general_project_delete`). The task delete runs with no caller, because the
space Owner may not be on every project, and the caller is restored straight after.
Test: `supabase/tests/space-delete.test.sql` (6 PASS); `general-spaces` and
`notification-coverage` now archive before they delete. All 46 SQL suites pass.
Storage objects under deleted projects are still left behind (deferred).

**Storage sweep (2026-09-28):** `supabase/storage-sweep.sql` (after `teaching-guards.sql`,
applied live) adds `storage_orphans()`, `sweep_storage()` and the pg_cron job
`collabify-storage-sweep` (every 15 minutes). It removes files that nothing references
once they are a day old, through the Storage API via `pg_net` bulk DELETE. Direct SQL
deletes are blocked by `storage.protect_delete` and would leave the bytes anyway. The
references are listed per bucket in `storage_orphans`. Avatars are excluded, and files
in declined or withdrawn changes are kept because they can be restored. The job reads
`collabify_supabase_url` and `collabify_service_role_key` from Supabase Vault, stored by
`node scripts/sweeper-secrets.mjs` (owner approved keeping the key in Vault; it is still
not in code, Vercel or git). Requests are logged in `storage_sweep_requests` and
retried after a day. The first run removed 286 files (283 test uploads in Capstone 2,
2 task files, 1 chat file, about 98 MB), and Storage returned 200 for each bucket.
Also fixed `general_files_remove_orphans`, whose subquery read `name` as
`general_projects.name` and so never let the app clear a deleted project's files.
Test: `supabase/tests/storage-sweep.test.sql` (9 PASS). All 47 SQL suites pass.
`schema-drift` adds one length hint (`is_privacy_handler`, which I rewrote on purpose).

**Trash (2026-09-28):** files and folders now have Trash, separate from Archive. Archive
hides a file inside its project for anyone who can read that archive. Trash belongs to
whoever trashed it, shows on the new `/trash` page (the Account section of every rail,
so every account always sees it), and is deleted for good after 30 days by the pg_cron
job `collabify-trash-purge` (daily, 18:30 UTC). The storage sweep then takes the bytes.
In scope: draft files and folders (My draft, work and class project Files) and work task
files, which are everything Archive takes. "Move to trash" sits under Archive in the
DraftPanel menus and in a task file's new menu in TaskDialog. `supabase/trash.sql`
(after `storage-sweep.sql`, applied live) adds `trashed_at`/`trashed_by` (+ `trash_root`
on draft files, so a folder comes back whole). A trashed row keeps `archived_at` set,
so every live listing, count, submit and commit already skips it. The archive functions
are redefined as supersets to leave trashed rows out, and `guard_trash_columns` clears
the trash columns whenever a row goes live again (saving over a trashed path brings it
back). RPCs: `trash_general_draft_path`, `trash_general_task_file`, `list_my_trash`,
`restore_trashed_*`, `delete_trashed_*`, `empty_my_trash`, and `purge_trash`
(service-only). Items in an archived or handed-in project show "Project locked" until
it reopens. Test: `supabase/tests/trash.test.sql` (24 PASS). All 48 SQL suites and 528
Vitest tests pass. (The work-report gap noted here was closed later the same day.)

**Syllabi and Curriculum archive and Trash (2026-09-28):** `teaching_resources` gained
`archived_at`, `trashed_at` and `trashed_by` (in `trash.sql`, applied live). On the
Syllabi and Curriculum pages (and the admin library, which shares `ResourceLibrary`),
each card's delete button became a ⋯ menu with Archive and Move to trash. Archived ones
sit in a collapsible Archived section on the same page (Restore, Move to trash) and
leave the library, the class pickers and the dashboard's syllabus checks. A class that
already points at one keeps it. Trashed ones show on the Trash page under Syllabi or
Curriculum and are purged after 30 days like everything else. Deleting for good sets
the class links to null and drops the week map (existing FKs). `list_my_trash` gained
a `resource_kind` column (dropped and recreated). RPCs: `archive_teaching_resource`,
`trash_teaching_resource`, `restore_trashed_resource`, `delete_trashed_resource`.
Test: `trash.test.sql` now 31 PASS; all 48 SQL suites pass.

**Personal colors in Appearance (2026-09-28):** Settings → Appearance now has "Your
colors" under Light/Dark/System. Each person can recolor ten slots, separately for light
and dark: page banner background and accent, the status set (done, in progress, late,
pending), sidebar icons and current-page color, progress bars, and unread badges. There is
a live preview that shows either mode, "Default colors" (resets the mode being edited),
"Save as palette" (up to 12, named, rename/update/delete from a ⋯ menu), and five built-in
presets (default, colorblind-friendly, high contrast, Forest, Ocean) in
`lib/palettePresets.ts`. To make this possible without touching layouts, the status colors
moved onto their own tokens: `emerald-*` → `success-*`, `red-*` → `danger-*` (codemod,
every use), status-meaning amber → `warning-*` (brand amber untouched), `todo`/`planning`
pills → `pending-soft`/`pending-ink`, single progress fills → `bg-progress`, the banners
(DirectoryHero plus the six hand-built ones) → `banner*`, and SideNav → `nav-*`/`badge`.
Defaults equal the old values, with one deliberate change: the sidebar's unread count is
now amber in light mode too, matching the bell. `lib/palette.ts` turns a pick into a full
OKLCH ramp, flips banner/badge text to stay 4.5:1, nudges icons to 3:1, and sets the
variables inline on `<html>`. It caches them in localStorage `collabify.palette`, which
`public/theme.js` applies before first paint. `ThemeSync` loads the account's colors once
per sign-in and clears them on sign-out. Storage is `supabase/appearance.sql` (after
trash, applied live): `user_appearance` and `appearance_palettes`, owner-only RLS, a hex
and key whitelist check, and the 12-palette cap trigger. They are not on `profiles`
because peers can read profiles. Tests: `appearance.test.sql` (22 PASS),
`src/lib/palette.test.ts` (14). All 49 SQL suites and 542 Vitest tests pass. Contrast
checks now cover the defaults.

**Your colors, second pass (2026-09-28):** the editor moved out of the Appearance section
into a modal (`ColorCustomizer.tsx`), opened by "Customize colors". The section itself now
keeps a one-line summary with swatches. Each group has its own live preview: banners,
status highlights, sidebar, progress bars, notifications, project icons, and background
depth. They are drawn from the picks, so dark previews work while the site is light.
Naming, resetting and deleting happen in the modal's footer rather than in a second
dialog. New settings:
- **Project icons:** `iconTile` / `iconGlyph` drive `bg-icon-tile text-icon-glyph` on the
  icon squares of project, work project, class, group, space and syllabus cards and on
  the RoleHome tiles. The glyph is pushed to 3:1 on its tile.
- **Banner style:** `bannerStyle` is glow (default), solid or gradient, and gradients use
  `banner2` as their right color. The banners use `.banner-fill`, `.banner-deco` (hidden
  when solid or gradient) and `.banner-cell`. Banner text picks the ink that reads on both
  ends, and the editor warns when no ink can (`bannerReadable`).
- **Background depth (dark only):** `depth` is 1–100, set by a level slider. It is
  interpolated toward black in `groundFor` and applied as `--u-*`, which `.dark .app-ui`
  reads before its defaults.

Presets: High contrast now has solid banners and Ocean has gradient ones.
`valid_palette_colors` accepts the new keys and rejects bad styles, and rejects depth that
is in light mode, fractional, out of range or not a number. `appearance.test.sql` has 28
PASS and `palette.test.ts` has 19.

**Dialogs follow background depth (2026-09-28):** `Modal` (and so `ConfirmDialog`) and the
collapsed rail's tooltip are portaled outside `.app-ui`, so they used to keep the
marketing `.dark` grounds. They now carry `.depth-ground`, which in dark mode reads the
person's `--u-*` depth first, backdrop (`--scrim`) included. The fallbacks are the old
`.dark` values, so nothing changes without depth. `ActionMenu` already rendered with
`.app-ui` and followed it.
Dialogs also have an edge in dark mode: `.dialog-panel` (on `Modal`'s panel) adds a 1px
white rim, from 8% to 28% as `--u-depth` (0–1, set with the depth) goes from 0 to 1, plus
a white halo up to 13%, so a dark dialog stays visible on a black page. Light mode keeps
the plain shadow.

**Work reports leave Trash out (2026-09-28):** a trashed task file keeps `archived_at`, so
with archived work included the reports listed trashing as "archived" and still counted
the file. `general-reports.sql` now asks `general_report_file_ok(f, p_include_archived)`
everywhere it filters task files: summary, people, the activity feed's `file_added`
and `file_archived`, and the per-task file count. `trash.sql` redefines it to also require
`trashed_at is null` (a new last block, applied live). Trash is treated as already gone.
`trash.test.sql` now has 36 PASS, and all 49 SQL suites pass.

## Session — 2026-09-28 (evening): automation batch

Surveyed every page and flow for automation. The full ranked list is kept below so the
later batches aren't lost. The user picked ten items, and all ten shipped to `main`, one
commit each.

**Rule-based**
- **R1: deadline follows the weeks.** A new project's deadline defaults to 11:59 pm on the
  last day of its week span. It keeps following the span until the professor types a
  deadline (`ProjectForm.tsx`, `spanDeadline`). Edited projects are not touched.
- **R2: scheduled releases announce themselves.** Before this, a project saved with a
  future `release_at` never sent `project_released`. Now pg_cron
  `collabify-scheduled-releases` runs every 15 minutes: `send_scheduled_releases()` covers
  releases from the last day. It uses the same audience and `project_invites` switch as the
  trigger, deduplicated against notifications already sent.
- **R3: overdue notice.** New `task_overdue` type. pg_cron `collabify-overdue-notices`
  runs hourly at :15, once per task per holder, for tasks that slipped in the last 3 days.
  It uses the `deadline_reminders` switch, whose Settings copy now mentions it.
- **R4: Remind.** `nudge_board(board, note)` sends a new `nudge` notification to everyone
  on a board.
  - Teachers of the class only. Ignores settings (it comes from a person).
  - Once per board per 20 hours. Refused on handed-in work or a closed project.
  - UI: `NudgeButton` on the dashboard's Stalled groups and on board-level cards in
    analytics `ActionList`.
- **R5: accept all.** A class section on Submissions with 2 or more waiting rows gets
  "Accept all N" (confirm dialog, sequential `record_board_result`). It reports partial
  progress if one is refused. Returns still need a note, so they stay one at a time.
  (I used a per-class header button instead of the row checkboxes in the plan. It is
  simpler and covers the same need.)
- **R6: groups.**
  - Closing a set with students left over now offers "Place them in the groups with room,
    smallest first", with a per-student preview, on by default.
  - Random grouping keeps apart pairs who shared a group in the class's earlier sets:
    `lib/grouping.ts` does a greedy deal, then swaps to improve. Sizes stay within one.
    The old `shuffleIntoGroups` was removed.
- **R7: start from a past class.** The Create class dialog has a "Start from a past class"
  picker. It prefills everything except section and school year. It can also copy the
  source's live projects and rubrics through `copy_class_projects`:
  - The copies land **archived, with no dates**. Restoring one is what shows it to
    students and notifies them.
  - Each group set those projects used gets an empty namesake to fill.
  - Projects whose weeks aren't in the new syllabus are skipped and counted.
  - Attachments, groups and students are not copied.

**AI (drafts only, same pattern as generate-tasks)**
- **A1: `draft-project` edge function (deployed).** Drafts guidelines plus 3 to 6 rubric
  rows from the chosen weeks. Weights become points summing to the total
  (largest-remainder rounding). "Draft with AI" is in the project form's step 2 and asks
  before replacing existing text. Teachers only; limits of 12 per hour and 50 per day.
- **A3: `draft-notice` edge function (deployed).** Turns one line into a title and message.
  `DraftFromLine` sits in the class announcement composer and the admin Notices composer.
  Class scope requires teaching the class; program scope requires an admin. Limits of 20
  per hour and 60 per day. Runs at effort `low`.
- **A6: plan drafted tasks.** Drafted tasks come with a date spread up to the deadline by
  weight. On a group board, "Share out evenly" gives each task to whoever carries the
  least. This is plain arithmetic (`lib/taskPlan.ts`), not the model, so there was no
  edge-function change. A holder the claim cap refuses leaves the task open, and the
  toast says so.

**SQL:** everything is in `supabase/automation.sql`, which runs after `appearance.sql` and
before `anon-lockdown.sql`, and is applied live. Test: `supabase/tests/automation.test.sql`
(27 PASS). The related suites still pass (anon-lockdown, notifications, results,
group-archive, submissions, insight, rate-limit). Vitest: 558.

**Not verified:**
- A real model call through `draft-project` or `draft-notice`. Both are deployed and
  answer "Sign in first." without a session, which proves the key is set and the auth gate
  works. Nothing has been drafted end to end yet.
- The UI click-through, which needs a signed-in faculty account.
- Refusal fallbacks (`fallbacks: "default"`) were not added, to match the sibling
  functions. It is a small change if wanted.

**Later batches, from the survey:**
- A2: draft return/accept feedback
- A4: draft commit message
- A5: thread catch-up summary
- R8: parse the syllabus on upload
- R9: work timer
- R10: print every student's contribution report at once

## Session — 2026-09-28 (night): work-space helpers

The user tested the education batch and asked for the same kind of helpers in work
spaces. They picked eleven items. All are on `main`, one commit each.

**Rule-based**
- **Starter folders.** An empty Main (when you can edit files) offers a folder layout by
  project kind: research, system, event, compliance or general. The suggestion comes from
  `project.preset` and `has_code`. Picking one writes `.keep` files into the person's
  **draft**, so the folders still go through review (`lib/general/starterFolders.ts`,
  `StarterFolders` in `FilesTab`).
- **Download as zip.** "Download" on a folder, or "Download all" at the top of Main. The
  zip is built in the browser with **fflate** (new dependency), and each file comes out the
  way `repoFileAsUpload` would give it: .docx, .xlsx, or the original upload.
  `filesUnder` is in `lib/general/files.ts`.
- **Since you were last here.** `general_project_visits` stores `since` and `seen_at`;
  `since` only moves after 30 minutes away, so a reload doesn't wipe the summary.
  `general_since_last_visit(project)` returns what other people did since then:
  - tasks finished and tasks added
  - tasks given to you, and comments on your tasks
  - commits
  - changes waiting on your review
  
  It says nothing on a first visit. `SinceLastVisit` shows it above the project tabs and
  can be dismissed.
- **Unsaved draft reminder.** New notification type `draft_waiting`. pg_cron
  `collabify-draft-reminders` runs daily at 01:00 UTC. It sends once per quiet stretch for
  live draft files that no one has touched for 3 days. Remember that submitting deletes the
  draft files, so anything left in a draft is unsubmitted. It uses the
  `deadline_reminders` switch (Settings copy updated), and the bell opens `?tab=files&view=draft`.
- **Save as template.** `general_project_templates` is owner-only under RLS, capped at 30 per
  person, with the payload checked by a coalesced CHECK. Templates store the preset payload
  shape (`lib/general/templates.ts`); dates, people and files are left out.
  - "Save as template" is in the project header.
  - "Your templates" sits above the built-in presets in `PresetPicker`, and each one can
    be removed (ConfirmDialog).

**AI: one edge function, `work-ai` (deployed), one action each.** Everything is read with
the caller's JWT, nothing is written, and each action has its own limits
(`ai_work_<action>_hour/day`). Member-only through `is_general_member`.
- `tasks`: "From notes" in the Tasks tab. Pasted notes, or a file from Main (PDF too), become
  draft tasks: owners are matched to member ids, teams to team names, and dates are taken
  only from the text. Anyone can draft. Owners are applied only if the person has
  `manage_tasks`; otherwise the tasks save with nobody on them, and the dialog says so.
- `describe`: "Describe it for me" in the Submit dialog (reads the draft paths) and
  "Write it" beside the editor's commit message (sends the text on screen).
- `summarize-change`: "Summarize this change" on an open change, shown above the
  line-by-line view. Asked for, not stored.
- `summarize-file`: "Summarize" in the file viewer for Main files, PDFs included (unpdf).
- `formula`: "Formula help" in `SheetEditor`. It reads row 1 and five sample rows, and the
  formula goes into the last focused cell.
- `ask`: the "Ask about these files" box on Main. It reads documents, sheets and text files
  (up to 250k characters, 60k per file) but not PDFs. It returns sources, which open the file.

**Tests:**
- `supabase/tests/work-automation.test.sql`: 18 PASS (visits, draft reminder, templates).
- All 51 SQL suites pass. `insight.test.sql` needed a fixture fix: its "outsider" student
  had picked up 7 live tasks during the user's click-through, so the test now clears them.
- Vitest: 561.

**Not verified:** a real model call through any `work-ai` action. It is deployed and answers
"Sign in first." without a session. The UI click-through needs a signed-in member of a work
project.

**Fix (2026-09-28, late): dialogs vanishing inside a class.** Reported as "Draft with AI
refreshes the whole site", but only from Class > Projects > New project. There was no real
reload. `ClassProjectsTab` swapped to its "Loading projects…" spinner on every live refresh
(realtime, focus, the poll), which unmounted `ProjectWizard` and its form. A 10–20 second
AI draft made the overlap likely.

The same pattern was in `useGroupsData` (the class Groups tab and the Groups page) and in
`BoardVerdict` (a return note being typed). All three now show loading only on the first
load, or when switching board or shelf.

There was a second trigger: both class tabs memoized `[cls]`, and the class page refetches
`cls` on every refresh. The project and group loads now key on `cls.id`.

Verified on localhost: firing focus with the dialog open reloads the data and leaves the
dialog and its text in place.

**Change (2026-09-28, late): a group's class-project Files are the group's own.** At the
user's request, teachers no longer see a board's Files.
- `class-files.sql` (applied live): `ensure_class_board_repo` now refuses anyone who isn't
  on the board, and it adds only the board's students as members. A cleanup `delete`
  removed the teacher memberships on existing boards (0 left).
- UI: `ProjectDetail` shows the Files tab to students only, and an old `?tab=files` link
  sends a teacher to Brief. The teacher group picker in `ClassFilesTab` is gone.
- Teachers still see what is handed in (submissions, verdicts, tasks), just not the
  working files.
- `class-files.test.sql` is updated: 21 PASS.

**Change (2026-09-28, late): banner buttons are recolourable.** Settings → Appearance →
Your colors has a new "Banner buttons" group under Page banners, with three slots:
- `btnCreate` (filled): New project, Create class/space, Join a class, Upload syllabus,
  Add a section, Send a notice, New message, Hand in the project, Join this group.
- `btnAction` (outlined): Edit, Publish, Deadline, Close, Report, Project archive, Save as
  template, Join with code, Back to projects, Find work, Take it back, Member limit.
- `btnDanger` (outlined): Archive (project, space, group), Delete, Empty trash, Leave group.
  A button that reads Restore uses `btnAction`.

Button variants: `create`, `onNavy` (now reads `--btn-action`) and `destroy`. `accent` is
unchanged and stays on the auth pages. The hardcoded white or amber banner links in
`GeneralProject`, `SpaceArchive`, `MyTasks` and `Messages` now use these variants.
Defaults: create is amber, the outlined two follow `--banner-ink`. Outlined picks are pushed
to 4.5:1 against the banner; the create fill gets `inkFor` text. `appearance.sql` accepts
the three keys (applied live, `appearance.test.sql` 28 PASS). New default look: Upload
syllabus, Add a section, Send a notice and New message are now filled. The trash-icon
deletes no longer hover red; they follow `btnDanger`.

**Change (2026-09-28, late): the Teaching section folds.** `NavGroup.collapsible` (set on
Teaching only) turns the section header into a toggle with a chevron. The folded titles
are kept in localStorage under `collabify:nav-folded`, so the choice is per device. While
folded, the row for the current page stays visible (`matchPath`). The icon-only rail
ignores folding because it has no header. Verified on localhost: fold, reload, unfold.

**Change (2026-09-28, late): work project Overview reads first, edits on demand.** In
`OverviewTab`, Details and Fields show as plain text for everyone. Anyone with
`edit_project` (the Owner, plus anyone the Owner grants it to) gets an Edit button on each
section. Details: Edit opens the form, and Save or Cancel returns to text. Fields: Edit
shows Add field, the per-field move/edit/remove controls and every value input, with one
Save fields at the bottom. It checks every changed value before writing any and skips
unchanged ones. The per-row Save buttons are gone. Verified on localhost: open both, cancel
Details, save Fields with nothing changed (no write).

**Change (2026-09-28, late): the rail shows three spaces and three projects.** In
`spaceRows.ts`, `SPACE_CAP` and `PROJECT_CAP` are both 3 (they were 2 and 4). Classes stay
at 2 (`CLASS_CAP`). `SideNav` passes `PROJECT_CAP` to `recentProjects`, so projects are
still the most recently changed. The rest are behind each header's All link.

**Change (2026-09-28, late): banner action rows are icon-only.** New `ui/IconAction`: a
32px square `Button`/`Link` in the banner variants. Its label is the accessible name and
shows in a tooltip on hover and focus. The tooltip is portaled to <body> because banners
clip overflow. It's used on the work project banner (Project archive, Report, Save as
template, Archive project), the class project manage row, the group manage row (Member
limit, Archive/Restore, Delete) and the space banner (Archive/Restore, Delete).
`SaveTemplateButton` now renders its own `IconAction` and takes no `className`. Single
primary actions (New project, Hand in the project, Join this group) keep their text.
Icons: `archive` is now a filing cabinet, since the lidded box read as the bin. New
`history` icon for "Project archive", so the two archive buttons differ.

**Change (2026-09-28, late): main buttons wear the Create colour.** `Button`'s `primary`
variant (Save, Create, Send and every default main button in dialogs and Settings) now reads
`--btn-create` / `--btn-create-ink`, like the banner `create` variant. So the default is
amber with navy text, and a person's Create pick reaches all of them. `accent` (auth pages)
is unchanged. In Your colors, the group is renamed "Buttons" and the slot "Create and save".

**Change (2026-09-28, late): Sign out is always red.** New fixed `signout-{50,400,500,600}`
tokens in `@theme`, copied from the danger defaults and never set by `lib/palette.ts`. So a
person's danger (Late) pick no longer recolours Sign out. It's used by the Settings button,
the account menu item in `TopNav` and the Pending page's sign-out.

**Change (2026-09-28, late): every delete control is always red.** The fixed Sign-out tokens
are renamed `destructive-{50,400,500,600}` (in `@theme`, never in `lib/palette.ts`). They
are now used by:
- `Button` `danger`, which covers delete confirmations via `ConfirmDialog`, Delete class,
  Delete palette, Remove member, Sign out and Empty trash.
- `ActionMenu` `tone: 'danger'` items.
- The 17 trash-icon buttons in lists, dialogs and cards. They were swapped by a script that
  only touched the class line just before a `name="trash"` icon.
- `IconAction` `variant="danger"` for Delete project, group and space on banners.

Archive and Leave group still follow `btnDanger`, renamed "Banner archive" in Your colors.
Errors and the Late status keep the customizable `danger` ramp.

**Fix (2026-09-29): "Maximum update depth exceeded" when dragging a colour picker.** In Your
colors, each `input` event from the native "Any color" picker called `setColors`, which
re-renders the whole app (about 24ms each). `SlotRow`'s `useEffect(() => setDraft(shown))`
then queued a second update after every one, so a fast drag stacked nested updates past
React's limit and threw. Reproduced with 120 synthetic input events. Now:
- The hex box holds a draft only while being edited, with no effect.
- The picker thumb follows local `live` state.
- The pick itself goes out once per animation frame, and is flushed if the row closes
  mid-drag.
Verified: 201 events, no errors, 1.8ms each.

Testing note: the Browser pane's page can report `document.hidden`. rAF and blur don't fire
then, so restore a test colour with a swatch click, not the hex box.

**Change (2026-09-29): Classes shows three in the rail too.** `spaceRows.ts` has one
`CAP = 3` for Classes, Spaces and Projects. `PROJECT_CAP` is kept as an export for
`SideNav`.

## Session — 2026-09-29: Shared with me

Teammates can pass a draft file or folder to each other without submitting it.

**What users see.** My draft's 3-dot menus (file row, folder row, current-folder bar)
have **Share**. It opens `ShareDialog`: an "All members" checkbox over a `CheckboxList`
of the project's other members. A new **Shared with me** tab sits right after Files:
- Work projects: always there.
- Class projects: students only. A professor sent to `?tab=shared` lands on Brief.

`SharedTab` lists what came to you. You can open it read-only (`OpenFile.sharedBy`
freezes `FileEditor` and hides Summarize), download it (a folder as a zip), copy it to
your draft, or remove it from your list. A collapsed "Shared by me" section has Stop
sharing. A folder share is browsed with `?share=…&spath=…`. Recipients get a
`file_shared` bell notice, gated on `notification_prefs.submissions`; Settings now calls
it "Reviews and shared files".

**Rules, in `supabase/general-shares.sql`.**
- A share is a copy as of sharing, held in `general_shares.files` jsonb. Recipients are
  in `general_share_recipients`. Sharing the same path again with the same person
  replaces their older copy.
- RLS: only the sender and the recipients can read a share, and only while they are
  project members (`general_share_readable`).
- There are no write grants. The only writers are the RPCs `share_general_draft_path`,
  `unshare_general_share`, `dismiss_general_share` and `copy_general_share_to_draft`.
  The copy refuses and names the path if any path is already in your draft.
- A frozen class board refuses new shares through `guard_class_board_files`.
- `storage_orphans` counts shared `storage_path`s as used. So the file runs **before
  `storage-sweep.sql`**, and the restore line in `docs/07-backup.md` is updated.

**Verified.** `tests/general-shares.test.sql`: 24 PASS. The general-drafts, class-files
and trash suites: 101 PASS. Typecheck, 562 unit tests, build, contrast, a11y-names and
motion-lint all pass. The owner clicked through the UI.

Lint still has 3 errors that were already there, in `FilesTab.tsx:452`,
`NudgeButton.tsx:49` and `Submissions.tsx:146`, so `npm run check` stops at lint.

**Follow-up (2026-09-29): lint clean.** The 3 older lint errors are fixed (`65701cd`), and
`npm run check` now passes end to end. What remains is 27 warnings.

**Follow-up (2026-09-29): one clock for "overdue".** `hooks/useNow.ts` is a shared clock that
ticks once a minute (`useSyncExternalStore`, one timer however many components use it). It
replaces `Date.now()` in render in EventChip, ProjectCard, TaskSummary, the work Tasks
summary, StudentHome and MyTasks. `StatusDonut` works out its segment offsets before drawing,
and MyTasks memoizes `classFiltered`. Lint: 0 errors, 19 warnings, all
`react-refresh/only-export-components`.

**Follow-up (2026-09-29): lint has 0 warnings.** Component files now export components only:
- `AuthProvider`, `ThemeProvider` and `ToastProvider` moved into their own files (`main.tsx`
  imports them). `useAuth`, `useTheme` and `useToast` stay where every page imports them.
- Helpers moved out: `lib/formatBytes.ts`, `ui/buttonClass.ts`, `projects/dueLabel.ts`,
  `projects/weekSpan.ts`, `calendar/eventLook.ts`, `reports/csv.ts`, `analytics/scope.ts`,
  `groups/groupFilterState.ts` and `tasks/taskFilterState.ts`.
- `motion-lint` now checks `ToastProvider.tsx` for `motion-toast`.

## Session — 2026-09-29: one join code each, for good

Owner asked for class, space and project join codes to be permanent: no more "New code".
- `supabase/join-codes.sql` (new, before `anon-lockdown.sql`) adds triggers:
  `classes.code`, `general_space_join_codes.code` and `general_join_codes.code` can never
  change once made. Space and project code rows cannot be deleted directly; they go only
  when the space or project is deleted (cascade, `pg_trigger_depth() >= 2`).
- `set_general_join_code` and `set_general_space_join_code` make a code only the first time
  one is opened. `p_regenerate` is still accepted and ignored. Opening and closing still work.
- UI: the "New code" buttons are gone from the project Invite panel and Space members. Both
  now say the code stays the same for good.
- Applied live (both functions, the new file, and `anon-lockdown.sql` again). Suites pass:
  access, general, general-spaces, general-space-teams, one-workplace and anon-lockdown.
  Per the owner, the original bug was not reproduced.

## Session — 2026-09-29: Discussion tab

A Discussion tab in every project: work projects after Overview, class projects after
Brief (students only, like Files; professors are sent to Brief).
- `supabase/general-discussions.sql` (after `general-shares.sql`, before `storage-sweep.sql`):
  - Tables: `general_discussion_folders` (one level), `general_discussions` (live while
    `ended_at` is null; one live per project by a partial unique index) and
    `general_discussion_messages` (text only).
  - Select is through `is_general_member`; every write goes through RPCs (start, send, stop,
    save file with an `updated_at` check, rename, move, delete, and the folder RPCs).
  - `stop_general_discussion` writes the conversation, HTML-escaped, into `content_html`.
    Only the starter can stop it, or an Owner or Manager once the starter has left.
  - Frozen boards refuse writes through `guard_class_board_files`.
  - A `discussion_started` notification goes to the other members, gated on
    `project_updates`; for a class board it opens the class project.
  - Tests: `tests/general-discussions.test.sql`, 20 PASS.
- `work-ai` (deployed): the `tasks` action reads `discussion_id` (stopped discussions only,
  through the caller token) in place of a Main file `path`.
- UI:
  - `DiscussionTab.tsx`: the notice, folders, files, the live room, stop with a confirm,
    and the file editor (`RichEditor`) with .docx and .pdf download.
  - `lib/general/pdf.ts`: jsPDF, lazy-loaded.
  - `TasksFromNotes`: "From a discussion" replaces "From a file"; an `onSave`/`mayAssign`
    override lets class boards save through `ClassTasksFromNotes` (`addTask` + `claimTask`).
  - `StudentTasksView` gets a From notes button.
- Verified: the SQL suite, `npm run check`, and PDF/.docx export in the browser (80
  messages, 5 pages). Not yet clicked through signed in.

**Follow-up (2026-09-29): discussions go to Trash.** Delete is now "Move to trash"
(`trash_general_discussion`, starter or Owner/Manager, stopped discussions only).
- `trashed_at`/`trashed_by` on `general_discussions`. The read policy hides a trashed
  discussion from everyone but whoever trashed it.
- `restore_trashed_discussion` and `delete_trashed_discussion` belong to the person who
  trashed it. `delete_general_discussion` is dropped.
- `trash.sql` lists (`kind = discussion`), empties and purges them (30 days).
- Deleting a folder whose only discussions are in Trash is allowed; they come back at the
  top level.
- The Trash page links a restored discussion to `?tab=discussion`.
- Suites: general-discussions 25, trash 36, anon-lockdown 15, all PASS.

**Follow-up (2026-09-29): every table has row-level security.** `general_report_settings`
had none, and anon held full rights on it. `general-reports.sql` now enables RLS on it with no
policies and revokes the grants; only the security-definer `general_report_history_since`
reads it. New `tests/rls-coverage.test.sql` fails if any public table lacks RLS (it failed 3
checks before the fix, 4 PASS after).

**Trap:** re-running `general-reports.sql` on its own reverts `general_report_file_ok`, which
`trash.sql` redefines. Re-run `trash.sql` and `anon-lockdown.sql` after it (done here).

**Follow-up (2026-09-29): reassignment notices open Reassignments for teachers.** In
`NotificationBell.tsx`, `destination()` takes a third argument, `teaches` (`canTeach(profile)`).
For someone who teaches, `reassign_requested` and `reassign_decided` go to
`paths.reassignments`. Everyone else still falls through to the class project.

## 2026-09-29 — end of day

Everything below is on `main` and live on dyci-collabify.vercel.app (last commit `8743817`).

| Commit | Change |
| --- | --- |
| `c5b7b8b` | Shared with me: share draft files and folders with groupmates |
| `65701cd` | The last 3 lint errors fixed |
| `6f06dc5` | `useNow` shared clock; donut offsets; `classFiltered` memoized |
| `d1593b6` | Component files export components only (0 lint warnings) |
| `854c3d9` | One join code per class, space and project, for good |
| `af34dda` | Discussion tab: live room, saved files, folders, .docx/.pdf, From notes |
| `000500e` | Discussion files go to Trash instead of being deleted |
| `8a020b1` | RLS on `general_report_settings`; `rls-coverage` test |
| `8743817` | Reassignment notices open Reassignments for teachers |

**State of the checks.**
- `npm run check` passes end to end: typecheck, lint with 0 errors and 0 warnings, 565 unit
  tests, build, contrast, a11y-names, schema-drift, motion-lint. schema-drift still lists the
  same 11 "check by hand" hints, none of them new. legal-ready is not enforced and only
  lists its placeholders.
- SQL suites added today: `general-shares` (24), `general-discussions` (25) and
  `rls-coverage` (4).

**Restore order changed** (`docs/07-backup.md`):
- `general-shares.sql` and then `general-discussions.sql` run after `teaching-guards.sql` and
  before `storage-sweep.sql`.
- `join-codes.sql` runs just before `anon-lockdown.sql`.
- Re-run `anon-lockdown.sql` after adding any function.

**Deployed outside git.**
- `work-ai` was redeployed with `supabase functions deploy work-ai`. Its `tasks` action now
  reads a stopped discussion (`discussion_id`) instead of a Main file (`path`).
- New dependency: `jspdf`, loaded only when someone downloads a discussion as PDF.

**Consultation guide.** A Claude Docs document, "Collabify consultation guide", covers the
12 consultation topics with answers drawn from this codebase. Link:
https://claude.ai/code/artifact/76f49ab4-6783-4b1a-b5b0-92ecccdf368b. Its figures (84 tables,
565 tests and so on) are as of today; refresh them if the schema grows.

**Still open (owner's to do, from the guide's checklist):**
- Supabase backup retention is still unverified in `docs/07-backup.md`. Check the dashboard
  and take one manual `pg_dump`.
- ERD image and one data flow diagram for the consultation.
- Evaluation results (respondents, mean score per characteristic) on one page.

**Known limits, if asked** (the answers are in the guide):
- dev and production share one Supabase project
- `npm run check` is not run by CI
- no load test
- the CSP is report-only
- no two-factor sign-in

**Follow-up (2026-09-29): the Discussion notice closes.** `Alert` takes an `onClose` (an x
button, "Close this notice"). In `DiscussionTab` the room notice closes to a small "What this
room is for" link that opens it again. The choice is kept per browser in `localStorage`
(`collabify.discussion-notice-closed`), wrapped in try/catch.

**Change (2026-09-29): review requests go to several reviewers.**
- `general_repo_changes.reviewer_ids uuid[]` (GIN index), backfilled from `reviewer_id` with
  the table triggers off for that one statement. `reviewer_id` stays as the first reviewer.
- The submit RPCs take `p_reviewers uuid[]` after `p_reviewer`; the old 4/5-argument
  versions are dropped. `general_review_reviewers` de-duplicates them and checks every one is
  a project member and not the author.
- Any one reviewer may answer (`answer_general_repo_change`), and the first answer decides.
  An empty list keeps the old rule: anyone with `edit_files`.
- Updated to read the list: the guard trigger, `notify_review_requested` (class-files.sql and
  notification-coverage.sql), `general_since_last_visit`, the report summary and reviews
  (shown as "Name and N more"), `listMyOpenReviews` (`contains`) and `groupChanges`.
- The UI Submit dialog has an "All members" checkbox and a member checklist.
- Applied live as a patch of just the changed objects (no whole-file re-run). New
  `tests/general-review-many.test.sql`: 11 PASS. Existing drafts, restore, folders, general,
  reports, work-automation, class-files and anon-lockdown suites all pass.

**Change (2026-09-29): a Groups tab inside group class projects.** For professors, a group
project is now `Brief · Boards · Groups`. Boards is the old per-group tab, renamed with its
id still `tasks`, so `?tab=tasks` links still work. The new `components/groups/ProjectGroupsTab`
uses the same `GroupsBoard` and `useGroupsData` as the class Groups tab and the Groups page,
keyed on `project.class_id` and filtered to `project.group_set_id` and its groups and members.
It has Close set and Reopen; creating and deleting sets stays on the Groups page, because
other projects may share a set. Individual projects stay `Brief · Students`. `?tab=groups` on
an individual project, or for a student, falls back to Brief once the project loads.
- Checked signed in as the owner on localhost, with no failed requests:
  - Lab 6 shows only Trial Group; the Groups page still shows every set
  - the Boards tab, the class Groups and Projects tabs, and group card links all work

**Fix (2026-09-29): changing a class project between individual and group now saves.** Editing
saved through `update_project_series`, which leaves out `audience` and `group_set_id` on
purpose (a set belongs to one class), and nothing else saved them, so the change was dropped
silently.
- New `set_project_audience(project, audience, set)` in `project-series.sql`. It is security
  definer and checks `is_class_professor`. It deletes the old boards and updates the project;
  the `projects_ensure_boards` trigger then makes the new boards (one per student, or one per
  group of the set).
- It refuses once any board has work: tasks, a hand-in, a result, or anything in the board's
  Files or Discussion. Only the edited section changes; series siblings keep theirs.
- `ProjectWizard` calls it first on save when audience or set changed, so a refusal stops the
  save before anything else is written.
- Applied live as just the new function. New `tests/project-edits.test.sql`: 16 PASS, covering
  title, type, brief, points, deadline and rubric saves, every audience and set switch, and the
  refusals. Also pass: series 44, class-files, deadline-lock, submissions, teaching-guards,
  group-archive, reassignments, results, notification-coverage, insight.
- Not clicked through in the browser, since it would change live projects and notify students.

**Change (2026-09-30): Classes and Spaces fold in the rail.** Both sidebar sections now fold
like Teaching (`collapsible: true` in `nav.ts`), and the header "All" link is gone from them.
In its place each section has a page row: Classes gets "Classes" above Groups, Spaces gets
"Spaces" under the live rows. Folded, a section hides its live rows too and keeps only the row
for the page you are on. Projects keeps its "All" link.

**Follow-up (2026-09-30): "All" links sit under the rows.** The Classes and Spaces page rows
from the change above are gone again. Classes, Spaces and Projects each end their live rows
with a small faint "All classes / All spaces / All projects" link (`MoreLink` in `SideNav`),
with no icon, so it does not read as a page. The header no longer carries an "All" link.
Projects now folds too. "All projects" is `/projects`, which lists work projects only; class
projects keep their row under Classes. Folded, a section also hides its "All" link unless
that page is open.

**Change (2026-09-30): stalled groups scroll after three.** On the professor dashboard,
`StalledGroups` shows three cards and scrolls the rest inside the list. The height is measured
from the third card (ResizeObserver), since a card grows when Remind wraps. The list is padded
by 4px so shadows and focus rings are not clipped.

**Change (2026-10-01): "Your work" shows three in Coming up and Jump back in.** Only on the
`/home` work section (`WorkOverview`); a space's own dashboard is unchanged. Coming up keeps
the three soonest items (`firstComing`). Jump back in lists the three projects the person
opened last, read from `general_project_visits.seen_at` (`listMyProjectVisits`), which the
project page already stamps on every open. Projects never opened fill any gap, most recently
changed first (`recentlyVisited`).

**Change (2026-10-01): "Your work" is built like the class dashboard.** On `/home`, the work
section now opens with the same banner as the class dashboard above it (`DashboardSummary`,
which takes a `title` in place of the greeting): kicker, one line of what is true, and four
tiles (Waiting on you, Tasks overdue, Projects you are on, Spaces). New space and Join with
code moved into the banner as buttons; the shortcut cards and the Inbox card are gone (Inbox
is in the rail). My tasks, Coming up and Jump back in got "See all" links, and someone with
no spaces or projects gets the shared `EmptyState` instead of four empty panels.

**Change (2026-10-01): the highlighted shortcut wears the banner colour.** On a space
dashboard, the `primary` card in `QuickActions` (New project) is filled with `--banner` — the
banner's left edge, whatever the person picked in Settings → Appearance — with `banner-ink`
text and a `banner-accent` icon, instead of fixed navy. The other cards are unchanged.

**Change (2026-10-01): space shortcut outlines follow the banner.** The other `QuickActions`
cards are outlined in `--banner-edge` (Tailwind `border-banner-edge`), a new personal-slot
token: the banner colour, set by `lib/palette.ts` and pushed to 3:1 against the page only when
it would be too faint to see. Defaults: `var(--banner)` in `:root`, `navy-500` in `.dark`
(the default banner is the dark page's own colour). Hover tints the card with it.

**Change (2026-10-01): space shortcut icons take the banner's right side.** New token
`--banner-end` (`text-banner-end`): a gradient banner's second colour, the glow colour on the
glow style, or the solid colour, pushed to 3:1 against the sunken icon tile by
`lib/palette.ts`. Defaults: `amber-600` in `:root`, `var(--banner-glow)` in `.dark`. The
outlined `QuickActions` cards use it for their icons; New project keeps `banner-accent`.

**Change (2026-10-01): "How it runs" plays the launch film.** The landing section
(`components/landing/Workflow.tsx`) no longer steps a mock board on scroll. It is now the
45-second launch video in a player, with the film's six chapters on the left. The active chapter
follows playback and choosing one seeks to it.
- Files live in `public/video/`: `collabify-launch.mp4` (10 MB, 1080p60, with the voice-over),
  `collabify-launch-poster.jpg` and `collabify-launch.en.vtt` (captions, the voice-over text).
- Nothing is fetched until play (`preload="none"`); native controls appear after the first play.
- Phone order is heading, film, chapters; from `lg` up the film spans both rows on the right.
- The film's source is `launch-video/` (HyperFrames project, sound scripts, storyboard), which is
  not committed. Re-encode for the site with: `ffmpeg -i final.mp4 -c:v libx264 -preset slow
  -crf 25 -maxrate 4000k -bufsize 8000k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`.
- Checked on localhost: plays, captions track loads, chapter click seeks to 19.0 s and lights
  chapter 3, no horizontal scroll at 375 px. `npm run build`, `tsc -b` and eslint pass.

**Change (2026-10-01): teachers switch between their two Home dashboards.** For faculty who
can teach (`canTeach`), `/home` shows the class dashboard or the work dashboard, not both
stacked. A swap button (new `swap` icon, `IconAction`) sits top right on each banner:
"Switch to your work dashboard" / "Switch to your class dashboard". The choice is kept in
`localStorage` (`collabify:home-view`, defaults to classes). `WorkOverview standalone` greets
like a home page with the kicker "Your work". Everyone else still gets the stacked page.
`DirectoryHero` gained a `corner` slot for the no-classes banner, and `IconAction` tooltips
now stay inside the window.

**Change (2026-10-01): the week card on a class Overview folds away.** `ThisWeek`
(`components/classes/ThisWeek.tsx`) starts closed as a slim "Week N · title" button; opening
it shows the `TermStrip` card, which now takes `onClose` for an X in its corner. The choice
is kept per class in `localStorage` (`collabify:this-week:<classId>`). Teachers and students
both get it. The student Home dashboard's term strip is unchanged.

**Change (2026-10-01): the mouse wheel scrolls tab strips sideways.** In `ui/Tabs`, a wheel
over a strip wider than the page scrolls it left and right (non-passive listener); at either
end the wheel goes back to scrolling the page. Covers every `Tabs` user: class, class
project, work project, group pages and the Files/Tasks tabs.

**Change (2026-10-01): the class banner sizes itself by its own width.** `ClassHeader` is a
`@container`; it goes two-column only when the banner is at least 960px wide (it used the
`lg` viewport breakpoint, which beside the rail left the class name a ~200px column).
Below that it stacks. The joining switch is a third cell in the code/roster strip instead
of its own row, and padding and the initial tile are tighter on narrower banners. At a
1056px window the banner went from ~540px to 292px tall with nothing removed.

**Change (2026-10-01): native controls follow the theme.** `color-scheme: light` on `:root`
and `color-scheme: dark` on `.dark` (and light again for print) in `index.css`. The date,
datetime and time pickers' icons, their calendar popups and native scrollbars now match the
theme everywhere, instead of staying light in dark mode.

**Change (2026-10-01): admin rail has Syllabi and Curriculum again.** The admin Library
(one page with a Syllabi/Curricula switch) is split into two rail rows and routes:
`/admin/syllabi` and `/admin/curriculum`, both `ProgramLibrary` with a `kind` prop, no
switch. `/admin/library` forwards to `/admin/syllabi`; the AdminHome card points there too.
Owner checked it as an admin on 2026-10-01.

**Change (2026-10-01): Meetings.** A Main rail page, `/meetings` (`pages/app/meetings/Meetings.tsx`),
for Zoom or Google Meet calls. Collabify does not create the call: somebody pastes its link
(`lib/meetings.ts` `detectPlatform`, mirrored by `meeting_url_ok` in SQL) and picks an audience:
whole class, class group, whole work space, work project, space team or project team.
Rules live in `supabase/meetings.sql` (applied to live 2026-10-01; test
`supabase/tests/meetings.test.sql`, 27 checks, rolls back):
- create: a class's teaching faculty (`is_class_professor`, co-teachers included) for the
  whole class; a group's own students or the class faculty for a group; any member of a
  work space, project or team for it. Writes only through `create_meeting` /
  `update_meeting` / `cancel_meeting`; reads through `list_my_meetings` and
  `meeting_audiences` (which also drives the scheduler's Where/Who pickers).
- a group meeting is seen by the group and whoever scheduled it, not the whole class.
- notifications `meeting_scheduled|changed|cancelled` go to the whole audience except the
  person acting, with no Settings switch (always delivered). Bell opens `/meetings?meeting=<id>`.
- Calendar shows them as kind `meeting` (`calendar/meetingDates.ts`); class/group meetings
  sit under Classes, work ones under Work. Cancelled ones are left off Calendar.
No reminders, recurrence or RSVP (out of scope by the owner's choice).
DB note: `node scripts/db.mjs` failed on the IPv6-only direct host this session; the IPv4
session pooler (`aws-0-ap-southeast-1.pooler.supabase.com`, user `postgres.<ref>`) worked.
Meetings also skip the hidden project behind a class board's Files (`general_projects.class_board_id`,
class-files.sql) and its "Class project files" space: `meeting_audiences` leaves them out and
`create_meeting` refuses them. Those students meet as their group.

**Change (2026-10-01): students archive the tasks they added.** `supabase/task-archive.sql`
(applied live; test `supabase/tests/task-archive.test.sql`):
- Class tasks gained `archived_at`/`archived_by`. A student on the board archives, via
  `archive_class_task`, any task that is theirs (they added it, or are on it) or that
  nobody holds yet — professor-set ones included (owner's call, 2026-10-01); not a task a
  groupmate holds. Restore and `delete_archived_class_task` are whoever archived it or the
  class faculty. The select policy hides archived rows, so every `security_invoker` view
  (boards, progress, analytics, reports, Calendar) drops them like deleted ones; the owner-
  rights readers (deadline/overdue/digest notices, claim caps, group summary,
  `admin_class_overview`) were redefined with `archived_at is null`.
- `guard_task_edit` pins the archive columns unless `collabify.task_archive_op` is on
  (read with `coalesce` — an unset setting is NULL and `not NULL` skipped the pin).
- Work tasks: a creator may archive their own task any time (`archive_general_task`), and
  `guard_general_task` skips its holder check while `collabify.general_archive_op` is on.
- UI: an Archive icon on a student's own class task card (`TaskCard`/`TaskBoard`); My tasks →
  Archived tasks lists class and work archives together (`ArchivedTasksModal` items).
The notifications and analytics SQL suites fail the same way with or without this change
(task_assignees duplicate key; files sign-in guard) — pre-existing, not looked into.

**Change (2026-10-01): Archive page, and Trash for everything it holds.** New Account rail row
**Archive** (`/archive`, `pages/app/Archive.tsx`) for students and faculty, beside Trash; admins
do not get it. One page for everything the reader archived or may act on in an archive, with a
section rail (desktop) / strip (phone), search, All · Classes · Work (only with both), and a
filter for who archived it and sort. Each row: Restore (or "View only"), View details, Open
where it lives, Move to trash. Empty sections stay and say where that kind is archived from.
- Sections follow access (`lib/archive.ts` `archiveKindsFor`): student = Class tasks, Class
  project files, plus Space teams / Work projects / Work tasks / Work files once invited to work;
  teaching faculty = Classes, Groups, Class projects, Class tasks (theirs and students'),
  Syllabi, Curriculum, plus all work incl. Spaces; faculty who do not teach = work only.
- `supabase/archive-page.sql` (applied live; test `tests/archive-page.test.sql`, 43 PASS):
  `list_my_archive()` returns rows with `restore_block` / `trash_block` (null = allowed, else
  the reason shown). Restore runs each kind's own archive call. Trash now also takes classes
  (with their education space), groups, class projects, class tasks, spaces, space teams, work
  projects and work tasks — from Archive only, by whoever may delete it for good. Restoring
  from Trash puts these back in Archive (files still go back live, as before). Trashed rows
  stay archived and are hidden from every read by restrictive `<table>_not_trashed` policies.
  `purge_trash` deletes them after 30 days as the person who trashed them; anything that may
  no longer go (rights lost, account gone) returns to Archive instead.
- A group holding work still cannot go to Trash. `guard_group_delete` now lets a whole-class
  delete from Trash through (`collabify.class_delete`). The old Class settings → Delete class
  button is a plain table delete and is still refused by that guard for any class whose groups
  hold work — pre-existing, not changed here.
- Checked: build, eslint, 582 Vitest, SQL suites trash, task-archive, group-archive,
  general-archive-rbac, general-project-archive-rbac, space-delete, general-space-teams,
  general-spaces, anon-lockdown, rls-coverage, class-files, general-discussions,
  one-workplace, teaching-guards. UI checked with a throwaway probe route (fixture data, all
  four access shapes, 1440 / 1280 light / 768 / 375, no horizontal scroll), then removed.
  `list_my_archive` run as real accounts in rolled-back transactions: 60–150 ms.

**Change (2026-10-02): space Settings tab; no delete in class or space settings.**
- New space tab **Settings** (`/spaces/:id/settings`, `pages/general/SpaceSettings.tsx`),
  shown only to the space's Owner (`update_general_space` / `archive_general_space` are
  Owner-only). Space details (name, description; read-only while archived) and one archive
  section: Archive space (with confirm) until archived, then only Restore space.
- The banner's Archive/Restore and Delete space icons are gone, as are Members' "Edit space"
  button and "Space archive" section. `EditSpaceDialog` and `deleteSpace` were removed.
- Class settings: the Delete class section is gone (it was a plain table delete that
  `guard_group_delete` refused for any class whose groups hold work). Archive, then Restore,
  as before. `deleteClassPermanently` removed. Deleting a class or space now only goes
  Archive page → Trash.
- Checked: build, eslint, 582 Vitest; both settings panels in a throwaway probe route
  (live and archived states, confirm dialog, 1280 and 375 with no horizontal scroll), then
  removed.

**Fix (2026-10-02): archiving a class leaves the sidebar right away.** Class settings now
reloads the sidebar's spaces (`useGeneralNavigation().reload`) after Archive and Restore —
the sidebar lists classes through their education spaces, which the class trigger archives.
`general_spaces`, `general_space_members` and `general_space_invitations` were also never in
the `supabase_realtime` publication, so the sidebar's `useLive` only caught space changes on
refocus or the 30 s poll; added at the end of `general-spaces.sql` (idempotent block, applied
live). Other open tabs now update within a second for anyone who can still read the space.

**Change (2026-10-02): sections assigned to teaching faculty; admin Archive page.**
- `supabase/section-faculty.sql` (applied live; test `tests/section-faculty.test.sql`, 18 PASS):
  `program_section_faculty (section_id, faculty_id)`, cascade on section delete. Read: admins
  all, faculty their own rows; no direct writes. `set_section_faculty(section, faculty[])` is
  admin-only, replaces the section's whole list, and refuses archived sections and anybody
  who is not active faculty with `can_teach`. Added to realtime.
- Admin → Sections: each row shows its assigned faculty and an **Assign faculty** dialog
  (checkbox list of active teaching faculty, search past six). Retire and the trash button are
  gone; an **Archive** icon takes their place. Archived sections leave the list.
- Admin → Account → **Archive** (`/admin/archive`, `pages/app/admin/AdminArchive.tsx`):
  archived sections, published syllabi and published curricula, each with Restore and
  **Delete for good** (confirm). A resource goes Trash → `delete_trashed_resource` in one step,
  so only the admin who published it can act on it (others see why). Students/faculty keep
  `/archive` as before.
- Create class (`NewSpaceDialog` → `ClassForm assignedTo`, the only create-class path; it is
  opened from Classes, Spaces and Work overview): the section picker lists only the teacher's
  assigned, live sections (`listMySections`), labelled with year level and school year, and
  Year level is locked to the picked section's. No sections assigned → picker disabled with
  "No section is assigned to you yet." A program with no sections at all keeps free text.
  Class settings (editing) is unchanged. School year is not taken from the section.
- Live now: four sections exist and none are assigned, so teaching faculty cannot create a
  class until an admin assigns them one.
- Space archive hint on the Archive page now says Settings tab, not banner.
- Checked: SQL tests section-faculty, rls-coverage, anon-lockdown, program-office; the four
  REST calls against the live API (embed filter with throwaway rows, cleaned up); build,
  eslint, 582 Vitest; UI via a throwaway `probe.html` that stubbed fetch with fixtures
  (assign, archive, restore, delete for good, form with two/none/no-registry), 1280 and 375.
  `node scripts/db.mjs` hung mid-session (pooler); REST was used for the later checks.

**Change (2026-10-02): group leaders.** A group can have one leader (`groups.leader_id`).
- Group page (`GroupDetail`) → Members panel shows a **Group leader** row and a Leader badge
  beside that member. A member may pick a leader while there is none; after that only the
  leader (hand it on, or "No leader" to step down) or the class professor can change it. Stays
  open after the set is final; blocked while the group or class is archived.
- Class project → Progress (`MemberProgress`, student Progress tab and the professor's
  "Share of the group") shows the badge; on a phone it is the crown alone.
- `supabase/group-leader.sql`: the column, `group_overview` rebuilt to carry it,
  `set_group_leader(group, student|null)` (the only way to write it — `groups_guard_leader`
  reverts plain updates unless `collabify.group_leader_op` is on), and an after-delete
  trigger on `group_members` that clears the lead when the leader leaves, is moved, or is
  dropped from the class. Applied live 2026-10-02; `tests/group-leader.test.sql` 24 PASS, plus
  group-archive, rls-coverage, anon-lockdown, trash, archive-page.
- Group cards (`GroupCard`, class Groups tab and Groups page) show the leader under the
  faces, leader first among them, or "No leader yet".

**Change (2026-10-02): school year follows the section too.** In the create-class form
(`ClassForm assignedTo`) School year is now locked to the picked section's `school_year`, as
Year level already was, and that value is what gets saved — so the class lands in the
section's cohort on the admin figures (matched by name + school year). A section year outside
`SCHOOL_YEARS` is still shown. Checked with a throwaway fixture page, build, eslint, 582 Vitest.
