# Class Analytics redesign — Phase A design

Date: 2026-10-13
Status: awaiting review
Roadmap: Phase A of three (A Analytics → C peer evaluation, rubric scores, interventions → B Reports).

## Why

The faculty Analytics page, both the class tab and `/teaching/analytics`, has one real chart and
no trends over time. It is arranged in four abstract bands (Descriptive, Diagnostic, Predictive,
Prescriptive) rather than around the professor's own questions: how is my class doing, which
groups are in trouble, which students are not pulling their weight, which projects are slipping.

The database already records a full history the page never shows:

- `task_events`: who claimed, started, finished, reopened or commented on what, and when.
- `task_worklog`: minutes worked, per student.
- `board_results`: every accept and return, not only the latest.
- Sprints and milestones.
- On-time hand-ins.

Two findings from comparable platforms shaped this design. Blackboard, Brightspace and Canvas
all use a student roster with risk columns and a per-student context card. Jira and Linear use
burnup and sprint reports. A review of teacher dashboards (Kaliisa et al. 2023) found they fail
when they inform without leading to an action.

## Goals

1. Answer four questions, one sub-view each: **Class**, **Groups**, **Students**, **Projects**.
2. Make the main views charts and trends rather than count tiles.
3. Every flag leads to an action, either Nudge or Open.
4. No new tables. New SQL views only, plus three columns on an existing view.

## Non-goals

- Peer evaluation, rubric scores, intervention notes. These are Phase C.
- Reports changes. These are Phase B.
- Predictive models. Forecasts stay printed arithmetic (`handoff.md:196-200`).
- Student-facing analytics.

## Kept from today

- `FilterChain` cascading scope: class → project → group → student → task.
- `projectFinish` / `projectBurn` in `src/lib/types.ts` and their printed arithmetic.
- `CARRYING_ALONE_PCT`.
- `rankActions`, `boardCauses` and `forecast` in `src/lib/insight.ts`.
- Every view stays `security_invoker` and filtered by `is_class_professor`.
- Archived classes and projects are dropped, as today.
- `useLive` refresh.

## Page structure

```
[ DirectoryHero ]                      (global page only)
[ Scope bar: FilterChain ]
[ Needs attention · 5   ▸ expand ]     ← ActionList, collapsed by default, count always visible
[ Class | Groups | Students | Projects ] ← segmented control, ?view= in the URL
[ sub-view content ]
[ Task list ]                          (unchanged: shown once narrowed to a group, student or task)
```

- The sub-view is kept in `?view=`, alongside `ClassSpace`'s `?tab=`. The default is `class`.
- Choosing a group in `FilterChain` switches to **Groups**. Choosing a student switches to
  **Students** and opens that student's drawer.
- The Needs attention strip sits above the sub-views because a professor's first question is
  "what do I do". Each action carries a "See why" link to the sub-view and chart behind it,
  which keeps the old rule of evidence before instruction.

## Sub-views

### Class

| Element | Shows | Source |
|---|---|---|
| KPI strip (4 tiles, each with an 8-week sparkline) | Completion %, on-time rate, students active this week, needs-attention count | `task_state`, `analytics_weekly_activity`, actions |
| Class burnup | Scope line (tasks existing on each day) and done line (tasks finished by each day), with a dashed even-pace target from term start to term end | `task_state` (`created_at`, `done_at`), `class_pace` term dates |
| Weekly activity | Stacked bar per week. **Work** = started + finished + claimed. **Talk** = commented + file_added | `analytics_weekly_activity` |
| Syllabus pace | Two lines, weeks covered and weeks elapsed. `PaceCard`'s arithmetic sentence sits underneath | `class_pace` |
| Deadline pressure | Existing `PressureChart` | `deadline_pressure` |
| Syllabus gaps, unmeasured classes | Existing `GapList` / `UnmeasuredList`, moved to the bottom | as today |

### Groups

