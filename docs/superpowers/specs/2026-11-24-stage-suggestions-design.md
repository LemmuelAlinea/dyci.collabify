# Suggest stages

Status: approved · 2026-11-24

## Intent

On a work project's Plan tab, the Stages section (sprints, under the project's own stage name) asks the PM to create
stages one at a time and guess how many the project needs. The owner wants Collabify to recommend how many stages to
make and what goes in each, from the work that's planned: the number of tasks, the hours of tasks and subtasks, and
the time and people the project has.

A PM uses it twice:

- **At the start:** no stages yet, tasks waiting in the backlog. The suggestion lays out every stage up to the
  project's end date.
- **Midway:** tasks have piled up and the stages that haven't started no longer fit. The suggestion re-plans only
  what hasn't started.

## Goals

- One button, **Suggest stages**, in the Stages section. It shows a full plan to review: how many stages, how long,
  each one's dates, a name and goal, and which tasks go in it, with the reasons in plain numbers ("410 h of work ·
  200 h a week · ends Feb 25"). The PM changes what they want, then **Apply** creates the stages and moves the tasks in.
- The numbers are always right: no stage holds more hours than the team has in it, no task comes before a task it
  waits on, a task tagged with a milestone lands in a stage that ends by the milestone's date.
- Midway, running and finished stages never change.

## Non-goals

- Starting stages, or changing the running or finished ones.
- Picking who does each task (that stays Break down and balance and the holder pickers).
- Estimating tasks that have no estimate. They are placed, counted as unknown, and named in a warning.
- Running on its own. It runs only when a PM presses the button.
- Class boards.

## Anti-goals

- A plan that looks confident but doesn't fit: a stage at 260 h when the team has 200 h, or a task before the one it
  waits on. The plan is checked before the PM sees it.
- The AI seeing who is on the team, their hours or their time off.
- Apply quietly undoing changes someone made while the PM was reviewing.

## Approaches

- **A. Collabify counts, the AI groups (chosen).** Collabify works out the stage length, count, dates and each
  stage's hours. The AI places tasks into those stages and writes names and goals. Collabify checks and repairs the
  placement. Same split as Break down and balance: the numbers come from the database, the writing from the model.
- **B. The AI does everything.** Simpler, but the model can get the arithmetic wrong, and every number would need
  checking afterwards anyway.
- **C. No AI.** Packs tasks by order and hours. Free, instant, no limit, but stages are "Stage 1, 2, 3" with no goals,
  and tasks are grouped by size rather than by what they're about.

The owner picked A.

## Design

### Who and where

- The button sits at the top of the Stages section (the "Coming up" header is in Backlog), for the project manager and
  coordinators (`work_is_project_planner`) of a live, unarchived work project. (Members with the `manage_tasks` grant
  can create stages, but the plan reads people's hours, which only planners read.) My call.
- It opens a dialog in two steps, like Break down and balance: a short setup, then the review.

### What gets planned

- **The window:** from the later of the next weekday and the project's start date (midway: the day after the latest
  running stage ends) to the project's end date. With no end date, the window is as long as the work needs (see
  Count). A plan never makes a stage that starts today, so Auto start never starts a plan-made stage the moment it is
  applied (my call).
- **The tasks:** live, open, top-level, released tasks in the backlog or in a stage that hasn't started, the same
  tasks the Backlog shows. Tasks still in private planning are left out, and the setup step says "4 tasks are still in
  planning. Send them from Plan & route to include them." (my call: the release boundary stays as it is). Tasks in the running
  stage stay where they are. A task with subtasks moves as one, with its subtasks; its hours are its live open
  subtasks' estimates (the same rule the forecast uses), otherwise its own estimate.
- **The stages it may change:** midway, the planned stages that haven't started. They are reused in date order (so a
  stage keeps its milestone link and id), extra ones are created, and planned stages the plan no longer needs are
  deleted. Running and finished stages are read only, and their hours count as used.

### The numbers (Collabify)

- **Team hours per stage:** for each project member except stakeholders, their available hours in the stage's dates
  (`work_person_hours`, which already takes away days off) minus their load from other projects in those dates. Summed.
- **Length:** starts at the project's stage length setting (14 days unless changed). If the biggest task wouldn't fit
  in one person's hours for one stage, it goes up a week at a time, up to 4 weeks. If the window holds fewer than two
  stages, it drops to one week. The setup step shows the length and lets the PM pick 1-4 weeks before generating.
- **Count:** the window divided by the length, rounded up, the last stage ending on the project's end date. With no
  end date: total hours ÷ hours per stage, rounded up, plus one buffer stage.
- **Buffer:** the last stage is kept for testing and fixes. Tasks are placed in it only when they don't fit earlier.
- **Milestones:** a stage end that falls within 3 days of a milestone's due date moves onto that date.
- **Fill:** each stage is filled to at most its team hours.
- **Task dates (owner's call):** a task's due date is a limit, like a milestone: it can't land in a stage that starts
  after its due date. A task already overdue, or due before the window starts, goes in the first stage and the review
  flags it. On Apply, a task with no due date gets its stage's start and end as its dates (for a task with subtasks,
  its undated subtasks get them, and the parent follows its subtasks as it already does). Dates someone set are never
  changed. This keeps workload, forecasts and leave checks in line with the stages.
