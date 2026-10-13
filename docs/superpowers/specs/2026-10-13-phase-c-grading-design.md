# Phase C: peer evaluation, rubric scoring, intervention notes

Date: 2026-10-13
Status: awaiting review
Roadmap: Phase C of three. Phase A (Analytics) is live. Phase B (Reports) comes after this phase.
Previous spec: `2026-10-13-class-analytics-redesign-design.md`.

## Why

Professors grade group projects, and a group grade hides who did the work. Collabify records
effort (tasks, activity, hand-ins). It has had no grades, no peer view of contribution, and no
record of what the professor did when a warning showed up.

Three needs come from the 2026-10-13 decisions:

- **Grading.** Score each project against its rubric. Adjust individual scores in group work,
  using evidence that is fairer than task counts.
- **Weekly check-in.** Hear early, from the students themselves, that a group is struggling.
- **Accreditation records.** Show that the professor graded against a stated rubric, acted on
  warning signs, and kept a history.

## Decisions (user, 2026-10-13)

| Question | Decision |
|---|---|
| Grades in Collabify | **Yes.** This reverses the old "no grade, no score" rule. |
| Peer evaluation format | **CATME's five dimensions**, rated 1–5 with written anchors. Self included. Optional comment that only the professor sees. |
| Effect on individual scores | **Collabify suggests, the professor confirms.** Suggested = group score × adjustment factor, capped at 105%. |
| What students see | After release: their **score**, the **rubric breakdown**, and **their own peer summary** (their per-dimension averages next to the team's). They never see who rated them or any comment. |
| When students rate | **The professor opens rounds** (check-in or final) with a closing date. Only the final round feeds scores. |
| Rubric after scoring starts | **Points and criteria lock. Wording stays editable.** Clearing scores unlocks it. |

## Shape

One spec, three parts, built and shipped in this order. Each part gets its own plan and review.

1. **C1: peer evaluation.** Rounds, the student form, results, flags.
2. **C2: rubric scoring and release.** The grades table, the score card, individual adjustment,
   release, the student grade card, a stable rubric, and score history.
3. **C3: intervention notes.** A staff-only log. Nudges write to it.

## Shared rules

- **Who is staff.** "Teaching staff" means `is_class_professor(class)` / `is_project_professor` /
  `is_board_professor`. These already include co-teachers. Admins who do not teach are not
  staff, which matches CLAUDE.md.
- **Writes.** Every write goes through a `security definer` function or a narrow policy. These
  refuse writes when:
  - the class or project is archived;
  - the round is closed;
  - the caller is not allowed.
  Refusals raise `check_violation` with a sentence a person can act on.
- **New tables** get row-level security (enforced by `tests/rls-coverage.test.sql`) and text
  caps in `hardening.sql`. After each table, re-run `anon-lockdown.sql`. Add each table to
  `live.sql` when the page needs live updates. Add each new SQL file to `scripts/schema-drift.mjs`
  ORDER and to the rebuild chain in `docs/07-backup.md`, after every file it reads.
- **Thresholds** are named constants in TypeScript, with unit tests, as in Phase A.
- **Copy** follows CLAUDE.md: sentence case, active voice, no "please", no "successfully". An
  error says what happened and what to do next.
- **Days** are Manila days.

---

## C1: peer evaluation

### Data

`supabase/peer-evaluation.sql` (new, idempotent):

```
peer_round_kind enum: 'check_in' | 'final'

peer_rounds
  id uuid pk
  project_id uuid fk projects on delete cascade
  kind peer_round_kind not null
  opens_at timestamptz not null default clock_timestamp()
  closes_at timestamptz not null
  closed_at timestamptz null        -- set when the professor closes it early
  created_by uuid fk profiles
  created_at timestamptz default now()
  check closes_at > opens_at
  partial unique index on (project_id) where kind = 'final'   -- one final round per project
  -- "open" means closed_at is null and now() < closes_at. Because that depends on the clock,
  -- the rule of one open round per project is enforced in open_peer_round, not by an index.

peer_ratings
  id uuid pk
  round_id uuid fk peer_rounds on delete cascade
  board_id uuid fk project_boards on delete cascade
  rater_id uuid fk profiles
  ratee_id uuid fk profiles
  contributes smallint check 1..5
  interacts   smallint check 1..5
  on_track    smallint check 1..5
  quality     smallint check 1..5
  skills      smallint check 1..5
  comment text not null default ''  (cap 1000)
  updated_at timestamptz default now()
  unique (round_id, rater_id, ratee_id)
```

A round belongs to a **group** project only. `open_peer_round` refuses `audience = 'individual'`.

### Functions

- `open_peer_round(p_project uuid, p_kind peer_round_kind, p_closes_at timestamptz) returns peer_rounds`
  - Staff only.
  - Refuses: an individual project, an archived or locked project, a round already open, or a second final round.
  - Notifies every student on a group board of the project with the new type `peer_round_opened`, gated by their notification prefs.
- `set_peer_round_close(p_round uuid, p_closes_at timestamptz)` lets staff extend a round or bring it forward.
- `close_peer_round(p_round uuid)` lets staff close a round early by setting `closed_at`.
- `remind_peer_round(p_round uuid) returns int` lets staff remind students. It notifies only students who have not rated every teammate yet (type `peer_round_reminder`, ungated because a person sent it) and returns how many it notified. At most one reminder per round per 20 hours, counted from the C3 notes log (see C3).
- `save_peer_ratings(p_round uuid, p_ratings jsonb)` saves a student's ratings.
  - The caller must be a member of a group board in the round's project, and the round must be open.
  - `p_ratings` is an array of `{ ratee_id, contributes, interacts, on_track, quality, skills, comment }`.
  - It must cover exactly the caller's current group members, the caller included. Otherwise it refuses with "Rate everyone in your group, yourself included."
  - The client hides the form, and the function refuses, when the caller is the only member of their group, because there is nobody to rate.
  - It upserts every row in one transaction.

### Row-level security

- `peer_rounds`
  - select: staff of the project, or any student who can see the project (`project_is_live` plus membership).
  - insert/update/delete: none. Writes go through the functions only.
- `peer_ratings`
  - select: `rater_id = auth.uid()` **or** staff of the project. A teammate or a ratee never reads another person's rows.
  - insert/update/delete: none. Writes go through `save_peer_ratings` only.

### Results view

`peer_results` view, `security_invoker`, filtered to staff:

- One row per (round, board, ratee).
- Columns:
  - `received_avg`: the mean over teammates (self excluded) of each rater's mean across the 5 dimensions.
  - `self_avg`.
  - `given_avg`: the mean the ratee gave others.
  - `raters`: teammates who rated this person.
  - `received_spread`: max minus min of the raters' means.
  - The per-dimension received averages.
  - `rated_all`: whether this person submitted for everyone.
- **Teammates are the board's current group members.** The view reads `group_members` at query time and counts only rows whose rater and ratee are both current members, so anyone who has left the group drops out of every average. `rated_all` is true when the person has a row for every current member, themselves included.

`my_peer_summary` view, own row only, visible after the C2 release: the student's own per-dimension `received_avg` and the team's per-dimension averages. No rater identity and no comments.

### Calculations (TypeScript `src/lib/peerMath.ts`)

Constants:

```ts
PEER_MIN_RATERS = 2
FACTOR_LOW = 0.85
FACTOR_HIGH = 1.10
SELF_GAP = 1.0          // over- / under-confident
MANIPULATOR_GAP = 1.5
CONFLICT_SPREAD = 1.0
FACTOR_CAP = 1.05       // C2 suggestion cap
```

- **Adjustment factor** = `received_avg / team_mean(received_avg)`, where the team mean is taken over members who have at least `PEER_MIN_RATERS` raters. The factor is null when that person has fewer than `PEER_MIN_RATERS` raters.
- **Flags:**

| Flag | Condition |
|---|---|
| `low` | factor < `FACTOR_LOW` |
| `high` | factor > `FACTOR_HIGH` |
| `overconfident` | self_avg − received_avg ≥ `SELF_GAP` |
| `underconfident` | received_avg − self_avg ≥ `SELF_GAP` |
| `manipulator` | self_avg − given_avg ≥ `MANIPULATOR_GAP` and factor < 1 |
| `conflict` | received_spread ≥ `CONFLICT_SPREAD` |
| `no_response` | `rated_all = false` |

- Clique detection is left out. It needs larger teams than BSIT groups of 3–5 to mean anything, and it is the flag most likely to accuse wrongly.

### Professor interface

- **The project's Work tab gets a "Peer evaluation" panel**, for group projects only, beside the hand-in queue.
  - Rounds are listed with their kind, close date, state, and "N of M answered".
  - Actions: **Open round** (kind; close date defaulting to 5 Manila days from now), **Extend**, **Close now**, **Send reminder**.
  - A missing-responses list.
- **Analytics → Groups gets a new section, "How teammates rated each other".** For the latest closed round of each group (or the open one, marked "in progress"), it shows a table per group:
  - member;
  - received average;
  - self;
  - factor;
  - raters;
  - flag chips (status tokens);
  - the five dimension averages, on hover or expand.

  Comments are listed without names by default, with a **Show raters** toggle.
- **The student drawer** (Analytics) shows the student's latest factor and flags.

### Student interface

- **The class project header gets a "Rate your team" button**, beside SubmitProject. It shows while a round is open and the student has not finished. After saving it reads "Edit ratings" until the round closes.
- **The form is a modal.** It has one card per group member, self first and labelled "You". Each card shows the five dimensions with their 1–5 anchors and an optional comment marked "Only your professor sees this."
  - Save is disabled until every dimension is answered for everyone.
- The notification types `peer_round_opened` and `peer_round_reminder` are added to `AppNotification.type`, and `NotificationBell.destination` routes them to the project.

### CATME anchors (shown in the form)

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Contributes to the team's work | Does not do a fair share; poor quality | Does a fair share of acceptable quality | Does more than a fair share; high quality |
| Interacts with teammates | Interrupts, ignores or bosses others | Listens, shares, respects others | Asks for and shows interest in others' ideas; makes sure everyone is heard |
| Keeps the team on track | Unaware of progress; lets problems slide | Notices and helps fix problems | Watches progress, gives feedback, helps the team plan |
| Expects quality | Satisfied with weak work | Encourages the team to do good work | Motivates the team to excellent work |
| Has relevant knowledge, skills, abilities | Missing basic skills the work needs | Has enough skill to contribute | Has skills that make a real difference, and helps others learn |

Points 2 and 4 sit between the anchors. The wording is our own paraphrase of the CATME behaviours, not CATME's text.

---

## C2: rubric scoring and release

### Stable rubric

- `replaceCriteria` (`src/lib/api/projects.ts`) becomes **upsert by id**. It updates existing rows, inserts new ones, and deletes only rows the professor removed.
- The series path (`project-series.sql`) and the copy path (`automation.sql`) are left alone. They create *new* projects, so they never touch scored criteria.
- **Lock:** a trigger on `project_criteria` refuses inserts, deletes, and changes to `max_points`/`position` while any `board_scores` row exists for that project. The refusal reads: "Scores exist for this project. Clear them before changing points or criteria." Changes to `label` and `description` are always allowed.
- `RubricEditor` shows points as read-only with a lock note when scores exist, and offers **Clear scores…**.

### Data

`supabase/scoring.sql` (new, idempotent):

```
board_scores
  board_id uuid fk project_boards on delete cascade
  criterion_id uuid fk project_criteria on delete restrict
  points numeric(6,1) not null check points >= 0
  scored_by uuid fk profiles
  scored_at timestamptz default clock_timestamp()
  primary key (board_id, criterion_id)
  check: points <= the criterion's max_points  (trigger; a check constraint can't read another table)
  check: points is a multiple of 0.5  (points * 2 = trunc(points * 2))

member_scores
  board_id uuid fk project_boards on delete cascade
  student_id uuid fk profiles
  suggested numeric(6,1) not null
  final numeric(6,1) not null check final >= 0
  overridden boolean not null
  factor numeric(5,3) null          -- the factor used at confirm time
  confirmed_by uuid, confirmed_at timestamptz
  primary key (board_id, student_id)

score_releases
  project_id uuid pk fk projects on delete cascade
  released_at timestamptz not null
  released_by uuid

score_history
  id uuid pk
  project_id, board_id, student_id null, criterion_id null
  action text  -- 'criterion' | 'confirm' | 'release' | 'unrelease' | 'clear'
  old_value numeric null, new_value numeric null
  by uuid, at timestamptz default clock_timestamp()
```

The history is written by triggers on `board_scores`, `member_scores` and `score_releases`, and by `clear_project_scores`.

### Functions

- `save_board_scores(p_board uuid, p_points jsonb)` saves a board's criterion points.
  - Staff only. `p_points` is `[{ criterion_id, points }]`, one entry per criterion of the project.
  - Refuses any criterion that doesn't belong to the project.
  - Allowed whether or not the board was handed in. The UI warns when it wasn't.
- `confirm_member_scores(p_board uuid, p_rows jsonb)` confirms individual scores.
  - Staff only. `p_rows` is `[{ student_id, final }]`.
  - The server recomputes `suggested` and `factor` from the board total and the **final** round's `peer_results`, using the same rule as `peerMath`.
  - It stores `overridden = (final <> suggested)`.
  - Individual boards get exactly one row: the board's student, with final = board total and factor null.
- `release_project_scores(p_project uuid)` / `unrelease_project_scores(p_project uuid)` let staff release or hide grades.
  - Release notifies each student who has a confirmed `member_scores` row, with the new type `grades_released`, gated by prefs.
  - Unrelease hides grades again and sends no notification.
- `clear_project_scores(p_project uuid)` lets staff delete the project's `board_scores` and `member_scores`. It keeps the history and writes a 'clear' entry. This unlocks the rubric.

### Suggestion rule (shared by SQL and `src/lib/scoreMath.ts`, tested on both sides)

```
groupTotal = sum(board_scores.points)
factor     = final-round factor for the student, or null
           (null when there is no final round, it is still open, or there are fewer than PEER_MIN_RATERS raters)
suggested  = factor == null ? groupTotal
           : min(projects.total_points, roundHalf(groupTotal * min(factor, FACTOR_CAP)))
roundHalf(x) = round(x * 2) / 2
```

The factor is only used once the final round has closed. A final round that is still open gives no factor.

### Row-level security

- `board_scores`
  - select: staff, **or** a member of that board when `score_releases` has a row for the project.
  - Writes go through the functions only.
- `member_scores`
  - select: staff, **or** `student_id = auth.uid()` when the project is released.
  - Writes go through the functions only.
- `score_releases`
  - select: staff or anyone who can see the project.
  - Writes go through the functions only.
- `score_history`
  - select: staff only.
  - No writes from clients.

### Professor interface

- **The Work tab Summary section gets a "Grades" table.** It has one row per board.
  - Columns:
    - Group (or student);
    - Hand-in;
    - one column per criterion;
    - Total `x / total_points`;
    - Status: Not scored / Scored / Confirmed / Released.
  - Header actions: **Release grades** (once anything is confirmed), **Unrelease**, and **Clear scores…** with a confirmation.
- Selecting a row opens the existing board panel. That panel gains a **Score card** beside `BoardVerdict`:
  - Criterion inputs: number, step 0.5, max = criterion max. Each shows its label and description.
  - A live total.
  - A "Not handed in" warning when relevant.
  - On group boards, a members table:
    - name;
    - factor;
    - flags (from C1);
    - suggested;
    - an editable final;
    - an "overridden" marker.
  - **Save scores** and **Confirm**.
  - A **Suggestion changed** marker when a confirmed row's stored suggestion no longer matches today's.

### Student interface

- After release, a **Your grade** card sits at the top of the project's Brief tab. It shows:
  - the score out of `total_points` and the release date;
  - the group's rubric breakdown (criterion, points / max);
  - "Adjusted for teamwork: ±N" only when the peer factor produced the difference (a stored factor, not overridden, and the final differs from the group total). When the final differs for any other reason, it says neutrally: "Your professor set your score at {final}. Your group scored {group}.";
  - **How your teammates saw you**: the five dimensions, theirs next to the team's (from `my_peer_summary`). This is shown only when a final round exists and they had at least `PEER_MIN_RATERS` raters.
- Before release the card does not appear.
- The notification type `grades_released` routes to the project.

### Rule changes to existing files

- `results.sql` header comment, `reports.sql:26-29`, and `handoff.md:323-325` are rewritten. The new rule: grades live in Collabify as rubric scores the professor confirms, and students see them only after release.
- `supabase/tests/reports.test.sql:319-331` (which bans score-like columns in report views) is relaxed **on purpose**. It now asserts that the report views expose no *unreleased* score. Phase B will add released scores to reports.
- `Sheet.tsx`'s "not a grade record" footer stays until Phase B, because report sheets still contain no grades.

---

## C3: intervention notes

### Data

`supabase/class-notes.sql` (new, idempotent):

```
class_note_kind enum: 'note' | 'nudge' | 'meeting' | 'follow_up' | 'peer_reminder'

class_notes
  id uuid pk
  class_id uuid fk classes on delete cascade
  student_id uuid null fk profiles
  board_id uuid null fk project_boards on delete cascade
  check (student_id is not null or board_id is not null)
  kind class_note_kind not null
  body text not null (cap 2000)
  follow_up_on date null
  resolved_at timestamptz null
  outcome text not null default '' (cap 1000)
  created_by uuid fk profiles default auth.uid()
  created_at timestamptz default now()
```

Row-level security: select, insert and update are allowed for staff of the class only. There is no delete; a note is resolved instead, which keeps the record. Students cannot read any note, including notes about themselves.

### Automatic entries

- `nudge_board` (`automation.sql`) inserts a `class_notes` row with kind `nudge`, the board, and the note text (or "Reminder sent").
- Its once-a-day limit now reads `class_notes` (kind `nudge`, same board, last 20 hours) instead of `notifications`. Students can delete their notifications, so the old limit could be bypassed.
- `remind_peer_round` (C1) inserts kind `peer_reminder` notes, and C1's reminder limit reads them.
- No other system events write notes. The log records what the professor did.

### Interface

- **The Analytics student drawer gets a Notes section.**
  - It lists the student's notes, plus notes on their boards, newest first.
  - Each note shows its kind chip, body, follow-up date, and resolved state with its outcome.
  - An **Add note** form: kind (Note / Meeting / Follow-up), text, and an optional follow-up date.
  - Each open note has a **Resolve** action with an optional outcome.
- **Analytics → Groups** shows the same notes for each group, behind a "Notes (N)" disclosure in the group's share-bar card.
- **Needs attention:** open notes whose `follow_up_on` is today or earlier become actions titled "Follow up with {name}" (severity 2) linking to the drawer. The new action kind is `follow_up_due`, mapped to the Students view in `analyticsView.ts`.
- The Analytics privacy line reads: "Flags are prompts for a conversation. Notes record that conversation and only teaching staff can read them."

---

## Testing

- **SQL** (one file per part: `peer-evaluation.test.sql`, `scoring.test.sql`, `class-notes.test.sql`). These use the repo's `act_as` / `must_refuse` / `must_allow` pattern, with each refusal paired with a control that succeeds.
  - **C1:**
    - A teammate cannot read another's ratings, but the rater can read their own.
    - A ratee cannot read ratings about themselves.
    - Ratings are refused when the round is closed, refused when incomplete, and refused for a non-member.
    - Individual projects are refused.
    - There is one final round per project and one open round at a time.
    - `peer_results` is checked against hand-computed values on a fixture with known ratings.
  - **C2:**
    - Students see nothing before release. After release, a student sees only their own `member_scores` and their board's `board_scores`.
    - The rubric lock refuses changes to points, inserts and deletes, and allows wording changes.
    - Points are refused above the maximum or when not a multiple of 0.5.
    - The suggestion is checked against hand values (including the cap and the "fewer than 2 raters" case).
    - History rows are written for each action.
    - Clearing scores unlocks the rubric.
  - **C3:**
    - Students cannot read notes, including notes about themselves.
    - Staff can.
    - A nudge writes a note.
    - The nudge limit holds after the student deletes the notification.
- **Unit** (vitest):
  - `peerMath`: factor, every flag edge, minimum raters.
  - `scoreMath`: suggestion, cap, half-point rounding, never above the total.
  - The new `analyticsView` mapping.
- **RLS coverage, anon lockdown and schema drift** all pass. `npm run build`, `npx eslint src` and `npm test` all pass.
- **Browser**, on live data:
  - Open a round as the professor.
  - Rate as a student (a test student account, created per the testing rules if none exists).
  - Score, confirm, release, and see the grade card as the student.
  - Add and resolve a note.
  - Check light/dark and 375/768/1440 widths.

## Risks

- **Retaliatory ratings.** The cap at 105%, the minimum of 2 raters, the conflict flag and the professor confirming each score bound the harm. Comments are professor-only.
- **Small groups.** In a group of 2, each student has one rater, so there is never a factor and the suggestion is the group score. This is stated in the UI.
- **Rubric typos after scoring.** Wording stays editable. Points need a deliberate, recorded clear.
- **Notification volume.** Opening a round notifies the class once, and reminders go only to students who have not finished.

## Out of scope

- Clique detection.
- Weighting peer ratings by rater accuracy (Peerceptiv-style).
- Class-wide final grades and grade export. Those belong to Phase B reports.
- Sprint-membership history (noted in Phase A). It is still deferred and is not needed by C1–C3.