| Element | Shows | Source |
|---|---|---|
| Group health grid | One row per board. Columns: % done · overdue · imbalance (Gini) · days since activity · hand-in state · times returned. Each cell is colored with status tokens using the thresholds below | `board_burn`, `class_member_load`, `analytics_board_cycles`, `analytics_weekly_activity` |
| Contribution share | One 100% bar per group, a segment per member sized by `personal_pct`. A member under 10% gets a danger outline and a label | `class_member_load` |
| Burnup small multiples | One small burnup per group for the selected project, all on the same scale. Hidden until a project is chosen; prompts "Choose a project to compare groups" | `task_state` |
| Activity calendar | Weeks across × weekday down for the selected group, colored by event count. Shows cramming before a deadline | `analytics_weekly_activity` (per-day variant, see data) |
| Diagnoses | Existing `DiagnosisList` | `board_diagnosis` |

**Health thresholds:**

| Measure | Success | Warning | Danger |
|---|---|---|---|
| % done vs time elapsed | at or ahead of pace | behind by < 20 points | behind by ≥ 20 points |
| Overdue tasks | 0 | 1–2 | ≥ 3 |
| Gini | < 0.3 | 0.3–0.5 | > 0.5 |
| Days since activity | < 4 | 4–6 | ≥ 7 |
| Times returned | 0 | 1 | ≥ 2 |

For hand-in state, "not started" uses the `pending` tokens, never a status color. These
thresholds live as named constants in `src/lib/analyticsMath.ts`.

### Students

**Roster table.** One row per active class member, sortable on every column. Columns:

- name and avatar
- groups
- share (their `personal_pct` on their main board)
- finished / held
- late rate
- logged hours
- comments
- last active
- an 8-week activity sparkline
- flags

**Flags** (chips with status tokens):

| Flag | Condition |
|---|---|
| Holding nothing | `held = 0` while in at least one group |
| Low share | `personal_pct < 10` on a board with at least 2 members |
| Inactive | No `task_events` by them in the last 7 days, once the term has started |
| Often late | `late ≥ 3` and late rate ≥ 30% |
| In no group | From `class_participation` |

The default sort is flag count descending, then name.

**Student drawer.** Opens when a row is clicked, or when `FilterChain` narrows to a student. It
is a side sheet on desktop and full screen on phones. It contains:

- a weekly activity chart
- their tasks as a timeline (from claim or start to done, with the due date marked and late
  tasks shown in danger)
- work-log hours per week
- their reassignment requests
- a Nudge button (the existing nudge action from `ActionList`)

Clicking a task opens `TaskDetailModal`.

### Projects

| Element | Shows | Source |
|---|---|---|
| Project comparison | Per project: one completion bar per group, on-time hand-in rate, average times returned, average hours from hand-in to decision | `board_burn`, `analytics_board_cycles` |
| Milestone timeline | Per project, one lane per group across the project dates, with a marker per milestone. Marker states: **met** (every task under that milestone done by `due_on`), **late** (done after, or `due_on` passed with tasks open), **upcoming**, **no tasks** | `analytics_milestones`, `project_milestones` |
| Sprint report | Per sprint on the selected board: tasks finished in the sprint window, tasks still open, and the sprint state | `analytics_sprints` |
| Stuck work | Tasks with `status = in_progress` and `started_at` ≥ 7 days ago, oldest first, each linking to `TaskDetailModal` | `task_state` |

**Known gap.** Completing a sprint moves its open tasks to the next one (`class-planning.sql:262`),
so "committed at start" and "carried over" can't be reconstructed. The sprint report shows
finished-in-window and still-open only. A sprint-membership history is noted for Phase C.

## Data layer

New file `supabase/analytics-trends.sql`. It is idempotent: `drop view if exists` then `create view`,
with `security_invoker = true`, filtered by `is_class_professor`, and with `grant select` to
`authenticated`.

**Extended:** `task_state` in `supabase/analytics.sql` gains `created_at`, `sprint_id` and
`milestone_id`, appended at the end.

New views:

