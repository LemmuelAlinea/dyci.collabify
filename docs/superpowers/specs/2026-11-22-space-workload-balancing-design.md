# Space workload balancing

Date: 2026-11-22. Status: draft for approval.

Supersedes `2026-11-22-work-project-ai-work-decomposition-design.md` and its plan (written with Codex,
never committed). Their code on `codex/workload-balancing` is reused where noted below.

## Intent

At the capstone defense a panelist asked where workload balancing lives on the workspace side: if three junior
developers share one module, such as a Login Module, how does Collabify work out what the module involves, who
should do each part, and show that the split fits each person's load?

Collabify cannot answer today. Assign by position picks the person with the fewest tasks, tasks carry no effort
estimate, and nobody states how many hours they have. This upgrade adds those numbers across a work space, lets
AI break a module into subtasks, recommends owners from real project data, and shows every person's load so
planners and members can see when someone is overloaded.

## What other tools do (research, 2026-11-22)

- Jira: per-person weekly capacity with leave and non-project time; a bar turns red past 100%. AI suggests child
  work items for a parent and edits the capacity plan from chat. It does not rebalance on its own.
- ClickUp: a Workload view that sums each person's estimates across every project in a Space; drag to reassign.
  Brain generates subtasks from a task title. ClickUp's own guide warns that counting tasks without estimates
  misleads.
- Asana: effort per task, capacity per person, a red line when over. AI Studio can estimate effort and route
  work to whoever has room.
- Microsoft Planner: People view per member; its agent generates tasks but does not balance by workload.
- monday.com: claims an agent that redistributes work automatically.

None does breakdown and owner balancing in one reviewed step; that is what Collabify adds. All of them measure
capacity as hours a person states, never from clock-ins.

## Decisions made with the owner

1. Workload counts every live work project a person is on **in the space**, not one project.
2. Visibility is layered (see Visibility).
3. All five pieces are in scope: Break down and balance, the space Workload view, hours in the holder picker,
   My load on Home, and a task timer.
4. Actual time is tracked with a **task timer** that writes the existing time log. No attendance clock.
5. Estimates are set by the project manager and coordinators on any task, and by a task's holder on that task.
6. Build order is **demo first** (see Phases).
7. Tasks Members create or hold in an Open-flow project count like any other. A Member cannot add someone else
   as holder when the estimate would put that person over their available hours (see Open task flow).
8. A space coordinator sees per-project hours only for projects they can read; the rest is one total.

## Goals

- A planner opens a released top-level task, such as Develop Login Module, and gets a reviewable breakdown:
  subtasks with description, estimated hours, required skill or position, dependencies, and which can run in
  parallel.
- Collabify recommends one owner per subtask from the confirmed people, using skills, existing load and
  available hours in the planning window, or leaves it unassigned with the reason.
- The planner sees each person's existing, added and projected hours against available hours, edits anything,
  rebalances, and saves the whole plan at once. A stale or invalid plan saves nothing.
- Everyone in a work space can see the load they are allowed to see, week by week, with unknown estimates
  shown as unknown.
- People can time their work on a task; tasks show estimated against spent.

## Non-goals

- Class spaces, class boards and student groups.
- Moving work automatically. AI and the allocator suggest; a person approves every assignment.
- Workload across spaces. A person in two spaces gets a separate load in each.
- Attendance, payroll, leave types, leave balances or statutory leave rules. Time off is dates and hours only.
- Rebalancing work already under way when someone's hours change. The view flags it; people decide.

## Anti-goals

- Activity monitoring (online time, idle detection, screenshots). Collabify never infers hours from activity.
- Forcing equal hours. Equal totals in the demo are an outcome of the estimates, not a target.
- AI choosing real people. The model never receives names, ids, hours, time off or skills of specific people.
- Leaking project content across visibility: a planner sees another project's hours only as one total.
- Treating estimate accuracy as a performance score or a ranking.

## Approaches considered

1. **Demo first (chosen).** Phase 1 builds the inputs and Break down and balance; phase 2 the workload views;
   phase 3 the timer and Home card. Answers the panelist soonest; each later phase improves the data.
2. **Foundation first.** Daily inputs, timer and views first, Break down and balance last. Real estimates
   build up before the demo, but the defense answer comes last.
3. **All at once.** No half states, but the longest wait and the largest single review before going live.

