# Project progress — design

Status: awaiting owner approval, 2026-10-25.

## Intent

A work project has an Overview tab for its details and a Work tab with a Summary, tasks, sprints and milestones. Summary already shows overall completion and a small holder breakdown, but there is no single read-only page where everyone on the project can follow milestones, teams and every member's assigned work. Add **Progress** as a top-level tab immediately after Overview. It is for viewing; task, team and milestone changes stay in their existing places.

## Decisions from the conversation

- Progress sits beside **Overview**, outside **Work**. It is available to every project member, including QA and stakeholders, subject to the project's existing read access. It is a work-project feature; class projects keep their current views.
- The first section is the project's milestone diagram. Selecting a milestone opens that milestone's detail under **Work → Milestones**, with the destination in the URL so reload and Back preserve it.
- The page shows team and member completion bars, simple donut charts, a line chart, and task tables. Team sections show their members and the tasks each holds. A separate all-members table shows every member's assigned tasks across the project.
- A team filter switches between **Team tasks** (tasks whose `team_id` is that team) and **Tasks held by team members** (tasks assigned to at least one of its members, regardless of `team_id`).
- The line chart uses **Focused comparison**: the project line is always present; the second line shows one selected team or member. It plots how many currently live tasks were completed in each week, not an exact historical percentage. The team line follows the team filter.

## Approaches considered

1. **Use the project data already loaded for Work (chosen).** `useGeneralProject` provides live tasks, milestones, teams, team membership and project members. Aggregate those rows in pure client code. Reuse the existing milestone diagram and donut; adapt the existing SVG line-chart style to a count scale (its current component assumes 0–100%). This adds no database object or dependency. The weekly completion line reflects the currently live task set: archived tasks and earlier completions of tasks later reopened are absent.
2. **Add a project history endpoint.** A new read-only database query could reconstruct exact past percentages, including reopenings and archives. It would add SQL and access rules because the existing report history intentionally limits ordinary members to their own activity. This is unnecessary for the selected completed-tasks-per-week line.

## Page structure

1. **Milestones.** Reuse the current diagram and milestone status rules. Date order and reached state match Work → Milestones. A selected milestone navigates to the same project's Work tab, Milestones section, and the selected milestone card; that card scrolls into view and is highlighted. With no milestones, show a plain empty state and a link to Work → Milestones, with no editing control on Progress.
2. **Completion.** Show project-wide done/total and a progress bar. A donut splits live tasks into To do, In progress and Done. A second small donut reflects the selected team or member, using the same task basis as its line. With no tasks, show zero rather than implying 100% completion.
3. **Completed tasks over time.** Two lines show weekly completions over the most recent 12 weeks: all live project tasks and the selected team or member's live tasks. A selector picks one team or one member. The vertical axis is **tasks completed that week**, not percent. A week with no completions is zero. A task with multiple assignees counts once in the project line and once for each selected assignee; it counts once within a team even if two team members hold it. Use `completed_at` only for tasks currently Done. The chart describes these limits in a short caption.
4. **Teams.** The Team tasks / Tasks held by team members filter controls each team's done/total, progress bar, member breakdown and selected team chart line. Each team shows its members, including members with zero assigned tasks. A member's rows within a team use that team's current task basis. Expand a member to see task title, status and due date, with a link to the existing task view. A team with no matching tasks shows 0 of 0 and an empty explanation.
5. **All members.** One row per project member, regardless of team or role, with team names, assigned done/total, a progress bar and a list of their live assigned tasks. Expand a row to see task title, status, due date and a task link. QA and stakeholders, who do not take tasks, appear with zero tasks. Members with no team still appear here.

## Counting rules

- Current completion everywhere on this page means `status = 'done'` out of live, non-archived tasks. Every task has equal weight, matching `src/lib/general/progress.ts` and today's Summary.
- Project totals count each task once. Member totals count each task for every assignee. Team totals deduplicate by task id *within* that team. Under **Tasks held by team members**, the same task may count in more than one team when assignees belong to different teams; the UI states that team totals need not add to the project total.
- A task with no `team_id` is absent from **Team tasks**, but remains in project and assigned-member totals. It may appear under a team in **Tasks held by team members**. Unassigned tasks count in project totals and in a team's Team tasks total when tagged to that team; they appear under no member.
- A member on multiple teams appears under each team, but only once in All members. Team-member rows and the selected team chart use the same filter as the team total. The All members table is unaffected by the team filter.
- Dates in the weekly line use the project's Philippine date convention (`Asia/Manila`). Earlier than 12 weeks and archived tasks stay out of the line, but current progress bars and donuts count all live tasks.

## Access and behavior

- Reuse `useGeneralProject` and its existing project read rules. Do not use the space Reports RPCs for this tab: those deliberately narrow ordinary members' person-level report data. No new permission, SQL function, storage table or dependency is required.
- Progress itself has no mutation controls. Links to a task or milestone move into Work, where the existing role and archive guards continue to decide what the viewer may do.
- Selection of the top-level tab and a chosen milestone is in the URL. Use a new tab id such as `project-progress`, preserving the existing `?tab=progress` legacy link to Work → Summary. The chart's selected team/member and the team counting filter may be local view state; they never change project data.
- Work's existing Summary and Milestones sections remain. The new Progress page offers a fuller cross-team and per-person view; existing deep links still work.
- Layout is desktop first, then tablet and phone. Charts stack on narrow screens; tables remain readable without page-wide horizontal overflow. Use the existing design tokens, sentence-case copy and accessible chart descriptions.

## Verification

- Pure tests cover task deduplication, the two team bases, members in multiple teams, unassigned tasks, zero denominators, multiple assignees and weekly completion buckets.
- Navigation tests cover the top-level Progress tab and milestone-to-card link, including reload and Back.
- `npm run build` and Vitest pass. In a signed-in browser, check desktop and phone with a project that has milestones, teams, mixed assignments, QA and a stakeholder; verify every role can view Progress and its links land on the right milestone or task. The owner signs in; agents do not.

## Left to the builder

- Exact card and table spacing, and whether long task lists open inline or in a read-only detail panel, within the layout above.
- The short copy for empty states and the caption explaining the weekly line.