1. **`analytics_weekly_activity`**
   - Columns: `class_id, project_id, board_id, actor_id, day date, kind task_event_kind, n int`.
   - Grouped by day, not week, so the same view serves both the calendar heatmap and the weekly
     bars. The client buckets days into weeks.
   - Days are taken in `Asia/Manila`: `(e.at at time zone 'Asia/Manila')::date`.
   - Built from `task_events` ⨝ `project_tasks` ⨝ `task_board_overview`.
   - Limited to the term: `day >= classes.term_start` when it is set.
2. **`analytics_student_roster`**
   - Columns: `class_id, student_id, held, done, late, done_with_due, done_on_time,
     worklog_minutes, comments, last_active_at`.
   - Covers active `class_members` only.
   - `last_active_at` is the latest of three things by that student in that class: a
     `task_events.at`, a `task_comments.created_at`, or a `task_worklog.created_at`.
3. **`analytics_board_cycles`**
   - Columns: `board_id, class_id, project_id, submissions, returns, accepts, first_submitted_at,
     last_decided_at, avg_decision_hours`.
   - Built from the full `board_results` history together with `project_boards.submitted_at`.
     The decision time is `decided_at − submitted_at` for the latest cycle only, since earlier
     submission times are overwritten.
4. **`analytics_milestones`**
   - Columns: `milestone_id, project_id, board_id, class_id, name, due_on, tasks, done,
     last_done_at`.
   - Per board: the board's non-archived tasks with that `milestone_id`.
5. **`analytics_sprints`**
   - Columns: `sprint_id, board_id, class_id, name, starts_on, ends_on, state, tasks, done,
     done_in_window`.

Archived tasks are left out of every count, as in `task_board_overview`.

**Client side.**

- Fetchers are added to `src/lib/api/analytics.ts`. Row types go in `src/lib/types.ts`.
- `useAnalytics.ts` loads them in the same `Promise.all` and narrows them with the same scope
  filters.
- `useLive` also watches `task_worklog`, `task_comments`, `board_sprints` and
  `project_milestones`.

**Pure helpers.** New `src/lib/analyticsMath.ts`, with tests in `analyticsMath.test.ts`:

- `gini(values: number[]): number`. Returns 0 for empty input or one member.
- `weekBuckets(days, from, to)`. Groups day rows into Monday-start weeks, with zero-filled gaps.
- `burnupSeries(tasks, from, to)`. Builds the scope and done series per day.
- `targetLine(from, to, total)`.
- `healthTone(measure, value)`. Applies the thresholds table above.
- `studentFlags(row, load, participation, now)`.
- `milestoneState(row, today)`.

## Charts

There is no chart library; the app's convention is hand-built SVG.

The four general report charts (`LineChart`, `StackedBar`, `DonutChart`, `ProgressBar`) move
from `src/components/general/reports/charts/` to `src/components/charts/`, and the general
reports imports are updated.

New components in `src/components/charts/`:

| Component | Use |
|---|---|
| `Sparkline` | KPI tiles, roster rows |
| `Burnup` | Scope, done and target lines, optionally drawn small |
| `WeekBars` | Stacked weekly bars |
| `HeatGrid` | Group health grid, with each cell holding a value and a tone |
| `ShareBar` | 100% bar per member, segments in `navy-300…navy-800` steps |
| `LaneTimeline` | Milestone and task timelines |
| `CalendarHeat` | Weekday × week grid |

Rules for every chart:

- Colors come from tokens only. Status ramps carry state, and navy ramp steps tell members apart.
  No raw hex, no `emerald-*` or `red-*`.
- `role="img"` with an `aria-label` summary, plus a visually hidden `<table>` of the data, the
  same pattern as `LineChart`.
- Entrance motion through `Reveal`, and none under reduced motion.
- Layout is desktop first: two chart columns at `lg` and above, one below. `HeatGrid` and the
  roster scroll horizontally inside their card under `md`. The drawer goes full screen under `md`.
- Empty states use the copy rules: they say what is missing and how to fill it.

## Copy

- Sub-view labels: Class, Groups, Students, Projects. Strip: "Needs attention".
- Flags: "Holding nothing", "Low share", "Inactive 9 days", "Often late", "In no group".
- Empty: "No activity recorded yet. Charts fill in as students claim and finish tasks."
- Copy is sentence case, with no exclamation marks, no "please" and no "successfully".

