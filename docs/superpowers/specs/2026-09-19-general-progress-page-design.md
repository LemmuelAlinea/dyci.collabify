# A progress page for a General project

## Why

A General project already knows everything about its own progress and tells
nobody. The percentage sits in a corner of the Tasks tab, the deadlines are
spread across a board, and the one question a group actually asks in week six —
*are we going to finish this* — has no answer anywhere in the product.

This adds a **Progress** tab that answers it, and a Gantt chart for the shape of
the whole term.

## Who it is for

Every member of the project. It needs no permission, because it shows nothing a
member cannot already reach by clicking through the tasks; it only arranges it
so the arrangement is the point. Nothing on the page is editable.

## What is on it

Four panels, in the order somebody asks the questions.

### 1. Where we are

The percentage, done over total, and the same figure by points when the project
has points on. `projectProgress` in `src/lib/general/progress.ts` already
computes this and the database mirrors it in `general_project_overview`; the
panel presents it, it does not recompute it.

### 2. The timeline

One row per task, ordered by start then due, grouped under team headings when
the project uses teams.

The window runs the project's own `starts_on → ends_on`. With either unset it
falls back to the earliest and latest dates any task carries, so a project that
never filled in its own dates still draws.

A task with a start date draws a **bar** from start to due. A task without one
draws a **diamond** on the day it is due, and the legend says which is which.
This is the whole reason the chart is useful on the day it ships: every task
that exists today has no start, including all ten a capstone preset creates, and
a chart that drew nothing would read as broken rather than as a prompt. The
visible difference between a bar and a diamond is also what makes filling a
start date in look worth doing.

Colour comes from the task's stage. Overdue is marked. A line marks today.

The panel scrolls sideways at phone width; the page never does. `AppShell` sets
`overflow-x-clip`, so a chart that leaked past the viewport would be silently
cut off rather than scrollable — the scroll has to live inside the panel.

### 3. Will we finish in time

Tasks finished per week from `completed_at`, the rate that implies, the work
still open, and a projected finish date compared against the project's end date.

Education's `BurnCard` answers this for class boards, and one judgement in it is
worth keeping: **"nobody has started" is its own state**, not a rate of zero. A
project moving at zero per day reads as slow. A project nobody has opened is a
different problem with a different fix, and it is the one worth catching early.

States: nobody has started · on track · will overrun by N days · finished · no
end date set.

### 4. What is late, and what lands next

Overdue open tasks first, soonest overdue at the top. Then the next four weeks,
counted by the week each task falls due, with bars scaled to the busiest week so
the shape is the comparison and the number beside each is the figure.

This is the only panel on the page somebody can still act on before it happens.

## What has to be built

### A start date on tasks

`supabase/general-schedule.sql`:

- `general_tasks.starts_at timestamptz`, nullable.
- A check constraint: `starts_at is null or due_at is null or starts_at <= due_at`.
  A task cannot start after it is due.
- `general_task_overview` gains the column, appended last.
- `record_general_task_event` records it like every other short field, with its
  old and new value, so the history reads *"moved the start from Oct 3 to
  Oct 10"*. This matters more than it sounds: on a Gantt, moving a start is how
  a plan slips, and a plan that slips without a record is how a group argues in
  week nine.

`starts_at` joins the task dialog beside Due, and the new-task form. Nothing
else about tasks changes.

**Presets are not touched.** Staggering ten capstone tasks across a term is a
real feature and a different one; guessing dates for somebody else's project is
worse than leaving them blank.

### Pure logic, tested on its own

Following `progress.ts`, `diff.ts` and `files.ts`: the arithmetic lives in
modules with tests, and the components only draw.

`src/lib/general/timeline.ts`
- `timelineWindow(project, tasks)` — the start and end the chart spans, and what
  it fell back to when the project has no dates of its own
- `placeTask(task, window)` — a bar with percentage offsets, or a diamond at one
  offset, or nothing when the task has no dates at all
- `axisTicks(window)` — weeks for a short project, months for a long one
- `groupRows(tasks, teams)` — team headings, and the tasks that belong to the
  whole project

`src/lib/general/forecast.ts`
- `projectForecast(tasks, endsOn, now)` — returns one of the five states above
  with the numbers behind it
- The cases that break naive arithmetic and therefore get tests: one task
  finished on the first day, everything already finished, an end date in the
  past, no completed task at all, a project with no tasks

`src/lib/general/pressure.ts`
- `overdueTasks(tasks, now)` and `dueByWeek(tasks, now, weeks)`

### Components

- The tab lives inside `GeneralProject.tsx` beside Overview, Tasks, Files and
  Members, reached by `?tab=progress`, reading the `state` the project page has
  already loaded. There is no new route and no new page.
- `src/components/general/ProgressTab.tsx` — the four panels
- `src/components/general/GanttChart.tsx` — the timeline
- `src/components/general/ForecastPanel.tsx` — will we finish
- `src/components/general/PressurePanel.tsx` — late and next

Charts are hand-drawn HTML and CSS, the way `PressureChart` and `BurnCard`
already are in Education. No chart library: the entry bundle is 312 KB and the
two shapes this page needs are a horizontal bar and a marker.

### No new reads

`useGeneralProject` already loads every task with `completed_at`, `due_at`,
`weight`, `team_id` and `status`, and the teams beside them. The page adds one
column to that read and no new queries.

## Verification

- `supabase/tests/general-schedule.test.sql`: a start after its due date is
  refused; a start with no due date is allowed; the history records the old
  start; the overview returns the column; a stranger still reads nothing.
- Unit tests for all three pure modules, including the empty project, the
  project with no dates, the single-task project and the finished project.
- `npm run check` green, lint holding at 23 warnings and 0 errors.
- Browser, signed in: a capstone project shows diamonds for its ten preset
  tasks; setting a start on one turns it into a bar; the forecast reads "nobody
  has started" before the first task is done and a projection after; an overdue
  task appears at the top of the late panel; 375px and 1440px, both themes, no
  page-level sideways scroll.

## Deliberately not in this

Two panels the owner turned down, recorded so the decision is on file rather
than forgotten:

- **Who is carrying what** — per member, tasks held, tasks finished and time
  logged. The panel an adviser grading group work usually wants, and the one
  that names who has done little. Easy to add later; harder to add quietly.
- **Progress by team** — one bar per team. Earns its place only on a project
  that uses teams, and says nothing on a three-person research paper.

Also out: exporting the chart, printing it, per-task dependencies ("this cannot
start until that finishes"), and a critical path. Dependencies are the honest
next step for anybody who wants a real Gantt, and they are their own design.
