# Project Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every work-project member a read-only Progress tab beside Overview with milestone navigation, weekly completions, team and member comparisons, and assigned-task tables.

**Architecture:** Aggregate the live rows already loaded by `useGeneralProject` in pure TypeScript. Render the page inside `GeneralProject` and reuse the milestone diagram, donut and progress bar styles. Keep selection/filter in local state and milestone/task destinations in the URL.

**Tech Stack:** React 19, TypeScript, React Router 7, Tailwind 4, Vitest; existing Supabase reads.

**Spec:** `docs/superpowers/specs/2026-10-25-project-progress-design.md`

## Global Constraints

- Work projects only; every project member, including QA and stakeholders, can read Progress. Progress has no mutation controls.
- No SQL, new permission, table, RPC or dependency. Use `useGeneralProject`; only live, non-archived tasks count.
- A task counts once per project and within a team, and once for each assigned member. Zero tasks means 0%, never 100%.
- Team filter: `Team tasks` uses `team_id`; `Tasks held by team members` uses any team member's assignment. All members is unaffected.
- The line shows completed tasks per week for the latest 12 weeks in `Asia/Manila`, from currently Done tasks with `completed_at`; project versus one selected team or member.
- `project-progress` is the new tab id. Preserve legacy `?tab=progress` → Work Summary and all existing task links.
- Desktop, tablet and phone; no page-wide horizontal overflow. Use existing design tokens, sentence-case copy, reduced-motion behavior and accessible chart descriptions.
- Preserve unrelated working-tree changes. Stage only this feature's files. Run `python -m graphify update .` after code edits.

## Review Focus

1. A task held by two members of one team counts once for that team, once for the project, and once in each member row: Task 1 tests this.
2. Teamless and unassigned tasks remain in project totals and appear only in the appropriate team basis/member rows: Task 1 tests this.
3. A completion near Philippine midnight, a reopened task, and a Done task without `completed_at` yield the correct 12 weekly buckets: Task 1 tests this.
4. Old `?tab=progress` and task URLs still open Work; a new milestone URL survives reload and Back: Task 2 and Task 3 tests cover these routes.
5. A project with no teams, milestones or tasks, and members without tasks (QA/stakeholder included), renders readable zeros without editing controls: Task 4 tests and browser check cover this.

## File Map

| File | Responsibility |
| --- | --- |
| `src/lib/general/projectProgress.ts` (+ test) | Live task selection, team/member counts, weekly buckets. |
| `src/lib/general/navigation.ts` (+ test) | New tab id and milestone destination URL. |
| `src/components/work/MilestonesView.tsx`, `src/components/general/WorkTab.tsx` | Scroll/highlight URL-selected milestone on arrival. |
| `src/components/general/ProgressTab.tsx` | Read-only milestones, charts, team/member sections and task tables. |
| `src/components/charts/CompletionLineChart.tsx` | SVG chart with a count axis and accessible weekly values. |
| `src/pages/general/GeneralProject.tsx` | Top-level tab beside Overview and Progress rendering. |

### Task 1: Live task aggregation

**Files:** Create `src/lib/general/projectProgress.ts`, `src/lib/general/projectProgress.test.ts`.

**Interfaces:** `ProgressItem = Pick<GeneralTask, 'id' | 'team_id' | 'status' | 'assignee_ids' | 'completed_at' | 'archived_at'>`; `TeamBasis = 'team_tasks' | 'member_tasks'`; `CompletionWeek = { week: string; project: number; selected: number }`; `liveTasks<T extends ProgressItem>(tasks: readonly T[]): T[]`; `teamTasks<T extends ProgressItem>(tasks: readonly T[], teamId: string, memberIds: readonly string[], basis: TeamBasis): T[]`; `memberTasks<T extends ProgressItem>(tasks: readonly T[], userId: string): T[]`; `statusCounts(tasks: readonly ProgressItem[]): { todo: number; in_progress: number; done: number }`; `weeklyCompletions(project: readonly ProgressItem[], selected: readonly ProgressItem[], now: Date): CompletionWeek[]`. `week` is the Monday Philippine calendar date (`YYYY-MM-DD`), oldest first, including the current week.

- [ ] **Write failing Vitest cases:** a Done task held by users A and B on team X has project total 1, X total 1 and each member total 1; a task held across X and Y appears once in each team's member basis; a teamless assigned task appears in the project and member basis but not the team-id basis; an unassigned X task appears in X's team-id basis; archived tasks vanish; empty counts are all zero. At `2026-10-25T12:00:00+08:00`, assert 12 Monday buckets ending `2026-10-19`, with a UTC instant crossing Philippine midnight in the Philippine week; reopened or Done-without-date tasks add zero.
- [ ] **Run** `npx vitest run src/lib/general/projectProgress.test.ts`; expect failure before implementation.
- [ ] **Implement** the interfaces above using task-id deduplication within a team. Filter archived tasks once with `liveTasks`; bins contain only Done tasks with a valid `completed_at` in the 12-week window. Use `Intl.DateTimeFormat` with `Asia/Manila` for day conversion.
- [ ] **Run** `npx vitest run src/lib/general/projectProgress.test.ts` and `npm run build`; expect passes.
- [ ] **Review** the new file against the counting rules, then stage the two named files and commit `feat: add project progress aggregation`.