- **Doesn't fit:** when the work needs more hours than the window has, the tasks that don't fit stay in the backlog and
  the review says so: "60 h won't fit before Feb 25. These 5 tasks stay in the backlog." Hours are shown, never a
  person's.

### The grouping (AI)

- A new `work-ai` action, `stages`. The model sees: the project's name and description, the stages as s1…s(n) with
  dates and team hours (a total only), the milestones as m1… with due dates, and the tasks as t1… with title, a short
  description (names replaced the way Break down does), hours (or "no estimate"), what each waits on, and its
  milestone. It never sees names, people's hours or time off.
- It returns, for each task, a stage; for each stage, a name (up to 60 characters) and a goal (up to 200); and an
  optional note.
- It is told: group related work together, put foundations first, keep the buffer stage light, and keep each stage
  under its hours.

### The check (Collabify, before the review)

In `supabase/functions/_shared/stagePlan.ts`, a plain function with tests, like `workloadPlan.ts`:

1. Unknown or missing tasks go to the earliest stage that fits.
2. A task placed before a task it waits on moves to that task's stage or later.
3. A task tagged with a milestone, or with a due date, moves to the last stage that ends by that date (for a due
   date: the last stage that starts by it). If that stage is full, it stays there and the review flags it.
4. A stage over its hours pushes its latest-dependency, lowest-priority tasks to the next stage. Past the last stage,
   they go to the "doesn't fit" list.
5. Empty names become the project's stage name and a number ("Stage 3").

### The review

```
Suggested: 6 stages of 2 weeks
410 h of work · 200 h a week · ends Feb 25 · 3 tasks have no estimate

Stage 1 · Nov 16–29 · Login and setup              62 / 200 h
  Goal: People can sign up, sign in and see an empty board.
  t  Set up the project            6 h      [Stage 1 ▾]
  ...
Stage 6 · Feb 8–25 · Testing and fixes (buffer)     12 / 180 h

Won't fit before Feb 25 (60 h): 5 tasks stay in the backlog
[Cancel]                                    [Apply]
```

- The PM can rename a stage, edit its goal, and move a task to another stage or to the backlog with its menu. Hours
  per stage update as they do, and a stage over its hours turns to the warning tone.
- Midway the header says what stays: "Stage 2 is running and keeps its 8 tasks."
- The AI's note, if any, shows under the summary, like Break down's.

### Apply

- One RPC, `apply_stage_plan(p_project uuid, p_plan jsonb, p_shown jsonb)`, in one transaction: update reused planned
  stages (name, goal, dates), create new ones, delete planned stages the plan dropped, set `sprint_id` on each
  task and its live subtasks (backlog tasks get null), and give undated tasks their stage's dates.
- **Milestone links on reused stages (my call):** a planned stage linked to a milestone counts as that milestone's
  stage in the check (its tasks are treated as tagged, and its end may not pass the milestone's date). A reused stage
  keeps its link only when its new dates still end by the milestone's date; otherwise the link is cleared and the
  review says "Stage 3 no longer counts toward Beta." The link change is written before the tasks move, so
  `task_follow_sprint_milestone` tags only what the check expected.
- **Stale check:** `p_shown` is what the review was built from (each task's stage and hours, each planned stage's id
  and dates). If any of it changed, the RPC refuses with "Something changed while you were reviewing. Suggest again to
  see the latest." Nothing is written.
- It writes as the caller, so the stage and task rules, the milestone tagging and the history all apply as they do for
  a hand-made change.

### Stage modes

- **One at a time** (sequential) and **at the same time** (parallel): one plan for the project, with stages back to
  back and never overlapping, so no one's hours count twice (my call). In parallel mode the window starts after the
  latest running stage ends.
- **Each team's own stages** (streams): the setup step asks for a team; the plan covers that team's tasks and that
  team's stages, and team hours are that team's members.

### Limits

- `rate_limit` key `stages`, 12 an hour and 50 a day, like the breakdown.
- Up to 200 tasks per plan. Past that, the setup step says so and plans the 200 due soonest.

## Constraints

- SQL in a new file, `supabase/stage-plan.sql`, after `subtask-dates.sql` and before `anon-lockdown.sql`, idempotent,
  registered in `docs/07-backup.md` and `scripts/schema-drift.mjs`, with a suite `supabase/tests/stage-plan.test.sql`.
  It redefines nothing another file owns.
- Copy follows the stage terms (`stageText`), sentence case, no "please" or "successfully".
- Tokens only; desktop first, the review stacks on a phone.
- Deploy `work-ai` with the frontend.

## Left to the builder

The context RPC's exact shape, the prompt wording, the dialog's styling, how "lowest priority" breaks ties, and how
the setup step looks.
