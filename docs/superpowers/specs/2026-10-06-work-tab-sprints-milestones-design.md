# Work tab: Backlog, Sprints, Milestones, Timeline, Calendar

## Context

Projects in both spaces have a Tasks tab with Summary, Board and List. The user wants a
proper planning layer: **sprints** and **milestones**, with a **backlog** feeding sprints,
and two more ways to see tasks (**Timeline**, **Calendar**). Tasks is renamed **Work**:

```
Work
├─ Summary      how it's going, what needs you now
├─ Backlog      plan: what's next, sorted into upcoming sprints
├─ Sprints      run: the running sprint, then finished sprints
├─ Tasks        Board · List · Timeline · Calendar
└─ Milestones   dated goals and how close each one is
```

The two spaces store tasks differently, so everything is built twice in SQL and once in UI:
- Work space: `general_tasks` on one project (`GeneralProject.tsx` → `TasksTab.tsx`).
- Educational space: `project_tasks` on one board per group/student
  (`ProjectDetail.tsx` → `ProjectTasksTab` → `StudentTasksView` / `ProfessorTasksView`).

Note: `handoff.md` §"Milestones — decided against" (2026) dropped a defense-track milestone
idea. This one is different (generic dated goals tagged on tasks) and the user asked for it,
so the handoff section gets a line saying it was revisited.

## Decisions (agreed with the user)

| Topic | Decision |
|---|---|
| Who plans (class) | Professor sets **milestones** for the whole project; each **group plans its own sprints** on its board. |
| Who plans (work) | Anyone with `manage_tasks` (Owner/Manager) plans sprints and milestones. Members add tasks to the backlog. |
| Sprint style | Scrum-lite: name, goal, start, end; Planned → Running → Finished. **One running sprint** per board/project. Finishing asks where unfinished tasks go: Backlog or next sprint. |
| Milestone | Name, target date, description. Tasks are tagged to one. Progress = share of tagged tasks done. Diamonds on Timeline and Calendar. Reached when all its tasks are done; work space can also mark it reached by hand. |
| Rollout | Four parts, each landing in both spaces before the next. |
| Progress tab | Removed. Timeline → Tasks › Timeline; forecast and late work → Work › Summary. |
| Tasks scope | Defaults to the running sprint; picker: Running sprint · All tasks · Backlog · each sprint. With no sprint running, All tasks. |

## Concepts, in user terms

- **Backlog** = every unfinished task not in a sprint. Ordered top = do next. Existing tasks
  all land here, so nothing changes for anyone until they make a sprint.
- **Sprint** = a short time box (default 2 weeks) with a goal. Tasks are pulled in from the
  backlog. Done tasks stay recorded in the sprint they finished in.
- **Milestone** = a dated goal ("Chapter 1–3", "Beta"). Independent of sprints; a sprint can
  work toward several milestones and a milestone can span sprints.
- Status stays the same three stages (To do · In progress · Done).

## Pages

**Summary** (both): running sprint card (goal, days left, done/total, small burndown by task
count), next milestone card (date, progress, at risk if behind), "Needs you" list (your tasks
due soon, overdue, nobody on it), then the existing tiles + donut + who is carrying what, then
forecast and late/landing-next (moved from Progress; work space). Professor (class): hand-in
queue + group progress table (moved from the Boards tab) + a groups × milestones grid.

**Backlog** (plan): upcoming (Planned) sprints as collapsible sections on top, each with its
tasks, dates, goal and a Start sprint button; the backlog list below. Per task: milestone chip,
holder, due; actions "Move to sprint ▾", move up/down (no drag library in the repo; keyboard
friendly). Checkbox select + "Add to sprint". Quick add row at the bottom. "Create sprint"
pre-fills the next 2 weeks after the last sprint.

**Sprints** (run + review): the running sprint — goal, date range, days left, progress bar,
burndown, its tasks grouped by stage, Finish sprint (dialog: N unfinished → Backlog / next
planned sprint / new sprint). Below: finished sprints, newest first, with what was done and
what carried over.

**Tasks**: scope picker + existing filters, then Board / List (existing components per space,
unchanged behaviour) / Timeline (GanttChart generalised: sprint bands behind, milestone
diamonds, today line; rows by team in work, by sprint in class) / Calendar (`MonthGrid`
with `showSyllabus=false`: task due dates, milestones, sprint start/end).

**Milestones**: list sorted by date — name, date, status (Upcoming · At risk · Late · Reached),
progress bar, tagged task count; open one to see its tasks. Class professor sees one progress
row per group under each milestone and manages them; students see their group's progress and
tag their tasks.

Phone: the Work sub-nav is a horizontally scrolling segmented bar; Board columns stack; Timeline
scrolls inside its card; Calendar uses MonthGrid's dot mode under 720 px.

## Data model

### Work space — `supabase/work-planning.sql`
- `general_sprints (id, project_id, name, goal, starts_on date, ends_on date, state
  sprint_state['planned','active','completed'], started_at, completed_at, created_by,
  created_at)`; check ends_on ≥ starts_on; unique partial index one `active` per project.
- `general_milestones (id, project_id, name, description, due_on date, reached_at,
  created_by, created_at)`.
- `general_tasks` + `sprint_id` (FK, on delete set null), `milestone_id` (FK, set null),
  `rank` (double precision, backlog order). `general_task_overview` gets the three columns
  appended (create or replace in the file that owns it, `general-schedule.sql`).
- RLS: read = `can_read_general_project`; write sprints/milestones = `general_can(manage_tasks)`.
  `guard_general_task`: changing `sprint_id`/`rank`/`milestone_id` needs `manage_tasks`.