Load is computed on read by one SQL function, never stored, so it cannot drift (builder's call confirmed in
conversation).

## The numbers

All stored in minutes, shown in hours with one decimal.

**Available hours.** Each work-space membership gets nullable `weekly_minutes`. Null means unknown; Collabify
never assumes 40. The person sets their own; the space's project manager and coordinators can set anyone's in
their space. Weekly minutes spread evenly over Monday to Friday (my call; per-day hours are left out of the
first version).

**Time off.** Per person, not per space: a date and either a full day or a number of hours. Entered and edited
by the person only (my call). A full day removes that day's share in every space; partial hours reduce it, never
below zero; two entries on one date never remove more than the day's share. Planners see only "unavailable" and
the hours, never a reason. No approval step.

**Available hours in a window** = sum over weekdays in the window of (weekly ÷ 5 − time off that day, floored at
zero).

**Estimates.** `general_tasks.estimated_minutes` (the Codex column), nullable, work projects only. Set by the
project manager and coordinators on any task, and by a holder on a task they hold. Each change writes a task
history row. **Suggest estimate** (AI) proposes a value from the title and description; a person accepts it.

**Load in a window.** For a person, over open (not Done), live, released tasks they hold in the space's live
work projects:

- A task's estimate is split equally among its holders.
- A dated task's share is spread evenly over the weekdays from its start (or release date, or today if later)
  to its due date; the part that falls in the window counts. Overdue open work counts in the current week.
- A task with no due date counts in the current week (conservative, disclosed in the view).
- The full estimate counts, not estimate minus time logged (my call; logged time is not progress).
- Tasks with no estimate are counted separately as "N without an estimate" and never as zero.
- Private planning tasks never count.
- A parent that has subtasks stops counting its own estimate; its subtasks count instead, so the same work is
  never counted twice (my call). The review shows the parent's old estimate beside the subtasks' total.
- Only space members have weekly hours. On the live database every work project belongs to a space and every
  work-project member is a member of that space (checked 2026-11-22: zero exceptions), so candidates are
  required to be space members (my call).

**Projected** = load + hours added by the plan under review. **Free** = available − projected.

## Visibility

| Viewer | Sees |
| --- | --- |
| Space project manager | Every space member's load, broken down by project, and time off as hours |
| Space coordinators | Every space member's load and time off as hours; broken down by project only for projects they can read, the rest as one "other work in this space" total with no names (keeps today's rule that only the space PM reads every project) |
| A project's PM and coordinators | Their project's people: this project's hours, plus one "other work in this space" total with no project or task names |
| A receiving team's active lead (Planned mode) | Same as above, for their team's members only, in the holder picker (my call) |
| Everyone else | Their own load only |

The database enforces this; the frontend only renders what the functions return.

## Break down and balance

### Who and when

- Project manager and coordinators of a work project (the recorded decision from the Codex spec).
- The parent is a live, released, top-level, not-Done work task with no subtasks yet (a second run would
  duplicate work), in a project that allows subtasks. In Planned mode it must have a receiving team with an
  active lead; otherwise the button explains why and points to Plan & route.
- Open and Planned task flows both work. In Planned mode candidates come from the receiving team; in Open mode,
  anyone on the project who can hold tasks. QA, stakeholders and read-only viewers are never candidates.

### Steps

1. **Window and people.** The window defaults to the parent's start to due date; without both, the planner
   picks dates (default: this Monday to Friday). Eligible holders of the parent are preselected; the planner
   adds or removes eligible people.
2. **AI breakdown.** `work-ai` gets a new `breakdown` action. It verifies the caller and parent, then sends the
   model only the parent's title and description, the project's skill tags and position names as labels, and
   the window length. It returns 2 to 12 rows: key, title, description, estimated minutes, required skill tags or
   a position, dependsOn keys, rationale. The server rejects unknown labels, duplicate keys, self links, unknown
   links and cycles before returning.