### Task 2: Milestone deep links

**Files:** Modify `src/lib/general/navigation.ts`, `src/lib/general/navigation.test.ts`, `src/components/work/MilestonesView.tsx`, `src/components/general/WorkTab.tsx`.

**Interfaces:** `milestoneParams(params: URLSearchParams, id: string): URLSearchParams` returns a copy with `tab=work`, `work=milestones`, `milestone=id`, and no `task`; `MilestonesView` gains optional `selectedId?: string | null`. The destination reads `params.get('milestone')` in `WorkTab` and scrolls/highlights its card after milestones render. Existing diagram clicks keep working.

- [ ] **Write failing navigation tests:** `milestoneParams('tab=project-progress&scope=a', 'm1')` yields `tab=work&work=milestones&milestone=m1&scope=a`, selects Work/Milestones, and leaves the input unchanged; `?tab=progress` still selects Work/Summary; `?tab=members&task=t1` still selects Work.
- [ ] **Run** `npx vitest run src/lib/general/navigation.test.ts src/lib/work/nav.test.ts`; expect the new helper test to fail.
- [ ] **Implement** `milestoneParams` and `selectedId` handling. Clear `milestone` on Work section change and on `GeneralProject.changeTab` when leaving Work (the latter may be committed with Task 3). If a milestone id is missing, leave the Milestones list usable. Honor reduced motion.
- [ ] **Run** the two navigation test files and `npm run build`; expect passes. Check a milestone URL by reload and browser Back when signed in.
- [ ] **Review** that no class MilestonesView behavior changed, then stage the four named files and commit `feat: link project milestones to their cards`.

### Task 3: Progress entry and charts

**Files:** Modify `src/lib/general/navigation.ts`, `src/lib/general/navigation.test.ts`, `src/pages/general/GeneralProject.tsx`; create `src/components/general/ProgressTab.tsx`, `src/components/charts/CompletionLineChart.tsx`.

**Interfaces:** `GeneralTabId` accepts `project-progress` and `generalTab(new URLSearchParams('tab=project-progress'))` returns it; `ProgressTab({ state }: { state: GeneralProjectState })` reads Task 1 functions and builds links with Task 2 `milestoneParams`. `CompletionLineChart({ weeks, selectedLabel }: { weeks: CompletionWeek[]; selectedLabel: string })` plots project and selected counts on an integer task axis and gives screen readers the 12 weekly values.

- [ ] **Write failing navigation tests:** `tab=project-progress` resolves to `project-progress`; `tab=progress` still resolves to Work and Summary; `tab=project-progress&task=t1` resolves to Work. The repository's Vitest setup runs pure Node tests, so check chart labels and its accessible 12-row table during browser review.
- [ ] **Run** the targeted Vitest files; expect the new tests to fail.
- [ ] **Implement** the top-level tab immediately after Overview for work projects, then the Progress page's milestone diagram/empty state, current completion bar, two status donuts, selector and focused 12-week chart. Initialize the team basis to `team_tasks`; Task 4 adds its visible switch. Reuse `MilestoneChart`, `sortMilestones`, `milestoneStatus`/`milestoneProgress`, `DonutChart` and existing tokens; avoid the percentage-only `LineChart`. Member selection always uses all assigned tasks. Clear stale `milestone` when leaving Work.
- [ ] **Run** targeted tests and `npm run build`; expect passes. Inspect desktop and phone with milestones and zero-task data.
- [ ] **Review** read-only controls, accessible chart values and legacy links, then stage only these named files and commit `feat: add project Progress tab and charts`.

### Task 4: Team and all-member details

**Files:** Modify `src/components/general/ProgressTab.tsx`, `src/lib/general/projectProgress.test.ts`.

**Interfaces:** Team basis state uses `TeamBasis` from Task 1. Team rows derive from `state.teams` and `state.teamMembers`; all-member rows derive from `state.members`. A task link opens `?tab=work&work=tasks&task=<id>` through the existing `TaskDialog` route. Member rows within a team use that team's filtered task set; all-member rows use all live tasks.

- [ ] **Write failing pure cases:** switching `teamTasks` from `team_tasks` to `member_tasks` changes the selected-team completion series when a member holds an outside-team task; a multi-team member is present in each team's selection but has one all-member task set; QA/stakeholder with no assignments have `memberTasks(...).length === 0`. Browser review checks the rendered no-team/no-task states and task URLs.
- [ ] **Run** the targeted tests; expect new assertions to fail.
- [ ] **Implement** team cards with progress bars, member rows and expandable task lists; then the independent All members table with team names, bars and expandable task lists. Show task title, status, due date and link. Explain that team totals can overlap in member-held mode. Keep narrow screens free of page-wide overflow.
- [ ] **Run** targeted tests, `npm run test`, `npm run build`, and `npm run lint`; expect passes. Run `python -m graphify update .` after the last code edit.
- [ ] **Browser check** signed-in desktop and phone for PM, coordinator, ordinary member, QA and stakeholder where accounts are available; test milestone/task links, reload/Back, both filters, empty data and archived view. The owner signs in. Record any role that could not be checked.
- [ ] **Review** all spec sections, stage only feature files, and commit `feat: show team and member project progress`.
