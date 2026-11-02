# Sprint organization: streams and flexible parallel (design)

Date: 2026-11-03. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section B ("Sprint organization: Sequential / Multiple sprint streams / Flexible
parallel"). Phase 1 shipped Sequential and showed the other two as "soon". This
design builds them for work projects.

## Why

Bigger projects have teams that move at their own pace. Today a work project can
run one sprint at a time, so a Frontend team finishing early waits for Backend,
or everyone shares one sprint that fits nobody. The PDF asks for two more ways to
organize sprints.

## What Collabify has today

- One running sprint per work project, enforced by the unique index
  `general_sprints_one_running` (`work-planning.sql`). Sprints have no team.
  Tasks have a `team_id` and a `sprint_id`.
- Sprint settings per project (`general_sprint_settings`: auto finish, auto
  start, carry, length, start day, run time) and the automation job
  `run_sprint_automation`, which assumes one running sprint (one scalar
  "running", the earliest planned sprint, one `auto_created_after`).
- Reopen (`reopen_general_sprint`) sends whatever is running back to planned.
  Finishing carries unfinished work to "the next planned sprint" or the backlog.
- The app reads one running sprint everywhere (`runningSprint()` in
  `lib/work/sprints.ts`): the Sprints tab, the Overview card, the Backlog's
  Start sprint, the Tasks tab scope picker, the milestone timeline highlight.
- The Settings → Sprints "Sprint organization" control is hard-coded:
  Sequential selected, the other two disabled; it saves nothing.
- Class boards already run one sprint per group, in parallel. They are out of
  scope and stay as they are.

## Decided by the owner

- **Multiple sprint streams = one stream per team.** Each team runs its own
  sprint, one at a time per team, at the same time as the other teams.
- **Flexible parallel = any sprints can overlap.** Any number of sprints can run
  at once, with no streams or teams needed. Each keeps its own dates; a task is
  in one sprint at a time.
- **In streams, the project manager, coordinators and the team's lead** start,
  finish and reopen a team's sprint.
- **In streams, a team's sprint holds only that team's tasks.** Tasks with no
  team **stay out of sprints** (they live in the backlog until they get a team).
- **Several running sprints show one at a time, with a switcher** (team tabs in
  streams, sprint tabs in flexible parallel) on the Sprints tab and the Overview.
- **In flexible parallel, the automation finishes and starts sprints but never
  creates one.**
- **Switching back to Sequential is refused until only one sprint is running.**

## My calls (owner to check)

1. **The setting.** `general_sprint_settings.organization` ('sequential' |
   'streams' | 'parallel', default 'sequential'), changed by whoever may change
   sprint settings today (the project manager and coordinators). The three
   choices in Settings → Sprints become live, each with a line of help:
   - Sequential: "One sprint runs at a time."
   - Multiple sprint streams: "Each team runs its own sprint, one at a time per
     team."
   - Flexible parallel: "Any number of sprints can run at once."
   Switching shows a confirm that says what changes.
2. **Sprints get a team.** `general_sprints.team_id` (nullable, a team of the
   same project). In streams mode a new sprint must have a team ("Choose the
   team this sprint is for."); in the other modes the team is optional and only a
   label. The Add/Edit sprint dialog gets a Team select.
3. **How many can run** replaces the unique index with a check when a sprint
   starts (and one advisory lock per project so two starts can't race):
   - Sequential: one per project ("Finish {sprint} first.").
   - Streams: one per team ("{team} is already running {sprint}."); a sprint
     with no team can't start ("Give this sprint a team first.").
   - Flexible parallel: no limit.
   Class boards keep their own per-board index.
4. **Switching modes.**
   - To Streams: refused while a running sprint has no team ("Give {sprint} a
     team first."). Planned sprints without a team stay planned and can't start
     until they get one.
   - To Sequential: refused while more than one sprint is running ("Finish all
     but one running sprint first.").
   - To Flexible parallel: always allowed.
5. **Tasks in a team's sprint (streams).** A task can join a sprint only when
   its team is the sprint's team; a task with no team can't join any sprint
   ("Give the task a team before planning it into a sprint."). Starting a sprint
   is refused while it holds tasks of another team or none ("{n} tasks in this
   sprint belong to another team. Move them out first."). When a task's team
   changes (a reroute, or someone edits it) while it sits in a team sprint, it
   goes back to the backlog, and the task history says so. Subtasks follow
   their parent, as today.
6. **Who runs a team's sprint (streams).** `general_can_run_sprint` gains the
   sprint: the project manager, coordinators, or the active lead of the sprint's
   team. Creating sprints and planning tasks into them keep today's rights
   (Manage tasks); leads plan their own team's tasks as they already may.
7. **Finishing and carrying unfinished work.**
   - Streams: "the next sprint" means the team's earliest planned sprint, else
     the backlog. The finish dialog only offers that team's planned sprints.
   - Flexible parallel: the finish dialog offers any planned sprint, or the
     backlog; the automation's "carry to next" uses the earliest planned sprint
     that hasn't started yet, else the backlog.
8. **Reopening a finished sprint.**
   - Sequential: as today (whatever runs goes back to planned).
   - Streams: only the same team's running sprint goes back to planned.
   - Flexible parallel: nothing else changes; the reopened sprint simply runs
     again.
9. **Automation.**
   - Streams: per team, the same rules as today: auto-finish each team's sprint
     on its end date, create the team's next sprint (named "{team} sprint {n}",
     same length and start day) when the team has none planned, and auto-start
     the team's earliest planned sprint when the team has none running.
   - Flexible parallel: auto-finish each sprint on its end date; auto-start each
     planned sprint on its start date; never create one.
   - Sequential: unchanged.
   The "already created after this sprint" memory becomes per sprint instead of
   one per project, so each team's chain is tracked on its own.
10. **Notices.** The sprint ending reminder (group 5) already covers every
    running sprint; in streams mode the team's lead also gets their team's
    reminder. The sprint finished notice and the automation notices name the
    team in streams mode ("Frontend sprint 3 is finished").
11. **Screens.**
    - Sprints tab and Overview "Running sprint" card: in Sequential, unchanged.
      In streams, a row of team tabs (only teams with a running sprint, plus
      "No sprint running" teams greyed); in flexible parallel, a row of sprint
      tabs. One sprint shows at a time. The first tab is the viewer's own team
      (streams) or the sprint ending soonest (parallel); the last pick is
      remembered per person on this device.
    - Backlog: "Start sprint" is only blocked by the mode's rule (above), with
      the same message. "Move to" lists label running sprints with their team
      ("Sprint 3 · Frontend · running"); in streams a task only sees its team's
      sprints.
    - Tasks tab scope picker: one "Running · {sprint}" entry per running sprint.
    - Milestone timeline: every milestone with a running sprint is highlighted.
12. **Project manager rights and the QA gate, release boundary, milestone and
    notification rules all stay as they are.** Workflow rules are unaffected.
13. **Database file.** A new `supabase/sprint-organization.sql`, after
    `project-workflow-rules.sql` and before `anon-lockdown.sql`. It redefines
    the sprint functions from their live definitions (`complete_general_sprint`
    and `run_sprint_automation` are owned by `project-notification-rules.sql`;
    `reopen_general_sprint` by `sprint-reopen.sql`; `general_can_run_sprint` and
    the guards by `sprint-settings.sql`) and never touches `board_sprints`.

14. **Which teams the automation covers (streams).** Only teams that have
    used sprints: a team's next sprint is created only after one of its sprints
    finishes, exactly like today's chain. A team that never had a sprint gets
    none on its own. Today's single "created after" memory carries over to the
    sprint it points at.
15. **Switching to Streams with work already planned.** Also refused while a
    running sprint holds tasks of another team or with no team ("{sprint} holds
    tasks of other teams. Move them out first."). Planned sprints are left as
    they are and checked when they start.
16. **When an automatic start can't happen** (no team, another team's tasks,
    the team already running one): the job skips that sprint, records the reason
    on it (shown on the sprint in the Sprints tab and Backlog as "Couldn't start
    on its own: {reason}"), and tells the project manager, coordinators and the
    team's lead once per sprint, not every run. Fixing the cause and starting it
    by hand, or the next successful run, clears it.
17. **Changing a sprint's team.** A planned sprint's team can change only while
    it holds no tasks ("Move its tasks out first."). A running or finished
    sprint's team is fixed. Archiving a team is refused while it has a running
    sprint ("Finish {sprint} first."); its planned sprints lose their team and
    wait for a new one. Deleting a team clears the team from its sprints.
18. **A team change on a Done or archived task** leaves it in its sprint, so the
    sprint's record stays whole. Only open tasks go back to the backlog.
19. **Leaving Streams.** Teams stay on sprints as labels. The streams-only task
    rules (team must match, no team means no sprint) apply only while the
    project is in Streams.
20. **Reopening in Flexible parallel** behaves like today's reopen otherwise,
    including a sprint whose end date has passed (the automation may finish it
    again on its next run, as it would today).

## Non-goals

Class boards, per-team sprint settings (length, start day and run time stay per
project), several streams per team, a combined all-teams sprint chart, sprint
reports for work projects.

## Constraints

Tokens only, copy rules, desktop → phone, idempotent SQL, redefinitions from live
definitions, release boundary, the existing guards never bypassed, owner reviews
before any live SQL or push.