## Files

- **New**
  - `src/pages/app/analytics/views/ClassView.tsx`, `GroupsView.tsx`, `StudentsView.tsx`,
    `ProjectsView.tsx`
  - `src/components/analytics/NeedsAttention.tsx`, `ViewSwitch.tsx`, `GroupHealthGrid.tsx`,
    `Roster.tsx`, `StudentDrawer.tsx`, `MilestoneLanes.tsx`, `SprintReport.tsx`, `StuckWork.tsx`
  - `src/components/charts/*` (moved and new)
  - `src/lib/analyticsMath.ts` and `.test.ts`
  - `supabase/analytics-trends.sql` and `supabase/tests/analytics-trends.test.sql`
- **Modified**
  - `src/pages/app/analytics/Analytics.tsx` and `useAnalytics.ts`
  - `src/lib/api/analytics.ts`
  - `src/lib/types.ts`
  - `supabase/analytics.sql` (`task_state` columns)
  - general reports chart imports
- **Removed**
  - `src/pages/app/analytics/bands/*.tsx`. Their pieces are re-homed.
  - Any `components/analytics/*` file left unused, checked by grep before deleting.

## Testing

- **SQL** (`supabase/tests/analytics-trends.test.sql`, same harness as `analytics.test.sql`):
  - A fixture class with two groups, known events, a worklog and results.
  - Assert the weekly counts, roster figures, cycles, milestone met/late and sprint
    done-in-window.
  - **A student account sees zero rows from every new view.**
- **Unit** (`vitest`):
  - `gini` checked against hand values: [1,1,1,1] → 0 and [0,0,0,1] → 0.75.
  - Week bucketing across a month boundary and with gaps.
  - The burnup series.
  - Each threshold edge.
  - Each flag condition.
- **Build**: `npm run build`, `npm run lint`, `npm test`.
- **In the browser**, through `preview_start` and a teaching faculty login:
  - Walk all four sub-views on a class with real data and on an empty class.
  - Narrow with `FilterChain` to a group, then to a student, and confirm the drawer opens.
  - Press Nudge.
  - Check light and dark at 1440, 768 and 375 widths.
  - Check reduced motion.
  - Confirm the console is clean.
- **Live**: push to `main` and check dyci-collabify.vercel.app.

## Risks

- **Query weight.** There will be 16 parallel view reads. The new views aggregate server-side, and
  `analytics_weekly_activity` is limited to the term. If load is slow, fetch per sub-view later.
- **Sparse data.** One class with little history makes trend charts look thin. Every chart must
  read well with 0–2 weeks of data, using empty or near-empty states rather than a flat line that
  looks like a bug.
- **Gini on two-person groups** is coarse: it is 0 for an even split and 0.5 for a
  one-person-does-everything split. The thresholds account for this, and the share bar shows the
  raw split beside it.

## Amendments during planning (2026-10-13)

- The daily view is named `analytics_daily_activity`. It returns one row per day and the client buckets the days into weeks.
- **Share of group work is `held_pct`, not `personal_pct`.** `personal_pct` is how much of a student's *own* work is finished (`task-points.sql:66`). The share bar, Gini and the "Low share" flag all use `held_pct`.
- `analytics_board_cycles` has these columns: `returns, accepts, submitted_at, last_decided_at, decision_hours`. Returning a board clears `submitted_at`, so `decision_hours` covers the latest cycle only.
- The roster uses the stored `late` flag (`deadline-lock.sql:28`) rather than comparing `done_at` with `due_at`. Late rate is late ÷ done.
- **Syllabus pace** shows weeks covered and weeks elapsed as two bars, not lines over time. Coverage history is not recorded.
- **Student drawer:**
  - Shows total work-log hours, not hours per week; a per-week figure needs another view.
  - Leaves out reassignment requests, which Analytics does not load.
  - Uses the existing `Modal` (size `lg`) rather than a new side-sheet component.
- **The "Needs attention" tile** has no sparkline, because past action counts are not recorded.