3. **Recommend owners** (deterministic, `workloadPlan.ts`, reused from Codex and extended):
   - Pinned rows (the planner chose the owner) are reserved first.
   - Remaining rows are sorted by fewest qualified people, then largest estimate, then key.
   - Qualified: if anyone in the group has the required skill or position, only they qualify. If nobody in the
     group has it, everyone in the group qualifies and the row warns "No one here is tagged with Auth".
   - Pick the qualified person with the lowest projected load ÷ available hours after taking the row, only if it
     fits their free hours; ties go to a stable id order. Recompute after each pick.
   - Otherwise unassigned, with a reason: no skill match, unknown available hours, or not enough free hours
     ("Ana has 2 h free; this needs 6 h").
   - Each row gets the window's start and end as its start and due dates by default, editable in review, so the
     review screen and the Workload view count the same hours in the same weeks (my call).
4. **Review** (no writes). Planner edits titles, estimates, skills, owners (which pins them), dependencies, adds
   or removes rows. Totals update immediately. **Rebalance** reruns step 3 without another AI call and keeps
   pins.
5. **Create and assign subtasks.** One RPC, one transaction: lock the parent, recheck the caller's role, parent
   state, flow and receiving team, each owner's eligibility, dependency validity and each owner's current free
   hours. The client sends the load it showed for each owner; the save is refused only when an owner's load
   rose since the review or their eligibility changed. A planner may knowingly save a pinned owner who is over
   capacity or has unknown hours (the review warns first), matching the holder picker (my call). Then create the subtasks through the existing subtask rules, set estimates, add one holder per
   assigned row, add the dependency links. Any failure saves nothing and says what changed ("Ben joined
   another task; he now has 1 h free. Review again."). The parent's holders, team and routing are untouched.
   This approved plan is the one place a project manager or coordinator assigns directly in Planned mode; it does
   not widen ordinary assignment rules. Normal history and assignment notices fire.

### Review screen sketch

```
Break down Develop Login Module          Window: Mon 24 Nov – Fri 28 Nov
People: Ana · Ben · Carlo                                     [Rebalance]

Can start now
  Define sign-in contract      2 h  Auth    Ana   (only one tagged Auth)
  Design login page states     2 h  UI      Ben   (UI, lowest load)
  Prepare test cases           3 h  Testing Carlo
After the contract
  Auth and session handling    6 h  Auth    Ana
  Build interface, validation  8 h  UI      Ben
After both
  Integrate front and back     4 h  Testing Carlo
After integration
  End-to-end checks            5 h  Testing Carlo

Ana    existing 6 h + 8 h  = 14 / 16 h   ████████████▌░
Ben    existing 4 h + 10 h = 14 / 16 h   ████████████▌░
Carlo  existing 2 h + 12 h = 14 / 16 h   ████████████▌░
3 open tasks in this space have no estimate.
                                   [Cancel]  [Create and assign 7 subtasks]
```

### Defense example

Three junior developers, 16 available hours each in the window.

| Developer | Responsibilities | Existing | Added | Projected |
| --- | --- | ---: | ---: | ---: |
| A | Sign-in contract (2 h), authentication and session handling (6 h) | 6 h | 8 h | 14 / 16 h |
| B | Login page design and states (2 h), interface and validation (8 h) | 4 h | 10 h | 14 / 16 h |
| C | Test cases (3 h), integration (4 h), end-to-end checks (5 h) | 2 h | 12 h | 14 / 16 h |

Contract, page design and test preparation start together. Backend and interface wait for the contract and run
in parallel. Integration waits for both; end-to-end waits for integration.

Bottleneck: A takes 4 hours off that week, so 16 − 4 = 12 available, 10 already assigned, 2 free. The 6-hour
authentication row stays unassigned: "Only Ana is tagged Auth, and she has 2 h free."

## Space Workload view

A new **Workload** tab on a work space (Overview, Projects, Workload, Reports, Settings). People down the side,
weeks across (this week and the next three; earlier and later by arrows). Each cell: load ÷ available hours as a
bar in `success` (under 80%), `warning` (80–100%) or `danger` (over 100%), and `pending` when available hours are
unknown. Time off shows as a hatched part of the bar. Expanding a person lists their tasks for that week where
the viewer can read them; other projects appear as one total. A footer counts tasks without an estimate and
people without available hours. A project's PM and coordinators who are not space planners see rows for their
projects' people at the Visibility table's level; everyone else sees their own row (my call).

## Hours in the holder picker

Wherever a work-project task's holders are chosen (task dialog, New task in Open mode, team lead assignment),
each name shows "14 / 16 h this week", coloured like the view, for viewers allowed to see it. Picking someone
over capacity is allowed, with a warning line; nothing is blocked.

## Open task flow

In an Open project, Members create live tasks with holders (`create_general_open_task`) and change holders
(`set_general_task_holders`). Those tasks are released, so they count in the load like any other.

- The New task dialog in an Open project gets the estimate field with Suggest estimate. The creator may set the
  estimate at creation even when they will not hold the task; after that the estimate rule (planners and
  holders) applies.
- **Overload block for Members.** When a Member adds someone other than themselves as holder, the database
  checks whether that person's load in the task's weeks plus their share of the estimate passes their available
  hours. If it does, the holder is refused: "Ben has no room this week. Pick someone else or ask a project
  manager." The Member learns only that status, never Ben's hours. In the picker, full people show "No room this
  week" for Members.
- Picking yourself over capacity is allowed with a warning. The project manager and coordinators may assign over
  capacity with a warning, as in the holder picker.
- With no estimate or unknown available hours there is nothing to check, so the holder is allowed and the task
  counts in "without an estimate". The estimate field nudges toward entering one.
- The check is an addition to the two Open writers' callers, done in a new function both call (or a trigger on
  holder inserts limited to Open projects and Members); it redefines no existing guard. Builder picks which.

