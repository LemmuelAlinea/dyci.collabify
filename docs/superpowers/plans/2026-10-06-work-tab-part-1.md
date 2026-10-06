# Work tab, Part 1 — Tasks views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename each project's Tasks tab to **Work**, give it a Summary · Tasks sub-nav, and give Tasks four layouts (Board, List, Timeline, Calendar) in both the work space and class projects. The Progress tab folds into Work › Summary.

**Architecture:** URL-driven sub-navigation (`?tab=work&work=<section>&layout=<layout>`) parsed by one pure module (`src/lib/work/nav.ts`). Timeline and calendar logic become space-agnostic pure modules under `src/lib/work/`. Shared presentational components live in `src/components/work/`. Each space keeps its own Board and List, plus its own data hook (`useGeneralProject` for work projects, `useProjectTasks` for class projects). Class tasks gain a planned `starts_at` column so they can draw bars on the Timeline.

**Tech Stack:** React 19 + TypeScript + Vite, react-router `useSearchParams`, Tailwind tokens from `src/styles/index.css`, Vitest, Supabase Postgres (SQL files run with `node scripts/db.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md`. This plan covers rollout Part 1 only.

## Global Constraints

- No hardcoded colours. Use tokens only: `surface*`, `text-ink/muted/faint`, `border-line*`, `navy-*`, `amber-*`, and the status ramps `success-*` / `warning-*` / `danger-*` / `pending-*`. Never `emerald-*`, `red-*`, or brand amber for a status.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Layout: desktop first, then tablet, then phone. At 375 px there must be no sideways page scroll.
- `supabase/*.sql` files must be idempotent, because they get re-run.
- Auth comes from `useAuth()` only. No direct `supabase.auth` calls in pages.
- Run `npm run build` before claiming anything works.
- Old links must keep working: `?tab=tasks` and `?tab=progress` on both project pages.
- Commit messages follow the repo style (plain imperative sentence) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Part 1 shows only the **Summary** and **Tasks** sections. Backlog, Sprints and Milestones arrive in Parts 2–3.
- Intentional deviation from the spec: the class `starts_at` column lives in a new `supabase/class-schedule.sql` (mirroring `general-schedule.sql`), not in `class-planning.sql`, because Part 1 needs it before sprints exist.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/work/nav.ts` (+ `.test.ts`) | new | Parse and write `work` / `layout` URL params, including legacy tab names |
| `src/lib/work/timeline.ts` (+ `.test.ts`) | moved from `src/lib/general/timeline.ts` | Timeline window, bars and diamonds, ticks, rows. Generic `group_id` instead of `team_id` |
| `src/lib/work/calendar.ts` (+ `.test.ts`) | new | Turn tasks of either space into `CalendarEvent`s |
| `src/components/work/WorkNav.tsx` | new | The Summary · Tasks sub-nav |
| `src/components/work/TimelineView.tsx` | new (replaces `general/GanttChart.tsx`) | Gantt drawing from props, no project state |
| `src/components/work/TaskCalendar.tsx` | new | Month navigation around `calendar/MonthGrid` |
| `src/components/tasks/TaskViewSwitch.tsx` | modify | Four layouts instead of summary/board/list |
| `src/lib/general/navigation.ts` (+ test) | modify | `'tasks'` and `'progress'` become `'work'` |
| `src/components/general/WorkTab.tsx` | new | Work tab for work projects: nav, section, task dialog |
| `src/components/general/WorkSummary.tsx` | new | Where we are, tiles/donut/load (moved), forecast, late |
| `src/components/general/TasksTab.tsx` | modify | Tasks section only: Board/List/Timeline/Calendar |
| `src/components/general/ProgressTab.tsx`, `GanttChart.tsx` | delete | Folded into Work |
| `src/pages/general/GeneralProject.tsx` | modify | Tab list and tab change |
| `src/components/general/SinceLastVisit.tsx` | modify | Links to `tab=work` |
| `supabase/class-schedule.sql`, `supabase/tests/class-schedule.test.sql` | new | `project_tasks.starts_at`, view, guard |
| `docs/07-backup.md` | modify | Add `class-schedule.sql` to the run list |
| `src/lib/types.ts`, `src/lib/api/tasks.ts`, `src/components/tasks/TaskForm.tsx`, `TaskBoard.tsx` | modify | Class planned start |
| `src/components/tasks/classTimeline.ts` | new | Class rows → `TimelineTask` |
| `src/components/tasks/useProjectTasks.ts` | modify | URL-backed section and layout |
| `src/components/tasks/ProjectTasksTab.tsx`, `StudentTasksView.tsx`, `ProfessorTasksView.tsx` | modify | Summary / Tasks split, Timeline and Calendar |
| `src/components/tasks/ProgressTab.tsx` | delete | Folded into Work › Summary |
| `src/pages/app/projects/ProjectDetail.tsx` | modify | Tab id `work`, label "Work", no Progress tab |
| `AnnouncementLinks.tsx`, `GroupWork.tsx`, `Reassignments.tsx`, `Submissions.tsx`, `Trash.tsx` | modify | `tab=tasks` → `tab=work` |
| `handoff.md` | modify | New section at the end |

---

### Task 1: Work URL state (`src/lib/work/nav.ts`)

**Files:**
- Create: `src/lib/work/nav.ts`
- Test: `src/lib/work/nav.test.ts`

**Interfaces:**
- Produces:
  - `type WorkSection = 'summary' | 'tasks'`
  - `type TaskLayout = 'board' | 'list' | 'timeline' | 'calendar'`
  - `WORK_SECTIONS: readonly WorkSection[]`, `TASK_LAYOUTS: readonly TaskLayout[]`
  - `workSection(params: URLSearchParams, fallback: WorkSection): WorkSection`
  - `taskLayout(params: URLSearchParams): TaskLayout`
  - `withWork(params: URLSearchParams, patch: { section?: WorkSection; layout?: TaskLayout }): URLSearchParams`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/work/nav.test.ts
import { describe, expect, it } from 'vitest'
import { taskLayout, withWork, workSection } from './nav'

const p = (q: string) => new URLSearchParams(q)

describe('workSection', () => {
  it('reads a named section', () => {
    expect(workSection(p('tab=work&work=summary'), 'tasks')).toBe('summary')
    expect(workSection(p('tab=work&work=tasks'), 'summary')).toBe('tasks')
  })

  it('falls back when nothing or something unknown is named', () => {
    expect(workSection(p(''), 'tasks')).toBe('tasks')
    expect(workSection(p('work=sprints'), 'summary')).toBe('summary')
  })

  it('sends the old Progress tab to Summary', () => {
    expect(workSection(p('tab=progress'), 'tasks')).toBe('summary')
  })

  it('sends the old Tasks tab and board links to Tasks', () => {
    expect(workSection(p('tab=tasks'), 'summary')).toBe('tasks')
    expect(workSection(p('tab=tasks&board=b1'), 'summary')).toBe('tasks')
    expect(workSection(p('board=b1'), 'summary')).toBe('tasks')
  })

  it('lets an explicit section win over a legacy tab', () => {
    expect(workSection(p('tab=tasks&work=summary'), 'tasks')).toBe('summary')
  })
})

describe('taskLayout', () => {
  it('reads each layout and defaults to board', () => {
    expect(taskLayout(p('layout=list'))).toBe('list')
    expect(taskLayout(p('layout=timeline'))).toBe('timeline')
    expect(taskLayout(p('layout=calendar'))).toBe('calendar')
    expect(taskLayout(p(''))).toBe('board')
    expect(taskLayout(p('layout=gantt'))).toBe('board')
  })
})

describe('withWork', () => {
  it('sets section and layout and keeps other params', () => {
    const next = withWork(p('tab=work&task=t1'), { section: 'tasks', layout: 'calendar' })
    expect(next.get('work')).toBe('tasks')
    expect(next.get('layout')).toBe('calendar')
    expect(next.get('task')).toBe('t1')
  })

  it('renames a legacy tab so the address reads Work', () => {
    expect(withWork(p('tab=tasks'), { layout: 'list' }).get('tab')).toBe('work')
    expect(withWork(p('tab=progress'), { section: 'summary' }).get('tab')).toBe('work')
  })

  it('leaves another tab alone', () => {
    expect(withWork(p('tab=files'), { layout: 'list' }).get('tab')).toBe('files')
  })

  it('does not change the params it was given', () => {
    const before = p('tab=work')
    withWork(before, { section: 'summary' })
    expect(before.has('work')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/work/nav.test.ts`
Expected: FAIL, "Failed to resolve import './nav'".

- [ ] **Step 3: Implement**

```ts
// src/lib/work/nav.ts
/**
 * Where you are inside a project's Work tab, kept in the address so a link,
 * a reload or the back button lands on the same section and layout.
 *
 * `work` names the section and `layout` names how Tasks are drawn. Both are
 * their own keys because `view` is already taken by the Files tab
 * (`?tab=files&view=draft`).
 */
export type WorkSection = 'summary' | 'tasks'
export type TaskLayout = 'board' | 'list' | 'timeline' | 'calendar'

export const WORK_SECTIONS: readonly WorkSection[] = ['summary', 'tasks']
export const TASK_LAYOUTS: readonly TaskLayout[] = ['board', 'list', 'timeline', 'calendar']

/** The tab names Work replaced. Links written before it still arrive with them. */
const LEGACY_TABS = new Set(['tasks', 'progress'])

export function workSection(params: URLSearchParams, fallback: WorkSection): WorkSection {
  const named = params.get('work')
  if (named && (WORK_SECTIONS as readonly string[]).includes(named)) return named as WorkSection
  if (params.get('tab') === 'progress') return 'summary'
  if (params.get('tab') === 'tasks' || params.has('board')) return 'tasks'
  return fallback
}

export function taskLayout(params: URLSearchParams): TaskLayout {
  const named = params.get('layout')
  return named && (TASK_LAYOUTS as readonly string[]).includes(named) ? (named as TaskLayout) : 'board'
}

export function withWork(
  params: URLSearchParams,
  patch: { section?: WorkSection; layout?: TaskLayout },
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (patch.section) next.set('work', patch.section)
  if (patch.layout) next.set('layout', patch.layout)
  if (LEGACY_TABS.has(next.get('tab') ?? '')) next.set('tab', 'work')
  return next
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/work/nav.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/nav.ts src/lib/work/nav.test.ts
git commit -m "Read and write the Work tab's section and layout from the address

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Make the timeline logic space-agnostic

Move `src/lib/general/timeline.ts` to `src/lib/work/timeline.ts`. `TimelineTask` currently picks fields from `GeneralTask`; it becomes a plain type whose `team_id` is renamed `group_id`. A row's `team` / `teamName` become `group` / `groupName`, and `groupRows` takes the label for ungrouped work.

**Files:**
- Move: `src/lib/general/timeline.ts` → `src/lib/work/timeline.ts`
- Move: `src/lib/general/timeline.test.ts` → `src/lib/work/timeline.test.ts`
- Modify: `src/components/general/GanttChart.tsx` (import path only. The file is deleted in Task 6)

**Interfaces:**
- Produces:
  - `type WorkStatus = 'todo' | 'in_progress' | 'done'`
  - `type TimelineTask = { id: string; title: string; status: WorkStatus; starts_at: string | null; due_at: string | null; group_id: string | null }`
  - `type TimelineRow = { group: string | null; groupName: string; tasks: TimelineTask[] }`
  - `groupRows(tasks, groups: readonly { id: string; name: string }[], looseLabel = 'Whole project'): TimelineRow[]`
  - Unchanged exports: `TimelineWindow`, `Placement`, `Tick`, `timelineWindow`, `placeTask`, `axisTicks`, `nowMarker`

- [ ] **Step 1: Move the files and rename the fields mechanically**

```bash
git mv src/lib/general/timeline.ts src/lib/work/timeline.ts
git mv src/lib/general/timeline.test.ts src/lib/work/timeline.test.ts
sed -i 's/team_id/group_id/g; s/teamName/groupName/g; s/\bteam: /group: /g' src/lib/work/timeline.ts src/lib/work/timeline.test.ts
```

- [ ] **Step 2: Replace the type header and `groupRows` in `src/lib/work/timeline.ts`**

Replace the `import type { GeneralTask } ...` line and the `TimelineTask` type with:

```ts
export type WorkStatus = 'todo' | 'in_progress' | 'done'

/**
 * One task as the timeline sees it, from either space. `group_id` is a work
 * project's team or, on a professor's view of a class project, a board.
 */
export type TimelineTask = {
  id: string
  title: string
  status: WorkStatus
  starts_at: string | null
  due_at: string | null
  group_id: string | null
}
```

Set `TimelineRow` to:

```ts
export type TimelineRow = { group: string | null; groupName: string; tasks: TimelineTask[] }
```

In `groupRows`, add the `looseLabel` parameter and rename its variables. Keep the `order` comparator exactly as it is:

```ts
export function groupRows(
  tasks: readonly TimelineTask[],
  groups: readonly { id: string; name: string }[],
  looseLabel = 'Whole project',
): TimelineRow[] {
  // `order` comparator unchanged
  const rows: TimelineRow[] = []

  // Work that belongs to everybody reads first; it is the project's own spine.
  // A group_id pointing at no group on this list — deleted since, or filtered
  // out by the caller — belongs here too rather than nowhere.
  const known = new Set(groups.map((g) => g.id))
  const loose = tasks.filter((t) => !t.group_id || !known.has(t.group_id))
  if (loose.length) rows.push({ group: null, groupName: looseLabel, tasks: [...loose].sort(order) })

  for (const group of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = tasks.filter((t) => t.group_id === group.id)
    if (mine.length) rows.push({ group: group.id, groupName: group.name, tasks: [...mine].sort(order) })
  }

  return rows
}
```

- [ ] **Step 3: Add a failing test for the loose label**

Append inside the `describe('groupRows', ...)` block of `src/lib/work/timeline.test.ts`:

```ts
  it('names ungrouped work with the label it is given', () => {
    const rows = groupRows([task({ group_id: null })], [], 'Your group')
    expect(rows.map((r) => r.groupName)).toEqual(['Your group'])
  })
```

Run: `npx vitest run src/lib/work/timeline.test.ts`
Expected: the new test passes if Step 2 is done. If Step 2 was skipped, it fails with "Your group" ≠ "Whole project". Every other test passes, because only names changed.

- [ ] **Step 4: Point the Gantt chart at the new module**

In `src/components/general/GanttChart.tsx`:
- Change both imports to `'../../lib/work/timeline'`.
- In the `tasks` mapping, use `group_id: t.team_id`.
- Use `<section key={row.group ?? 'loose'}>` and `{row.groupName}`.

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/work src/lib/general src/components/general/GanttChart.tsx
git commit -m "Move timeline logic to lib/work so class projects can use it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tasks as calendar events (`src/lib/work/calendar.ts`)

**Files:**
- Create: `src/lib/work/calendar.ts`
- Test: `src/lib/work/calendar.test.ts`

**Interfaces:**
- Consumes: `CalendarEvent` from `src/lib/types.ts` (fields: `kind, ref_id, title, at, class_id, class_initial, class_name, project_id, project_title, task_id, group_name, done, late`). `WorkStatus` from Task 2.
- Produces: `type CalendarTask = { id: string; title: string; status: WorkStatus; due_at: string | null; late?: boolean }` and `taskCalendarEvents<T extends CalendarTask>(tasks: readonly T[], label?: (task: T) => string): CalendarEvent[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/work/calendar.test.ts
import { describe, expect, it } from 'vitest'
import { taskCalendarEvents } from './calendar'

const task = (over: Partial<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done'; due_at: string | null; late: boolean }> = {}) => ({
  id: 't1',
  title: 'Draw the ERD',
  status: 'todo' as const,
  due_at: '2026-10-10T09:00:00Z',
  ...over,
})

describe('taskCalendarEvents', () => {
  it('turns a dated task into a task_due event that opens the task', () => {
    const [e] = taskCalendarEvents([task()])
    expect(e.kind).toBe('task_due')
    expect(e.ref_id).toBe('t1')
    expect(e.task_id).toBe('t1')
    expect(e.at).toBe('2026-10-10T09:00:00Z')
    expect(e.title).toBe('Draw the ERD')
    expect(e.class_id).toBe('')
  })

  it('leaves out tasks with no due date', () => {
    expect(taskCalendarEvents([task({ due_at: null })])).toEqual([])
  })

  it('keeps finished tasks, marked done', () => {
    const [e] = taskCalendarEvents([task({ status: 'done' })])
    expect(e.done).toBe(true)
  })

  it('marks late only on finished tasks stamped late', () => {
    expect(taskCalendarEvents([task({ status: 'done', late: true })])[0].late).toBe(true)
    expect(taskCalendarEvents([task({ status: 'todo', late: true })])[0].late).toBe(false)
  })

  it('writes the label under the title when one is given', () => {
    const [e] = taskCalendarEvents([task()], () => 'Group 2')
    expect(e.project_title).toBe('Group 2')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/work/calendar.test.ts`
Expected: FAIL, "Failed to resolve import './calendar'".

- [ ] **Step 3: Implement**

```ts
// src/lib/work/calendar.ts
import type { CalendarEvent } from '../types'
import type { WorkStatus } from './timeline'

export type CalendarTask = {
  id: string
  title: string
  status: WorkStatus
  due_at: string | null
  /** Class tasks only: stamped when finished after the deadline. */
  late?: boolean
}

/**
 * A project's tasks on the month grid, from either space.
 *
 * Finished tasks stay on (the grid strikes them through), so a month that went
 * well still shows what was done in it. `class_id` is blank because the grid
 * reads a blank one as "no class initial to print".
 */
export function taskCalendarEvents<T extends CalendarTask>(
  tasks: readonly T[],
  label: (task: T) => string = () => '',
): CalendarEvent[] {
  return tasks
    .filter((t) => t.due_at)
    .map(
      (t): CalendarEvent => ({
        kind: 'task_due',
        ref_id: t.id,
        title: t.title,
        at: t.due_at as string,
        class_id: '',
        class_initial: '',
        class_name: '',
        project_id: '',
        project_title: label(t),
        task_id: t.id,
        group_name: null,
        done: t.status === 'done',
        late: t.status === 'done' && Boolean(t.late),
      }),
    )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/work/calendar.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/calendar.ts src/lib/work/calendar.test.ts
git commit -m "Shape either space's tasks as calendar events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared Work components (nav, view switch, timeline, calendar)

**Files:**
- Create: `src/components/work/WorkNav.tsx`
- Create: `src/components/work/TimelineView.tsx`
- Create: `src/components/work/TaskCalendar.tsx`
- Modify: `src/components/tasks/TaskViewSwitch.tsx` (the `TaskView` type, `ICON`, and the button loop)

**Interfaces:**
- Consumes: `WorkSection`, `TaskLayout`, `WORK_SECTIONS` (Task 1). `TimelineTask`, `timelineWindow`, `placeTask`, `axisTicks`, `groupRows`, `nowMarker` (Task 2). `CalendarEvent`, `MonthGrid` (`src/components/calendar/MonthGrid.tsx`, props `{ month, events, weeks, showSyllabus?, onOpen }`).
- Produces:
  - `WorkNav({ active, onChange }: { active: WorkSection; onChange: (s: WorkSection) => void })`
  - `TimelineView({ tasks, groups, span, looseLabel?, onOpen? })` and `NO_SPAN`
  - `TaskCalendar({ events, onOpen }: { events: CalendarEvent[]; onOpen: (taskId: string) => void })`
  - `TaskView` is now `TaskLayout` (`'board' | 'list' | 'timeline' | 'calendar'`)

- [ ] **Step 1: Create `WorkNav`**

```tsx
// src/components/work/WorkNav.tsx
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { WORK_SECTIONS } from '../../lib/work/nav'
import type { WorkSection } from '../../lib/work/nav'

const LOOK: Record<WorkSection, { label: string; icon: IconName }> = {
  summary: { label: 'Summary', icon: 'chart' },
  tasks: { label: 'Tasks', icon: 'check' },
}

/**
 * The sections inside Work. A level above the task layouts, so it is drawn
 * filled navy rather than as another grey pill switch, and it scrolls sideways
 * on a phone instead of wrapping onto a second line.
 */
export function WorkNav({ active, onChange }: { active: WorkSection; onChange: (s: WorkSection) => void }) {
  return (
    <nav aria-label="Work sections" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex gap-1 rounded-xl border border-line surface p-1 shadow-card">
        {WORK_SECTIONS.map((id) => {
          const on = active === id
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onChange(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors ${
                on
                  ? 'bg-navy-600 font-medium text-white dark:bg-navy-500'
                  : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
              }`}
            >
              <Icon name={LOOK[id].icon} size={15} />
              {LOOK[id].label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Give `TaskViewSwitch` four layouts**

In `src/components/tasks/TaskViewSwitch.tsx`, replace the `TaskView` type and the `ICON` constant:

```tsx
import { TASK_LAYOUTS } from '../../lib/work/nav'
import type { TaskLayout } from '../../lib/work/nav'

export type TaskView = TaskLayout

const ICON = { board: 'kanban', list: 'board', timeline: 'clock', calendar: 'calendar' } as const
```

Change the loop `{(['summary', 'board', 'list'] as const).map((v) => (` to `{TASK_LAYOUTS.map((v) => (`. Replace `className="surface-sunken flex gap-1 rounded-lg p-0.5"` with `className="surface-sunken flex max-w-full gap-1 overflow-x-auto rounded-lg p-0.5"`, and add `shrink-0` to each button's class list so four buttons fit at 375 px.

- [ ] **Step 3: Create `TimelineView`**

Copy `src/components/general/GanttChart.tsx` to `src/components/work/TimelineView.tsx`, then make these edits:
1. Import from `'../../lib/work/timeline'`. Drop the `GeneralProjectState` import.
2. Replace the component signature and its first lines (up to `const window = ...`) with:

```tsx
/** For a caller with no project dates: the window is taken from the tasks. */
export const NO_SPAN = { starts_on: null, ends_on: null } as const

export function TimelineView({
  tasks,
  groups,
  span,
  looseLabel = 'Whole project',
  onOpen,
}: {
  tasks: TimelineTask[]
  groups: readonly { id: string; name: string }[]
  span: { starts_on: string | null; ends_on: string | null }
  looseLabel?: string
  onOpen?: (taskId: string) => void
}) {
  const window = timelineWindow(span, tasks)
  const rows = groupRows(tasks, groups, looseLabel)
```

3. Rename the component's doc comment heading from "The project's whole timeline." to "Tasks laid out across time."
4. Replace the task title `<p className="w-[14rem] shrink-0 truncate px-3 py-2 text-[13px] text-ink">{task.title}</p>` with a button when `onOpen` is given:

```tsx
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(task.id)}
                        className="w-[14rem] shrink-0 truncate px-3 py-2 text-left text-[13px] text-ink hover:underline"
                      >
                        {task.title}
                      </button>
                    ) : (
                      <p className="w-[14rem] shrink-0 truncate px-3 py-2 text-[13px] text-ink">{task.title}</p>
                    )}
```

5. Change the copy line `window.source === 'project' ? "Across this project's own dates." : 'Across the dates its tasks carry — the project has no dates of its own.'` to `window.source === 'project' ? "Across this project's own dates." : 'Across the dates these tasks carry.'`.

- [ ] **Step 4: Create `TaskCalendar`**

```tsx
// src/components/work/TaskCalendar.tsx
import { useState } from 'react'
import { MonthGrid } from '../calendar/MonthGrid'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { CalendarEvent } from '../../lib/types'

const thisMonth = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** A project's tasks by due date, one month at a time. */
export function TaskCalendar({ events, onOpen }: { events: CalendarEvent[]; onOpen: (taskId: string) => void }) {
  const [month, setMonth] = useState(thisMonth)
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const undated = events.length === 0

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3>{label}</h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="!h-8 !rounded-lg !px-2.5"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          >
            <Icon name="chevronLeft" size={15} />
            <span className="sr-only">Previous month</span>
          </Button>
          <Button variant="ghost" size="sm" className="!h-8 !rounded-lg !px-3" onClick={() => setMonth(thisMonth())}>
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="!h-8 !rounded-lg !px-2.5"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          >
            <Icon name="chevronRight" size={15} />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
      </div>
      {undated && (
        <p className="mb-3 text-[12px] text-faint">No task here has a due date yet. Give one a due date and it shows on its day.</p>
      )}
      <MonthGrid
        month={month}
        events={events}
        weeks={[]}
        showSyllabus={false}
        onOpen={(e) => {
          if (e.task_id) onOpen(e.task_id)
        }}
      />
    </section>
  )
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: errors only where `'summary'` is still passed as a `TaskView`, in `TasksTab.tsx`, `useProjectTasks.ts`, `StudentTasksView.tsx` and `ProfessorTasksView.tsx`. Tasks 6 and 9 fix those. Note them and do not fix them here.

- [ ] **Step 6: Commit**

```bash
git add src/components/work src/components/tasks/TaskViewSwitch.tsx
git commit -m "Add the Work sub-nav, a props-driven timeline and a task calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Work space tab id (`navigation.ts`)

**Files:**
- Modify: `src/lib/general/navigation.ts:3-11`
- Test: `src/lib/general/navigation.test.ts`

**Interfaces:**
- Produces: `GeneralTabId = 'overview' | 'discussion' | 'work' | 'files' | 'shared' | 'members'`. `generalTab()` maps `tasks`/`progress` → `work`, and `?task=` → `work`.

- [ ] **Step 1: Update the tests first**

In `src/lib/general/navigation.test.ts`, change `.toBe('tasks')` in "lets a task deep link override tab" to `.toBe('work')`, and add:

```ts
  it('sends the old Tasks and Progress tabs to Work', () => {
    expect(generalTab(new URLSearchParams('tab=tasks'))).toBe('work')
    expect(generalTab(new URLSearchParams('tab=progress'))).toBe('work')
    expect(generalTab(new URLSearchParams('tab=work'))).toBe('work')
  })
```

Run: `npx vitest run src/lib/general/navigation.test.ts`
Expected: FAIL (`'tasks'` returned instead of `'work'`).

- [ ] **Step 2: Implement**

```ts
export type GeneralTabId = 'overview' | 'discussion' | 'work' | 'files' | 'shared' | 'members'

const TABS = new Set<GeneralTabId>(['overview', 'discussion', 'work', 'files', 'shared', 'members'])

/** Work replaced two tabs; links written before it still name them. */
const LEGACY: Record<string, GeneralTabId> = { tasks: 'work', progress: 'work' }

export function generalTab(params: URLSearchParams): GeneralTabId {
  if (params.has('task')) return 'work'
  const raw = params.get('tab') ?? ''
  const value = (LEGACY[raw] ?? raw) as GeneralTabId
  return TABS.has(value) ? value : 'overview'
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/lib/general/navigation.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit** (`GeneralProject.tsx` stays broken until Task 6, so commit the two together. Skip this commit and continue to Task 6.)

---

### Task 6: Work tab in work projects

**Files:**
- Create: `src/components/general/WorkTab.tsx`
- Create: `src/components/general/WorkSummary.tsx`
- Modify: `src/components/general/TasksTab.tsx`
- Modify: `src/pages/general/GeneralProject.tsx`
- Modify: `src/components/general/SinceLastVisit.tsx:65-87`
- Delete: `src/components/general/ProgressTab.tsx`, `src/components/general/GanttChart.tsx`

**Interfaces:**
- Consumes: `workSection`, `taskLayout`, `withWork` (Task 1). `WorkNav`, `TimelineView`, `TaskCalendar` (Task 4). `taskCalendarEvents` (Task 3). `GeneralProjectState` (`useGeneralProject.ts`). `TaskDialog({ state, taskId, onClose })`. `ForecastPanel({ state })`. `PressurePanel({ state, onOpen })`.
- Produces: `WorkTab({ state })`, `WorkSummary({ state, onOpenTask })`, and `TasksTab({ state, layout, onLayout, onOpenTask })`

- [ ] **Step 1: Create `WorkSummary.tsx`**

Cut `function WorkTaskSummary` (and the `DAY` constant) out of `TasksTab.tsx` and paste it into this file unchanged. Then add the exported component, which takes over the old ProgressTab's sections:

```tsx
// src/components/general/WorkSummary.tsx
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { SummaryTile, StatusDonut } from '../tasks/TaskSummary'
import { useNow } from '../../hooks/useNow'
import { dateRange, isOverdue } from '../../lib/general/dates'
import { projectProgress } from '../../lib/general/progress'
import type { GeneralTask } from '../../lib/general/types'
import { formatMinutes } from '../../lib/types'
import { ForecastPanel } from './ForecastPanel'
import { PressurePanel } from './PressurePanel'
import type { GeneralProjectState } from './useGeneralProject'

const DAY = 86_400_000

/**
 * How the project is going, in the order somebody asks: how far, what moved
 * this week, who carries it, will it finish, what is late. It took in the old
 * Progress tab; the timeline went to Tasks › Timeline.
 */
export function WorkSummary({ state, onOpenTask }: { state: GeneralProjectState; onOpenTask: (id: string) => void }) {
  const project = state.project
  if (!project) return null
  const progress = projectProgress(state.tasks)

  return (
    <div className="space-y-6">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Where we are</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-[32px] leading-none font-bold text-ink">{progress.pct}%</span>
          <span className="text-[13px] text-muted">
            {progress.done} of {progress.total} tasks done
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full surface-sunken">
          <span className="block h-full rounded-full bg-progress" style={{ width: `${Math.min(100, progress.pct)}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-faint">{dateRange(project.starts_on, project.ends_on)}</p>
      </section>

      {state.tasks.length > 0 && <WorkTaskSummary tasks={state.tasks} state={state} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Will we finish in time</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">The pace so far, carried forward. Counting, not a promise.</p>
          <ForecastPanel state={state} />
        </section>
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Late, and landing next</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">The part of this page you can still act on.</p>
          <PressurePanel state={state} onOpen={onOpenTask} />
        </section>
      </div>
    </div>
  )
}

// ↓ paste `function WorkTaskSummary(...) { ... }` here, unchanged
```

- [ ] **Step 2: Trim `TasksTab.tsx` to the Tasks section**

In `src/components/general/TasksTab.tsx`:
1. Remove the imports `SummaryTile, StatusDonut`, `useNow`, `TaskDialog`, `useSearchParams`, and the `DAY` constant. Keep `Avatar`, which `Holders` uses.
2. Add these imports:

```tsx
import { TaskCalendar } from '../work/TaskCalendar'
import { TimelineView } from '../work/TimelineView'
import { taskCalendarEvents } from '../../lib/work/calendar'
import type { TaskLayout } from '../../lib/work/nav'
```

3. Replace the signature and the `params` / `view` / `openTask` / `showTask` lines:

```tsx
/**
 * A work project's tasks: Board, List, Timeline and Calendar over the same
 * filtered set. Summary lives beside it in Work (WorkSummary.tsx).
 */
export function TasksTab({
  state,
  layout,
  onLayout,
  onOpenTask,
}: {
  state: GeneralProjectState
  layout: TaskLayout
  onLayout: (l: TaskLayout) => void
  onOpenTask: (id: string | null) => void
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  // …team, assignee, status, creating, fromNotes state unchanged…
  const showTask = onOpenTask
```

4. Change `<TaskViewSwitch view={view} onView={setView} ... />` to `<TaskViewSwitch view={layout} onView={onLayout} ... />`.
5. Delete the `{view !== 'summary' && (` wrapper around the progress/buttons row, so the row always shows. Keep its inner `<div>`.
6. Replace the render chain from `) : view === 'summary' ? (` through the closing `<TaskTable ... />` branch with:

```tsx
      ) : layout === 'board' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* …the existing TASK_STATUSES.map(...) column markup, unchanged… */}
        </div>
      ) : layout === 'list' ? (
        <TaskTable tasks={shown} state={state} onOpen={showTask} mayMove={mayMove} onMove={move} />
      ) : layout === 'timeline' ? (
        <TimelineView
          tasks={shown.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            starts_at: t.starts_at,
            due_at: t.due_at,
            group_id: t.team_id,
          }))}
          groups={state.teams}
          span={project}
          onOpen={showTask}
        />
      ) : (
        <TaskCalendar
          events={taskCalendarEvents(shown, (t) => state.teams.find((x) => x.id === t.team_id)?.name ?? '')}
          onOpen={showTask}
        />
      )}
```

7. Delete the `<TaskDialog ... />` line. WorkTab renders it now.
8. Delete the moved `WorkTaskSummary` function.

- [ ] **Step 3: Create `WorkTab.tsx`**

```tsx
// src/components/general/WorkTab.tsx
import { useSearchParams } from 'react-router-dom'
import { WorkNav } from '../work/WorkNav'
import { taskLayout, withWork, workSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A work project's Work tab: Summary and Tasks for now; Backlog, Sprints and
 * Milestones join in later parts. The open task is one dialog for every
 * section, so a task opened from Summary's late list opens in place.
 */
export function WorkTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const section = workSection(params, 'tasks')
  const layout = taskLayout(params)

  const showTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  return (
    <div className="space-y-5">
      <WorkNav active={section} onChange={(s) => setParams(withWork(params, { section: s }))} />
      {section === 'summary' ? (
        <WorkSummary state={state} onOpenTask={showTask} />
      ) : (
        <TasksTab
          state={state}
          layout={layout}
          onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
          onOpenTask={showTask}
        />
      )}
      <TaskDialog state={state} taskId={params.get('task')} onClose={() => showTask(null)} />
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `GeneralProject.tsx`**

1. Replace the imports of `ProgressTab` and `TasksTab` with `import { WorkTab } from '../../components/general/WorkTab'`.
2. Replace `changeTab`:

```tsx
  function changeTab(next: GeneralTabId) {
    const changed = new URLSearchParams(params)
    if (next === 'overview') changed.delete('tab')
    else changed.set('tab', next)
    // Work's own place (section, layout, open task) means nothing on another tab.
    if (next !== 'work') {
      changed.delete('task')
      changed.delete('work')
      changed.delete('layout')
    }
    setParams(changed)
  }
```

3. In the tab list, replace the `tasks` entry with `{ id: 'work', label: 'Work', icon: 'kanban', count: state.tasks.length },` and delete the `progress` entry.
4. Replace `{tab === 'tasks' && <TasksTab state={state} />}` with `{tab === 'work' && <WorkTab state={state} />}`, and delete the `progress` line.

- [ ] **Step 5: Update the "since last visit" links**

In `src/components/general/SinceLastVisit.tsx`:
- Replace every `?tab=tasks` with `?tab=work`.
- Replace `` `${base}?tab=progress` `` with `` `${base}?tab=work&work=summary` ``.

```bash
sed -i 's/?tab=tasks/?tab=work/g; s/?tab=progress/?tab=work\&work=summary/g' src/components/general/SinceLastVisit.tsx
```

- [ ] **Step 6: Delete the folded files**

```bash
git rm src/components/general/ProgressTab.tsx src/components/general/GanttChart.tsx
```

- [ ] **Step 7: Build, lint, test**

Run: `npx tsc -b`
Expected: errors remain only in the class files (`useProjectTasks.ts`, `StudentTasksView.tsx`, `ProfessorTasksView.tsx`), fixed in Task 9. None remain under `src/components/general` or `src/pages/general`.

Run: `npx vitest run src/lib`
Expected: PASS.

Run: `npx eslint src/components/general src/pages/general src/components/work src/lib/work`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib/general/navigation.ts src/lib/general/navigation.test.ts src/components/general src/pages/general
git commit -m "Rename a work project's Tasks tab to Work, with Summary and four task layouts

The Progress tab folds in: its timeline is Tasks › Timeline, and where we are,
the forecast and late work open Summary. Old ?tab=tasks and ?tab=progress
links land on Work.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Class tasks get a planned start (`supabase/class-schedule.sql`)

**Files:**
- Create: `supabase/class-schedule.sql`
- Create: `supabase/tests/class-schedule.test.sql`
- Modify: `docs/07-backup.md:26` (append ` supabase/class-schedule.sql` to the end of the run list)

**Interfaces:**
- Produces: column `public.project_tasks.starts_at timestamptz` (nullable). Constraint `project_tasks_start_before_due`. `task_detail_overview` exposes `starts_at`. `guard_task_edit` freezes `starts_at` once a task is started.

- [ ] **Step 1: Write the test first**

```sql
-- supabase/tests/class-schedule.test.sql
-- A class task's planned start. Rolls back; nothing here survives.
--
--   node scripts/db.mjs supabase/tests/class-schedule.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  t1 uuid;
  ts timestamptz := now() + interval '1 day';
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-schedule-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Schedule group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-schedule-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '14 days', now() - interval '1 day')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  -- A student adds a task, planned to start tomorrow and due in a week.
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by, starts_at, due_at)
  values (v_board, 'Plan the schema', 10, v_a, ts, ts + interval '6 days') returning id into t1;
  perform pg_temp.must_be('a student can set a planned start',
    (select starts_at from public.project_tasks where id = t1) = ts);

  perform pg_temp.must_be('the detail view carries the planned start',
    (select starts_at from public.task_detail_overview where id = t1) = ts);

  update public.project_tasks set starts_at = ts + interval '1 day' where id = t1;
  perform pg_temp.must_be('a to-do task can move its start',
    (select starts_at from public.project_tasks where id = t1) = ts + interval '1 day');

  refused := false;
  begin
    update public.project_tasks set starts_at = ts + interval '30 days' where id = t1;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('a start after the due date is refused', refused);

  -- Claim it and start it; then the start is frozen like the due date.
  insert into public.task_assignees (task_id, student_id) values (t1, v_a);
  update public.project_tasks set status = 'in_progress' where id = t1;
  refused := false;
  begin
    update public.project_tasks set starts_at = ts where id = t1;
  exception when others then refused := true;
  end;
  perform pg_temp.must_be('a started task cannot move its planned start', refused);

  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/db.mjs supabase/tests/class-schedule.test.sql`
Expected: ERROR `column "starts_at" of relation "project_tasks" does not exist`.

- [ ] **Step 3: Write `supabase/class-schedule.sql`**

The view body is copied verbatim from `supabase/deadline-lock.sql:366-381`. The guard function is copied verbatim from the live definition (`task-archive.sql`), with `starts_at` added to the frozen list.

```sql
-- Collabify — a class task's planned start, for the Work tab's Timeline.
--
--   node scripts/db.mjs supabase/class-schedule.sql
--
-- `started_at` (tasks.sql) is when somebody actually pressed Start. This is
-- when the task is meant to begin, the class twin of general_tasks.starts_at
-- (general-schedule.sql). With both dates a task draws a bar on the timeline.
--
-- Redefines two things other files own, and must run after them:
--   * task_detail_overview (deadline-lock.sql): it is `select t.*`, and a
--     view's star is frozen when the view is created, so it is recreated to
--     pick the new column up. Same body.
--   * guard_task_edit (task-archive.sql, the live copy): verbatim, with
--     starts_at added to the columns a started task can no longer change.
-- Re-running either owner file afterwards drops starts_at from the freeze, so
-- re-run this file after them (docs/07-backup.md lists it last).
--
-- Idempotent. Safe to re-run.

begin;

alter table public.project_tasks
  add column if not exists starts_at timestamptz;

comment on column public.project_tasks.starts_at is
  'When the task is planned to begin. Not when it was started (started_at).';

do $$ begin
  alter table public.project_tasks
    add constraint project_tasks_start_before_due
    check (starts_at is null or due_at is null or starts_at <= due_at);
exception when duplicate_object then null; end $$;

drop view if exists public.task_detail_overview;

create view public.task_detail_overview
with (security_invoker = true) as
select t.*,
       b.project_id,
       b.group_id,
       (select count(*) from public.task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.task_files f where f.task_id = t.id)::int
         as file_count,
       (select coalesce(sum(w.minutes), 0) from public.task_worklog w where w.task_id = t.id)::int
         as logged_minutes,
       p.first_name || ' ' || p.last_name as creator_name
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
  left join public.profiles p on p.id = t.created_by;

grant select on public.task_detail_overview to authenticated;

create or replace function public.guard_task_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable boolean;
  -- coalesce: an unset setting reads as NULL, and `not NULL` would skip the pin.
  archiving boolean := coalesce(current_setting('collabify.task_archive_op', true), '') = 'on';
begin
  if auth.uid() is null or public.is_board_professor(old.board_id) then
    -- Service role, or the professor: only the immutable columns are pinned.
    new.board_id   := old.board_id;
    new.created_at := old.created_at;
    new.late       := old.late;

    -- created_by is immutable except when its author is being deleted
    -- (on delete set null); see task-archive.sql for the full story.
    if new.created_by is not null
       or old.created_by is null
       or exists (select 1 from public.profiles p where p.id = old.created_by) then
      new.created_by := old.created_by;
    end if;

    if not archiving then
      new.archived_at := old.archived_at;
      if new.archived_by is not null
         or old.archived_by is null
         or exists (select 1 from public.profiles p where p.id = old.archived_by) then
        new.archived_by := old.archived_by;
      end if;
    end if;

    return new;
  end if;

  if not public.is_board_member(old.board_id) then
    raise exception 'Only this board can change its tasks';
  end if;

  if public.board_project_locked(old.board_id) then
    raise exception
      'This project is closed, so its tasks can no longer change. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  if public.board_submitted(old.board_id) then
    raise exception
      'This project has been handed in, so its tasks can no longer change. Take the submission back first if something still needs doing.'
      using errcode = 'check_violation';
  end if;

  if old.archived_at is not null and not archiving then
    raise exception 'This task is archived. Restore it from Archived tasks on My tasks first.'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status
     and not public.is_task_assignee(old.id) then
    raise exception
      'Only the people on this task can move it. Claim it first.'
      using errcode = 'check_violation';
  end if;

  editable := old.status = 'todo';

  if not editable and (
       new.title     is distinct from old.title
    or new.details   is distinct from old.details
    or new.weight    is distinct from old.weight
    or new.due_at    is distinct from old.due_at
    or new.starts_at is distinct from old.starts_at
    or new.position  is distinct from old.position
  ) then
    raise exception 'This task has already been started, so it can no longer be edited';
  end if;

  new.board_id    := old.board_id;
  new.origin_id   := old.origin_id;
  new.created_by  := old.created_by;
  new.author_role := old.author_role;
  new.created_at  := old.created_at;
  new.late        := old.late;
  if not archiving then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

commit;
```

Before applying it, diff the guard against the live definition to make sure nothing has drifted:

Run: `node scripts/db.mjs -c "select pg_get_functiondef('public.guard_task_edit'::regproc)"`
Expected: the same statements as above, minus the `starts_at` line and with the longer `created_by` comment. If any other line differs, copy the live line in instead.

- [ ] **Step 4: Apply it twice (idempotent), then run the tests**

Run: `node scripts/db.mjs supabase/class-schedule.sql && node scripts/db.mjs supabase/class-schedule.sql`
Expected: `Done.` twice.

Run: `node scripts/db.mjs supabase/tests/class-schedule.test.sql`
Expected: 5 × `PASS`.

Run: `node scripts/db.mjs supabase/tests/deadline-lock.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS, no FAIL. The guard still behaves for lock and hand-in.

- [ ] **Step 5: Add the file to the run list**

In `docs/07-backup.md` line 26, append ` supabase/class-schedule.sql` after `supabase/discussion-edit-delete.sql`.

- [ ] **Step 6: Commit**

```bash
git add supabase/class-schedule.sql supabase/tests/class-schedule.test.sql docs/07-backup.md
git commit -m "Give class tasks a planned start, frozen once the task is started

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Planned start in the class task form

**Files:**
- Modify: `src/lib/types.ts:816-837` (`ProjectTask`)
- Modify: `src/lib/api/tasks.ts:288-339` (`TaskInput`, `addTask`, `updateTask`)
- Modify: `src/components/tasks/TaskForm.tsx`
- Modify: `src/components/tasks/TaskBoard.tsx` (where `<TaskForm` is rendered)

**Interfaces:**
- Produces: `ProjectTask.starts_at: string | null`. `TaskInput.startsAt?: string | null`. `TaskForm` prop `showStart?: boolean`.

- [ ] **Step 1: Type and API**

In `src/lib/types.ts`, add `starts_at: string | null` after `due_at` in `ProjectTask`, with the comment `/** When it is planned to begin; started_at is when it actually did. */`.

In `src/lib/api/tasks.ts`:

```ts
export type TaskInput = {
  title: string
  details: string
  weight: number
  dueAt: string | null
  /** Students' own tasks only; a professor's set task has no planned start yet. */
  startsAt?: string | null
}
```

In `addTask`'s insert object, add `starts_at: input.startsAt ?? null,`. In `updateTask`'s update object, add `...(input.startsAt !== undefined && { starts_at: input.startsAt }),`.

- [ ] **Step 2: The form field**

In `src/components/tasks/TaskForm.tsx`:
1. Widen `defaults` to `Pick<ProjectTask, 'title' | 'details' | 'weight' | 'due_at'> & { starts_at?: string | null }` and add the prop `showStart = false` (type `showStart?: boolean`, comment `/** Students' board only. */`).
2. Add state `const [startsAt, setStartsAt] = useState(toLocalInput(defaults?.starts_at ?? null))`.
3. In `submit`, after the title check:

```ts
    const startIso = showStart && startsAt ? new Date(startsAt).toISOString() : null
    const dueIso = dueAt ? new Date(dueAt).toISOString() : null
    if (startIso && dueIso && startIso > dueIso)
      return setInvalid('A task cannot start after it is due. Move one of the two dates.')
    setInvalid(null)
    onSubmit({
      title,
      details,
      weight,
      dueAt: dueIso,
      ...(showStart && { startsAt: startIso }),
    })
```

(Remove the old `setInvalid(null)` and `onSubmit({...})` that this replaces.)

4. Change the grid `<div className="grid gap-4 sm:grid-cols-2">` to `` <div className={`grid gap-4 ${showStart ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}> `` and add, before the Due field:

```tsx
        {showStart && (
          <Field label="Starts" optional>
            {(id) => (
              <Input id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            )}
          </Field>
        )}
```

- [ ] **Step 3: The student board passes it**

In `src/components/tasks/TaskBoard.tsx`, find the `<TaskForm` element and add `showStart`. `FanOutForm` stays without it.

- [ ] **Step 4: Type-check and fix fixtures**

Run: `npx tsc -b`
Expected: the only errors are object literals typed `ProjectTask` that lack `starts_at` (in tests or fixtures, if any), plus the Task 9 class errors. Add `starts_at: null` to each literal reported. Then:

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/api/tasks.ts src/components/tasks/TaskForm.tsx src/components/tasks/TaskBoard.tsx
git add -u src
git commit -m "Let students give their own tasks a planned start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Work tab in class projects

**Files:**
- Create: `src/components/tasks/classTimeline.ts`
- Modify: `src/components/tasks/useProjectTasks.ts`
- Modify: `src/components/tasks/ProjectTasksTab.tsx`
- Modify: `src/components/tasks/StudentTasksView.tsx`
- Modify: `src/components/tasks/ProfessorTasksView.tsx`
- Modify: `src/pages/app/projects/ProjectDetail.tsx`
- Modify: `src/components/classes/AnnouncementLinks.tsx:183`, `src/components/groups/GroupWork.tsx:180`, `src/pages/app/reassignments/Reassignments.tsx:196`, `src/pages/app/submissions/Submissions.tsx:532`, `src/pages/app/Trash.tsx:62`
- Delete: `src/components/tasks/ProgressTab.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 and 8. `ProjectTaskRow` (`lib/api/tasks.ts`: `ProjectTask` plus `group_id`, `group_name`, counts). `boardOwnerName(board)` (`lib/types.ts`). `BoardProgress({ board })`. `MemberProgress({ rows, viewerId?, title, dense? })`. `TaskSummary({ rows, showLoad? })`.
- Produces: `useProjectTasks` returns `section: WorkSection`, `setSection(s)`, `view: TaskLayout`, `setView(l)` (replacing the old `view` state). Also `classTimelineTasks(rows, byBoard): TimelineTask[]`.

- [ ] **Step 1: `classTimeline.ts`**

```ts
// src/components/tasks/classTimeline.ts
import type { ProjectTaskRow } from '../../lib/api/tasks'
import type { TimelineTask } from '../../lib/work/timeline'

/**
 * Class rows as timeline tasks. A professor looking across every board wants a
 * row per board, so the board is the group; anyone looking at one board wants
 * a single row.
 */
export function classTimelineTasks(rows: readonly ProjectTaskRow[], byBoard: boolean): TimelineTask[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    starts_at: r.starts_at,
    due_at: r.due_at,
    group_id: byBoard ? r.board_id : null,
  }))
}
```

- [ ] **Step 2: URL-backed section and layout in `useProjectTasks.ts`**

1. Add the imports `import { taskLayout, withWork, workSection } from '../../lib/work/nav'` and `import type { TaskLayout, WorkSection } from '../../lib/work/nav'`.
2. Delete the `const [view, setView] = useState<'summary' | 'board' | 'list'>(...)` lines.
3. After `const openTask = params.get('task')`, add:

```ts
  // Where you are inside Work lives in the address, so Submissions' and
  // Reassignments' links (?tab=tasks&board=… / &task=…) land on Tasks.
  const section = workSection(params, isProfessor ? 'summary' : 'tasks')
  const view = taskLayout(params)
  const setSection = useCallback(
    (s: WorkSection) => setParams(withWork(params, { section: s })),
    [params, setParams],
  )
  const setView = useCallback(
    (l: TaskLayout) => setParams(withWork(params, { layout: l }), { replace: true }),
    [params, setParams],
  )
```

4. Add `section, setSection,` to the returned object next to `view, setView,`.

- [ ] **Step 3: `ProjectTasksTab.tsx` renders the sub-nav**

Add `import { WorkNav } from '../work/WorkNav'`. Replace the final `return t.isProfessor ? (...) : (...)` with:

```tsx
  return (
    <div className="space-y-5">
      <WorkNav active={t.section} onChange={t.setSection} />
      {t.isProfessor ? (
        <ProfessorTasksView project={project} role={role} viewerId={viewerId} t={t} />
      ) : (
        <StudentTasksView project={project} role={role} viewerId={viewerId} t={t} />
      )}
    </div>
  )
```

Update the file comment: "Work inside one project: Summary and Tasks." Change "shares it with Files, Progress and the hand-in" to "shares it with Files and the hand-in".

- [ ] **Step 4: `StudentTasksView.tsx` — Summary and four layouts**

1. Add these imports:

```tsx
import { BoardProgress } from './BoardProgress'
import { MemberProgress } from './MemberProgress'
import { classTimelineTasks } from './classTimeline'
import { TaskCalendar } from '../work/TaskCalendar'
import { NO_SPAN, TimelineView } from '../work/TimelineView'
import { taskCalendarEvents } from '../../lib/work/calendar'
```

2. Inside the loaded branch (the `<>` after `t.boardLoading ? ... : (`), wrap the existing content like this:

```tsx
        <>
          {t.section === 'summary' ? (
            <div className="space-y-4">
              <BoardProgress board={active} />
              <MemberProgress
                rows={t.progress}
                viewerId={viewerId}
                title={active.group_id ? 'Your group' : 'Your progress'}
              />
              <TaskSummary rows={t.scope} />
            </div>
          ) : (
            <>
              {/* …existing drafting buttons, TaskViewSwitch, TaskFilterBar… */}
              {/* delete: {t.view === 'summary' && <TaskSummary rows={t.shown} />} */}
              {/* …existing list and board branches… */}
              {t.view === 'timeline' && (
                <TimelineView
                  tasks={classTimelineTasks(t.shown, false)}
                  groups={[]}
                  span={NO_SPAN}
                  looseLabel={active.group_id ? 'Your group' : 'Your tasks'}
                  onOpen={t.showTask}
                />
              )}
              {t.view === 'calendar' && (
                <TaskCalendar events={taskCalendarEvents(t.shown)} onOpen={t.showTask} />
              )}
            </>
          )}
          {(t.section === 'summary' || t.view !== 'board') && (
            <TaskDetailModal /* …existing props, unchanged… */ />
          )}
        </>
```

The existing `{t.view !== 'board' && (<TaskDetailModal .../>)}` becomes the guarded one shown last. Keep its props.

- [ ] **Step 5: `ProfessorTasksView.tsx` — split by section**

1. Add the same imports as in Step 4, minus `BoardProgress` and `MemberProgress` (already imported), plus `boardOwnerName` (already imported).
2. Add a helper inside the component:

```tsx
  /** From Summary, opening a group means going to its tasks. */
  const openBoard = (boardId: string) => {
    t.showBoard(boardId)
    t.setSection('tasks')
  }
```

3. Wrap sections 1 and 2 (`HandInQueue` and the Groups `<section>`) in `{t.section === 'summary' && (<> … </>)}` and change:
   - `HandInQueue` `onOpen={(b) => openBoard(b.id)}`
   - `GroupProgressTable` `onOpen={(b) => openBoard(b.id)}`
   - the Groups intro copy to `Open {solo ? 'a student' : 'a group'} to see its tasks and answer its work.`

   After the Groups section, still inside the summary fragment, add:

```tsx
          <section className="space-y-3 border-t border-line pt-6">
            <div>
              <h3>Every {who}</h3>
              <p className="mt-0.5 text-[13px] text-muted">All tasks across the project, by stage, and who carries them.</p>
            </div>
            <TaskSummary rows={t.scope} showLoad />
          </section>
```

4. Wrap sections 3 and 4 (the work and "What you set") in `{t.section === 'tasks' && (<> … </>)}`. In section 3:
   - Change its class from `space-y-4 border-t border-line pt-6` to `space-y-4`.
   - Delete `{t.view === 'summary' && <TaskSummary rows={t.shown} showLoad={!active} />}`.
   - Change the board-needs-a-group message to: `A board belongs to one {who}. Choose one in the filter above, or switch to the list, timeline or calendar to see every {who} at once.`
   - After the board branch, add:

```tsx
          {t.view === 'timeline' && (
            <TimelineView
              tasks={classTimelineTasks(t.shown, !active)}
              groups={active ? [] : (boards ?? []).map((b) => ({ id: b.id, name: boardOwnerName(b) }))}
              span={NO_SPAN}
              looseLabel={active ? boardOwnerName(active) : 'Unknown board'}
              onOpen={t.showTask}
            />
          )}
          {t.view === 'calendar' && (
            <TaskCalendar
              events={taskCalendarEvents(t.shown, active ? undefined : t.ownerFor)}
              onOpen={t.showTask}
            />
          )}
```

5. Move `<TaskDetailModal … />` out of section 3 so it sits just above `<GenerateTasksModal`. That way it renders in both sections, and a task opened from Summary still opens. Keep its props.

- [ ] **Step 6: `ProjectDetail.tsx` — tab id `work`, label "Work", no Progress tab**

1. `type TabId = 'brief' | 'discussion' | 'work' | 'groups' | 'files' | 'shared'` and `const LINKED_TABS: TabId[] = ['discussion', 'work', 'groups', 'files', 'shared']`.
2. The initial-tab reader:

```tsx
  const [tab, setTab] = useState<TabId>(() => {
    const raw = params.get('tab')
    // Work replaced Tasks and Progress; links written before it still name them.
    if (raw === 'tasks' || raw === 'progress') return 'work'
    const named = raw as TabId | null
    if (named && LINKED_TABS.includes(named)) return named
    return params.has('board') || params.has('task') ? 'work' : 'brief'
  })
```

3. Replace the tasks entry in `tabs` (and its comment about Boards/Students) with:

```tsx
            // Planning, progress and the boards themselves, for both roles.
            { id: 'work', label: 'Work', icon: 'kanban' },
```

4. Delete `{ id: 'progress' as const, label: 'Progress', icon: 'chart' as const },` from the student list.
5. Replace `{tab === 'tasks' && (` with `{tab === 'work' && (`. Delete the `{tab === 'progress' && role === 'student' && (...)}` block and the `ProgressTab` import.
6. Run `grep -n "'tasks'\|'progress'\|ProgressTab" src/pages/app/projects/ProjectDetail.tsx` and change any remaining `setTab('tasks')` to `setTab('work')`. Expected afterwards: no matches.

- [ ] **Step 7: Old links → `tab=work`, delete the class Progress tab**

```bash
sed -i 's/?tab=tasks/?tab=work/g' src/components/classes/AnnouncementLinks.tsx src/components/groups/GroupWork.tsx src/pages/app/reassignments/Reassignments.tsx src/pages/app/submissions/Submissions.tsx src/pages/app/Trash.tsx
git rm src/components/tasks/ProgressTab.tsx
grep -rn "tab=tasks\|tab=progress" src
```

Expected: the final grep prints nothing.

- [ ] **Step 8: Full build, lint, tests**

Run: `npm run build`
Expected: `tsc -b` clean, and Vite builds.

Run: `npx eslint src`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS. That is the earlier count (614) plus the new nav, calendar and timeline tests.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "Rename a class project's Tasks tab to Work, with Summary and four task layouts

Students' Progress tab folds into Summary. Professors get the hand-in queue,
groups and every task on Summary, and a group's board on Tasks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verify in the browser, write the handoff, push

**Files:**
- Modify: `handoff.md` (append a section at the end)

- [ ] **Step 1: Run the app**

Start the dev server with `preview_start` (name from `.claude/launch.json`). If a step needs a signed-in account the session does not have, ask the user to sign in and wait.

- [ ] **Step 2: Work project checks** (`/projects/<id>`)
- The tab reads **Work**, and there is no Progress tab.
- `?tab=progress` lands on Work › Summary, and `?tab=tasks` lands on Work › Tasks.
- Summary shows Where we are, the tiles/donut/load, the forecast and the late list. Clicking a late task opens the task dialog.
- Tasks › Board, List, Timeline (bars, diamonds, today line, team rows, title opens the task) and Calendar (month nav; chip opens the task). Reloading keeps the section and layout.
- Switching to Files and back drops `work`/`layout`, and Files `?view=draft` still works.
- `read_console_messages` shows no errors.

- [ ] **Step 3: Class project checks** (`/class-projects/<id>`), as a student and as a professor
- Student: Work › Summary shows board progress, the member share and the task summary. Tasks has four layouts. Adding a task shows a Starts field; a start after the due date shows "A task cannot start after it is due…". A dated task draws a bar on the Timeline.
- Professor: Summary shows the hand-in queue, groups and every task. Opening a group goes to Tasks with that board chosen. With no group chosen, Timeline has a row per group. The set-task form has no Starts field.
- A link from Submissions (`?tab=tasks&board=…`) opens Work › Tasks on that board.

- [ ] **Step 4: Layout checks**
- `resize_window` mobile (375×812): the sub-nav and layout switch scroll sideways inside themselves, with no page sideways scroll. The Timeline scrolls inside its card. The Calendar shows dots and opens the day underneath.
- Dark mode: the active nav pill is readable, and bars and chips use tokens.
- Take screenshots of Summary and Timeline as proof.

- [ ] **Step 5: Append to `handoff.md`**

```markdown
**Change (2026-10-0X): the Tasks tab is Work, with Summary and four task layouts.** Part 1 of 4
of the Work tab plan (docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md).
- Both project pages: the tab is **Work** (`?tab=work`), with a sub-nav (`?work=summary|tasks`)
  and task layouts (`?layout=board|list|timeline|calendar`), parsed by `lib/work/nav.ts`.
  `?tab=tasks` → Work › Tasks, `?tab=progress` → Work › Summary; old links keep working.
- The Progress tab is gone. Work projects: where we are, forecast and late work are on Summary;
  the timeline is Tasks › Timeline. Class students: board progress and shares are on Summary.
  Professors: Summary = hand-in queue, groups, every task; opening a group goes to Tasks.
- Shared: `lib/work/timeline.ts` (moved from lib/general, team_id → group_id),
  `lib/work/calendar.ts`, `components/work/{WorkNav,TimelineView,TaskCalendar}.tsx`.
- SQL `class-schedule.sql` (applied live): `project_tasks.starts_at`, start ≤ due, frozen once
  started; `task_detail_overview` recreated; `guard_task_edit` redefined (run it after
  task-archive.sql). Students' task form has Starts; a professor's set task does not yet.
- Checked: class-schedule test 5 PASS, deadline-lock, rls-coverage, anon-lockdown; build,
  eslint, Vitest N; browser checks listed in the plan, 375 wide, dark mode.
- Next: Part 2, Backlog + Sprints.
```

Fill in the date and the Vitest count from the actual run.

- [ ] **Step 6: Commit and push**

```bash
git add handoff.md
git commit -m "Hand off Work tab part 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

## Self-review notes

- Spec coverage for Part 1: rename (Tasks 5, 6, 9), sub-nav shell (Tasks 1, 4, 6, 9), Board/List under Tasks (Tasks 6, 9), Timeline and Calendar in both spaces (Tasks 2–4, 6, 9), class `starts_at` (Tasks 7, 8), Progress folded (Tasks 6, 9), legacy links (Tasks 1, 5, 6, 9), verification and handoff (Task 10).
- Out of scope here, coming in later parts: scope picker, sprint bands, milestone diamonds, a Starts field on professor set tasks, "Needs you" cards.