- RPCs: `start_general_sprint(sprint)`, `complete_general_sprint(sprint, carry_to uuid null)`
  (moves unfinished tasks, stamps completed), `set_general_milestone_reached(id, bool)`.
- Events: `general_task_events` gets `sprint` / `milestone` change details via the existing
  update trigger.

### Educational space — `supabase/class-planning.sql`
- `board_sprints (id, board_id, …same columns…)`; one `active` per board.
- `project_milestones (id, project_id, name, description, due_on, position, created_by)`;
  reached is derived per board (no stored state).
- `project_tasks` + `sprint_id`, `milestone_id`, `rank`, `starts_at` (planned start, for the
  Timeline; class tasks only have the actual `started_at` today). `task_detail_overview` and
  `task_board_overview`-adjacent reads updated.
- RLS: sprints — read `can_see_board`, write board members while the board is open (not
  locked, not handed in); milestones — read anyone who can see the project, write
  `is_class_professor`.
- `guard_task_edit`: a started task is frozen today; let `sprint_id` and `rank` change through
  the sprint RPCs (so rollover works), `milestone_id` while the task is to do.
- `create_professor_task` / `update_professor_task` take `p_milestone`; copies inherit it.
- RPCs: `start_board_sprint`, `complete_board_sprint(sprint, carry_to)`.
- Both files idempotent; tests `supabase/tests/work-planning.test.sql`,
  `supabase/tests/class-planning.test.sql` (one active sprint, rollover, freezes, who can write).

## UI architecture

Shared, space-agnostic layer fed by an adapter, so Backlog/Sprints/Milestones/Timeline/
Calendar/Summary cards are written once:

- `src/lib/work/types.ts` — `WorkItem` (id, title, status, starts_at, due_at, done_at,
  sprint_id, milestone_id, rank, assignee_ids, group label), `Sprint`, `Milestone`,
  `WorkSource` (items, sprints, milestones, viewerId, `canPlanSprints`, `canManageMilestones`,
  `canMove(item)`, actions, `openTask`).
- `src/lib/work/` pure logic + Vitest: `scope.ts` (running/all/backlog/sprint filter and the
  default), `sprints.ts` (running, days left, next dates, burndown series from done_at),
  `milestones.ts` (progress, status), `timeline.ts` (moved from `lib/general/timeline.ts`,
  typed on `WorkItem`, plus sprint bands and milestone markers).
- `src/components/work/`: `WorkTab.tsx` (sub-nav + URL state `?work=` `&view=` `&scope=`),
  `WorkSummary.tsx`, `BacklogView.tsx`, `SprintsView.tsx`, `SprintDialog.tsx`,
  `FinishSprintDialog.tsx`, `MilestonesView.tsx`, `MilestoneDialog.tsx`, `TimelineView.tsx`
  (from `general/GanttChart.tsx`), `TaskCalendar.tsx` (wraps `calendar/MonthGrid`),
  `ScopePicker.tsx`, `SprintChip` / `MilestoneChip`.
- Adapters: `src/components/general/useWorkSource.ts` (from `useGeneralProject` state +
  `lib/api/general.ts`), `src/components/tasks/useClassWorkSource.ts` (from `useProjectTasks`
  + `lib/api/tasks.ts`). New API functions go in those two API files.
- Board/List stay the space's own components (`TasksTab` board/table split out;
  `TaskBoard`/`TaskList`), fed the scoped tasks.
- Task dialogs (`general/TaskDialog.tsx`, `tasks/detail/TaskDetailModal.tsx`,
  `NewTaskDialog`, `TaskForm`) get Sprint and Milestone selects; class `TaskForm` gets Starts.
- `CalendarKind` gains `milestone`, `sprint_start`, `sprint_end` (+ `eventLook.ts`).
- Rename: `GeneralTabId` `'tasks'` → `'work'` with `?tab=tasks` still accepted;
  `ProjectDetail` tab label "Work" for every role; class sub-tab state moves to the URL.
  Progress tab removed from both pages; `?tab=progress` redirects to Work › Summary.
- Colours: sprint states use `pending-*` / `warning-*` / `success-*`; milestone late =
  `danger-*`, at risk = `warning-*`. Tokens only.

## Rollout

1. **Work tab + Tasks views.** Rename, sub-nav shell (Summary = today's summary for now; other
   sections hidden until built), Board/List moved under Tasks, Timeline and Calendar for both
   spaces, class `starts_at`. Progress tab folded (Timeline moves; forecast/late into Summary).
2. **Backlog + Sprints.** Both SQL files' sprint half + tests, adapters, Backlog, Sprints,
   scope picker, sprint select in task dialogs, sprint bands on Timeline/Calendar.
3. **Milestones.** Milestone half of SQL + tests, Milestones page, chips, professor fan-out
   milestone, diamonds on Timeline/Calendar.
4. **Summary.** Running sprint + next milestone cards, burndown, "Needs you", professor
   groups × milestones grid.

Each part: own commit(s) on a branch, pushed (standing authorization), `handoff.md` section.

## Verification (each part)

- `npm run build` (tsc first), `npx eslint`, `npx vitest run` (new `lib/work/*.test.ts`).
- SQL: `node scripts/db.mjs supabase/<file>.sql` twice (idempotent), then the matching
  `supabase/tests/*.test.sql` plus `rls-coverage` and `anon-lockdown`.
- Browser: `preview_start` the dev server; on a work project and a class project (student and
  professor), check every Work section and Tasks view, create/start/finish a sprint with
  carry-over, tag a milestone, dark mode, 375 px with no sideways scroll, console clean.
  Screenshot proof. Signed-in steps the user must do are asked for, not skipped.

## First steps after approval

1. Copy this design to `docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md`
   and commit it.
2. Invoke `superpowers:writing-plans` for Part 1.