## My load on Home

A card on a member's Home for each work space they are in: this week's hours against available, the next
three weeks as small bars, tasks without an estimate, and buttons to set weekly hours and add time off.

## Task timer

- Start and Stop on a task, for people who can log time on it today. One running timer per person; starting
  another stops the first. Stored server-side (one row per person), so it survives reloads, tabs and devices.
- Stop writes one `general_task_logs` row (the existing table, 1–1440 minutes). Past 8 hours the timer stops at
  8 hours and asks the person to confirm or correct the time. Entries stay editable like manual logs.
- Tasks show "Est. 6 h · Spent 7 h 20 m", in `warning` when spent passes the estimate.
- Estimate accuracy ("your tasks usually take about 1.2× the estimate") appears after at least 5 Done tasks with
  both numbers, only to the person and their project's planners, never ranked.

## Phases

1. **Demo.** Available hours and time off; estimates with holder rights, history and Suggest estimate; the
   space load function with layered visibility; Break down and balance end to end.
2. **Views.** Hours in the holder picker; the space Workload tab; the Open-flow estimate field and the overload
   block for Members.
3. **Daily.** Task timer, estimated against spent, estimate accuracy; My load on Home.

Each phase ships, is verified and goes live on its own.

## Reuse from `codex/workload-balancing`

- Keep `estimated_minutes` and the TaskDialog field, but replace the planner-only guard with planners plus
  holders, show hours not minutes, and add the history row.
- Keep `balanceWorkPlan` and `dependencyGroups`; add the "nobody tagged" rule and reason text; rewrite the test
  to the full seven-row defense fixture (14 / 16 each) and the 2-hour bottleneck.
- Drop the leave categories, statutory references and leave confirmation flow.
- `work-workload.sql` grows into the phase-1 SQL file, registered before `anon-lockdown.sql` in
  `docs/07-backup.md` and `scripts/schema-drift.mjs` (one consistent position in both).

## Constraints

- Follow `CLAUDE.md`: tokens only, copy rules, desktop first, reduced motion, `useAuth`, idempotent SQL,
  `anon-lockdown.sql` last, a SQL suite per file, `npm run build` before claiming anything works.
- Reuse existing task, subtask, dependency, handoff, QA and history rules; redefine no existing guard.
- Ask before pushing to `main` (live site).

## Testing

- Vitest: allocator (defense fixture, bottleneck, pins, ties, nobody tagged, unknown hours, missing estimates),
  dependency groups, load spreading over weekdays, time-off overlap.
- SQL suite: who sets hours, estimates and time off; layered visibility for every viewer kind; load function
  results for a seeded space; apply permissions, Planned and Open, receiving team, QA and stakeholder exclusion,
  stale free hours, a failing last link rolling everything back, parent untouched, second run refused.
- `work-ai`: model input contains no person data; malformed output is refused.
- Browser walk on a demo space, desktop and phone, for each phase.

## Left to the builder

- Exact SQL table and function names, and where time off and the timer row live.
- The Workload tab's layout details beyond the sketch, and the review screen on phone.
- How the client shows the 8-hour timer prompt.
- Model prompt wording for `breakdown` and Suggest estimate.
