# Work tab Part 4: Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work › Summary opens on what matters now: the running sprint, the next milestone, and what needs the viewer; professors get a groups × milestones grid.

**Architecture:** Pure functions in `src/lib/work/summary.ts` (tested with Vitest) feed shared cards in `src/components/work/`. The work space and the class student view render one shared `WorkGlance` at the top of their existing Summary; the class professor view renders `GroupMilestoneGrid` under its Groups table. No SQL: everything reads data Parts 2 and 3 already load.

**Tech Stack:** React 19 + TypeScript + Vite, Tailwind design tokens, Vitest.

Spec: `docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md` (Pages › Summary; Rollout item 4).

## Global Constraints

- Summary (both): running sprint card (goal, days left, done/total, small burndown by task count), next milestone card (date, progress, at risk if behind), "Needs you" list (your tasks due soon, overdue, nobody on it), then the existing tiles + donut + who is carrying what, then forecast and late/landing-next (work space).
- Professor (class): hand-in queue + group progress table + a groups × milestones grid. Sprints are per group, so the professor Summary has no sprint card.
- Colours from tokens only: done `success-*`, needs attention `warning-*`, late `danger-*`, not started `pending-soft` / `pending-ink`. Never `emerald-*`, `red-*`, or brand amber for a status. No raw hex.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Desktop layout first, then tablet, then phone; 375 px wide must not scroll sideways (the grid scrolls inside its own box).
- `npm run build` (tsc first) must pass before claiming anything works. `npx eslint` on touched files clean. `npx vitest run` green.
- Commit messages: repo style (plain sentence, no conventional-commit prefix), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Summary logic

**Files:**
- Create: `src/lib/work/summary.ts`
- Test: `src/lib/work/summary.test.ts`

**Interfaces:**
- Consumes: `milestoneProgress`, `milestoneStatus`, `sortMilestones`, `MilestoneStatus` from `src/lib/work/milestones.ts`; `Milestone`, `MilestoneGroup`, `WorkItem` from `src/lib/work/types.ts`.
- Produces:
  - `DUE_SOON_DAYS = 7`
  - `type NeedsYou = { overdue: WorkItem[]; dueSoon: WorkItem[]; unheld: WorkItem[] }`
  - `needsYou(items: readonly WorkItem[], mine: ReadonlySet<string>, now?: number): NeedsYou`
  - `type MilestoneGlance = { milestone: Milestone; done: number; total: number; pct: number; status: MilestoneStatus }`
  - `nextMilestone(milestones: readonly Milestone[], items: readonly WorkItem[], now?: number): MilestoneGlance | null`
  - `type GridCell = { milestoneId: string; done: number; total: number; pct: number; status: MilestoneStatus }`
  - `type GridRow = { id: string; name: string; cells: GridCell[] }`
  - `milestoneGrid(milestones: readonly Milestone[], groups: readonly MilestoneGroup[], now?: number): { milestones: Milestone[]; rows: GridRow[] }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/work/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { milestoneGrid, needsYou, nextMilestone } from './summary'
import type { Milestone, WorkItem } from './types'

const NOW = new Date(2026, 9, 10, 12).getTime()
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'a', title: 'A', status: 'todo', due_at: null, done_at: null, sprint_id: null,
  milestone_id: null, rank: 1, holders: ['Ana'], created_at: '2026-10-01T00:00:00Z', ...over,
})
const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm', name: 'Beta', description: '', due_on: '2026-10-30', reached_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('needsYou', () => {
  it('lists your unfinished tasks past their due date, earliest first', () => {
    const items = [
      item({ id: 'late2', title: 'Late two', due_at: at(-1) }),
      item({ id: 'late1', title: 'Late one', due_at: at(-3) }),
      item({ id: 'doneLate', due_at: at(-2), status: 'done' }),
      item({ id: 'theirs', due_at: at(-2) }),
    ]
    const n = needsYou(items, new Set(['late1', 'late2', 'doneLate']), NOW)
    expect(n.overdue.map((i) => i.id)).toEqual(['late1', 'late2'])
  })

  it('lists your unfinished tasks due within a week, earliest first', () => {
    const items = [
      item({ id: 'six', due_at: at(6) }),
      item({ id: 'two', due_at: at(2) }),
      item({ id: 'eight', due_at: at(8) }),
      item({ id: 'undated' }),
      item({ id: 'doneSoon', due_at: at(1), status: 'done' }),
    ]
    const n = needsYou(items, new Set(['six', 'two', 'eight', 'undated', 'doneSoon']), NOW)
    expect(n.dueSoon.map((i) => i.id)).toEqual(['two', 'six'])
    expect(n.overdue).toEqual([])
  })

  it('lists every unfinished task nobody holds, yours or not', () => {
    const items = [
      item({ id: 'nobody', holders: [], due_at: at(4) }),
      item({ id: 'nobodyUndated', holders: [] }),
      item({ id: 'nobodyDone', holders: [], status: 'done' }),
      item({ id: 'held' }),
    ]
    const n = needsYou(items, new Set(), NOW)
    expect(n.unheld.map((i) => i.id)).toEqual(['nobody', 'nobodyUndated'])
  })
})

describe('nextMilestone', () => {
  it('is the earliest milestone not yet reached, with its progress', () => {
    const milestones = [
      ms({ id: 'later', due_on: '2026-11-20' }),
      ms({ id: 'soon', due_on: '2026-10-25' }),
      ms({ id: 'doneEarly', due_on: '2026-10-12' }),
      ms({ id: 'marked', due_on: '2026-10-11', reached_at: '2026-10-09T00:00:00Z' }),
    ]
    const items = [
      item({ id: '1', milestone_id: 'doneEarly', status: 'done' }),
      item({ id: '2', milestone_id: 'soon', status: 'done' }),
      item({ id: '3', milestone_id: 'soon' }),
    ]
    const next = nextMilestone(milestones, items, NOW)
    expect(next?.milestone.id).toBe('soon')
    expect(next).toMatchObject({ done: 1, total: 2, pct: 50, status: 'upcoming' })
  })

  it('puts a late milestone first, since it is still not reached', () => {
    const next = nextMilestone([ms({ id: 'past', due_on: '2026-10-01' }), ms({ id: 'future' })], [], NOW)
    expect(next?.milestone.id).toBe('past')
    expect(next?.status).toBe('late')
  })

  it('is null with no milestones, or when every one is reached', () => {
    expect(nextMilestone([], [], NOW)).toBeNull()
    expect(nextMilestone([ms({ reached_at: '2026-10-09T00:00:00Z' })], [], NOW)).toBeNull()
  })
})

describe('milestoneGrid', () => {
  it('gives one row per group and one cell per milestone in date order', () => {
    const milestones = [ms({ id: 'final', due_on: '2026-12-01' }), ms({ id: 'draft', due_on: '2026-10-14' })]
    const groups = [
      { id: 'g1', name: 'Group 1', items: [item({ id: 'x', milestone_id: 'draft', status: 'done' })] },
      { id: 'g2', name: 'Group 2', items: [item({ id: 'y', milestone_id: 'draft' }), item({ id: 'z', milestone_id: 'final' })] },
    ]
    const grid = milestoneGrid(milestones, groups, NOW)
    expect(grid.milestones.map((m) => m.id)).toEqual(['draft', 'final'])
    expect(grid.rows.map((r) => r.id)).toEqual(['g1', 'g2'])
    expect(grid.rows[0].cells).toEqual([
      { milestoneId: 'draft', done: 1, total: 1, pct: 100, status: 'reached' },
      { milestoneId: 'final', done: 0, total: 0, pct: 0, status: 'upcoming' },
    ])
    expect(grid.rows[1].cells[0]).toEqual({ milestoneId: 'draft', done: 0, total: 1, pct: 0, status: 'at_risk' })
  })

  it('has no rows without groups and no cells without milestones', () => {
    expect(milestoneGrid([ms()], [], NOW).rows).toEqual([])
    expect(milestoneGrid([], [{ id: 'g', name: 'G', items: [] }], NOW).rows[0].cells).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/work/summary.test.ts`
Expected: FAIL — cannot resolve `./summary`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/work/summary.ts`:

```ts
/**
 * What Summary asks of a space's tasks: what needs this person now, which
 * milestone is next, and how each group stands against each milestone.
 * Worked out from the tasks as they are, never stored.
 */
import { milestoneProgress, milestoneStatus, sortMilestones } from './milestones'
import type { MilestoneStatus } from './milestones'
import type { Milestone, MilestoneGroup, WorkItem } from './types'

export const DUE_SOON_DAYS = 7
const DAY = 86_400_000

export type NeedsYou = { overdue: WorkItem[]; dueSoon: WorkItem[]; unheld: WorkItem[] }

const dueTime = (i: WorkItem) => (i.due_at ? new Date(i.due_at).getTime() : Infinity)
// Undated tasks sort last; Infinity - Infinity is NaN, which falls through to the title.
const byDue = (a: WorkItem, b: WorkItem) => dueTime(a) - dueTime(b) || a.title.localeCompare(b.title)

/**
 * Your unfinished tasks that are late or due within a week, and every
 * unfinished task nobody holds. `mine` is the ids of the tasks you hold.
 */
export function needsYou(items: readonly WorkItem[], mine: ReadonlySet<string>, now = Date.now()): NeedsYou {
  const open = items.filter((i) => i.status !== 'done')
  const yours = open.filter((i) => mine.has(i.id) && i.due_at)
  return {
    overdue: yours.filter((i) => dueTime(i) < now).sort(byDue),
    dueSoon: yours.filter((i) => dueTime(i) >= now && dueTime(i) - now < DUE_SOON_DAYS * DAY).sort(byDue),
    unheld: open.filter((i) => i.holders.length === 0).sort(byDue),
  }
}

export type MilestoneGlance = {
  milestone: Milestone
  done: number
  total: number
  pct: number
  status: MilestoneStatus
}

/** The earliest milestone not yet reached, late ones included; null when none is left. */
export function nextMilestone(
  milestones: readonly Milestone[],
  items: readonly WorkItem[],
  now = Date.now(),
): MilestoneGlance | null {
  for (const m of sortMilestones(milestones)) {
    const p = milestoneProgress(items, m.id)
    const status = milestoneStatus(m, p, now)
    if (status !== 'reached') return { milestone: m, ...p, status }
  }
  return null
}

export type GridCell = { milestoneId: string; done: number; total: number; pct: number; status: MilestoneStatus }
export type GridRow = { id: string; name: string; cells: GridCell[] }

/** One row per group, one cell per milestone in date order, each from that group's own tasks. */
export function milestoneGrid(
  milestones: readonly Milestone[],
  groups: readonly MilestoneGroup[],
  now = Date.now(),
): { milestones: Milestone[]; rows: GridRow[] } {
  const ordered = sortMilestones(milestones)
  return {
    milestones: ordered,
    rows: groups.map((g) => ({
      id: g.id,
      name: g.name,
      cells: ordered.map((m) => {
        const p = milestoneProgress(g.items, m.id)
        return { milestoneId: m.id, ...p, status: milestoneStatus(m, p, now) }
      }),
    })),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/work`
Expected: PASS, every file in `src/lib/work`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/summary.ts src/lib/work/summary.test.ts
git commit -m "Work out what Summary needs: your tasks, the next milestone, groups by milestone"
```

---

### Task 2: Summary cards for the work space and class students

**Files:**
- Create: `src/components/work/MilestoneBits.tsx`
- Create: `src/components/work/WorkGlance.tsx`
- Modify: `src/components/work/MilestonesView.tsx` (use `MilestoneBits` instead of its local `TONE`, `StatusPill`, `Bar`)
- Modify: `src/components/general/workSource.ts` (export `generalWorkItems`)
- Modify: `src/components/general/WorkSummary.tsx` (render `WorkGlance` first; new `onSection` prop)
- Modify: `src/components/general/WorkTab.tsx` (pass `onSection`)
- Modify: `src/components/tasks/StudentTasksView.tsx` (render `WorkGlance` first in the summary branch)

**Interfaces:**
- Consumes: Task 1's `needsYou`, `nextMilestone`; `Burndown` (`src/components/work/Burndown.tsx`, props `{ sprint, items }`); `runningSprint`, `sprintCounts`, `daysLeft`, `daysLeftLabel` (`src/lib/work/sprints.ts`); `dueInLabel` (`src/lib/work/milestones.ts`); `dateRange`, `formatDay`, `formatDue` (`src/lib/general/dates.ts`); `WorkSection` (`src/lib/work/nav.ts`); `classWorkItem` (`src/components/tasks/classWorkSource.ts`); `isMine(task, studentId)` (`src/lib/types.ts`); `GeneralProjectState` has `tasks` (each with `assignee_ids: string[]`), `sprints`, `milestones`, `viewerId: string | undefined`.
- Produces:
  - `StatusPill({ status }: { status: MilestoneStatus })` and `ProgressBar({ pct }: { pct: number })` from `MilestoneBits.tsx` (Task 3 uses `StatusPill`).
  - `WorkGlance(props: { items: WorkItem[]; sprints: Sprint[]; milestones: Milestone[]; mine: ReadonlySet<string>; onOpenTask: (id: string) => void; onSection: (s: WorkSection) => void })`
  - `generalWorkItems(state: GeneralProjectState): WorkItem[]`

- [ ] **Step 1: Extract the milestone bits**

Create `src/components/work/MilestoneBits.tsx` with the code moved out of `MilestonesView.tsx` (same classes, `Bar` renamed `ProgressBar`):

```tsx
import { MILESTONE_STATUS_LABEL } from '../../lib/work/milestones'
import type { MilestoneStatus } from '../../lib/work/milestones'

const TONE: Record<MilestoneStatus, string> = {
  reached: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300',
  late: 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300',
  at_risk: 'bg-warning-50 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300',
  upcoming: 'bg-pending-soft text-pending-ink',
}

/** A milestone's status, in the colours Milestones and Summary share. */
export function StatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${TONE[status]}`}>
      {MILESTONE_STATUS_LABEL[status]}
    </span>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full surface-sunken">
      <span className="block h-full rounded-full bg-progress" style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  )
}
```

In `MilestonesView.tsx`: delete the local `TONE`, `StatusPill` and `Bar`; add `import { ProgressBar, StatusPill } from './MilestoneBits'`; replace every `<Bar ` with `<ProgressBar `; drop imports that become unused (`MILESTONE_STATUS_LABEL`, `MilestoneStatus`) so eslint stays clean.

- [ ] **Step 2: Write `WorkGlance`**

Create `src/components/work/WorkGlance.tsx`:

```tsx
import { Burndown } from './Burndown'
import { ProgressBar, StatusPill } from './MilestoneBits'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useNow } from '../../hooks/useNow'
import { dateRange, formatDay, formatDue } from '../../lib/general/dates'
import { dueInLabel } from '../../lib/work/milestones'
import type { WorkSection } from '../../lib/work/nav'
import { daysLeft, daysLeftLabel, runningSprint, sprintCounts } from '../../lib/work/sprints'
import { needsYou, nextMilestone } from '../../lib/work/summary'
import type { Milestone, Sprint, WorkItem } from '../../lib/work/types'

/** Rows shown per Needs you group before "and N more". */
const LIST_CAP = 5

type GlanceProps = {
  items: WorkItem[]
  sprints: Sprint[]
  milestones: Milestone[]
  /** Ids of the tasks the viewer holds. */
  mine: ReadonlySet<string>
  onOpenTask: (id: string) => void
  onSection: (s: WorkSection) => void
}

/**
 * The top of Summary: the running sprint, the next milestone, and what needs
 * the viewer now. The same cards in either space; each one links to the
 * section where that work is done.
 */
export function WorkGlance({ items, sprints, milestones, mine, onOpenTask, onSection }: GlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SprintCard items={items} sprints={sprints} onSection={onSection} />
      <MilestoneCard items={items} milestones={milestones} onSection={onSection} />
      <div className="lg:col-span-2">
        <NeedsYouCard items={items} mine={mine} onOpenTask={onOpenTask} />
      </div>
    </div>
  )
}

function CardHead({ icon, label, action, onAction }: { icon: IconName; label: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <button
        type="button"
        onClick={onAction}
        className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
      >
        {action}
      </button>
    </div>
  )
}

function Counted({ done, total, noun, pct }: { done: number; total: number; noun: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">
          <strong className="text-ink">
            {done} of {total}
          </strong>{' '}
          {noun} done
        </span>
        <span className="font-mono text-faint">{pct}%</span>
      </div>
      <ProgressBar pct={pct} />
    </div>
  )
}

function SprintCard({ items, sprints, onSection }: Pick<GlanceProps, 'items' | 'sprints' | 'onSection'>) {
  const now = useNow()
  const sprint = runningSprint(sprints)

  if (!sprint) {
    const planned = sprints.some((s) => s.state === 'planned')
    return (
      <section className="card p-4 shadow-card sm:p-5">
        <CardHead icon="target" label="Running sprint" action="Open Backlog" onAction={() => onSection('backlog')} />
        <p className="mt-3 text-[13px] text-muted">
          No sprint is running.{' '}
          {planned ? 'Start a planned one from Backlog.' : 'Plan one from Backlog when the team is ready.'}
        </p>
      </section>
    )
  }

  const { done, total } = sprintCounts(items, sprint.id)
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="target" label="Running sprint" action="Open Sprints" onAction={() => onSection('sprints')} />
      <h3 className="mt-2 truncate">{sprint.name}</h3>
      {sprint.goal && <p className="mt-0.5 text-[13px] text-muted">{sprint.goal}</p>}
      <p className="mt-1 text-[12px] text-faint">
        {dateRange(sprint.starts_on, sprint.ends_on)} · {daysLeftLabel(daysLeft(sprint, now))}
      </p>
      <div className="mt-3">
        <Counted done={done} total={total} noun="tasks" pct={pct} />
      </div>
      <div className="mt-4">
        <Burndown sprint={sprint} items={items} />
      </div>
    </section>
  )
}

function MilestoneCard({ items, milestones, onSection }: Pick<GlanceProps, 'items' | 'milestones' | 'onSection'>) {
  const now = useNow()
  const next = nextMilestone(milestones, items, now)
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="pin" label="Next milestone" action="Open Milestones" onAction={() => onSection('milestones')} />
      {!next ? (
        <p className="mt-3 text-[13px] text-muted">
          {milestones.length === 0 ? 'No milestones yet.' : 'Every milestone is reached.'}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate">{next.milestone.name}</h3>
            <StatusPill status={next.status} />
          </div>
          <p className="mt-1 text-[12px] text-faint">
            {formatDay(next.milestone.due_on)} · {dueInLabel(next.milestone.due_on, now)}
          </p>
          <div className="mt-3">
            <Counted done={next.done} total={next.total} noun="tagged tasks" pct={next.pct} />
          </div>
          {next.total === 0 && <p className="mt-2 text-[12px] text-faint">No task counts toward it yet.</p>}
        </>
      )}
    </section>
  )
}

function NeedsYouCard({ items, mine, onOpenTask }: Pick<GlanceProps, 'items' | 'mine' | 'onOpenTask'>) {
  const now = useNow()
  const n = needsYou(items, mine, now)
  const groups = [
    { key: 'overdue', label: 'Overdue', tone: 'text-danger-700 dark:text-danger-300', rows: n.overdue },
    { key: 'soon', label: 'Due this week', tone: 'text-warning-800 dark:text-warning-300', rows: n.dueSoon },
    { key: 'unheld', label: 'Nobody on it', tone: 'text-pending-ink', rows: n.unheld },
  ].filter((g) => g.rows.length > 0)

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name="alert" size={13} />
        Needs you
      </span>
      {groups.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          Nothing needs you right now. None of your tasks is late or due this week, and every open
          task has someone on it.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="min-w-0">
              <h4 className={`text-[13px] font-semibold ${g.tone}`}>
                {g.label} <span className="font-mono font-normal text-faint">{g.rows.length}</span>
              </h4>
              <ul className="mt-1.5 space-y-0.5">
                {g.rows.slice(0, LIST_CAP).map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(i.id)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 truncate text-[14px] text-ink">{i.title}</span>
                      {i.due_at && (
                        <span className="shrink-0 font-mono text-[11px] text-faint">{formatDue(i.due_at)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {g.rows.length > LIST_CAP && (
                <p className="mt-1 px-2 text-[12px] text-faint">and {g.rows.length - LIST_CAP} more</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

Check `target`, `pin` and `alert` exist in `IconName` (`src/components/ui/Icon.tsx`); `WorkNav.tsx` already uses `target` and `pin`, `WorkSummary.tsx` uses `alert`.

- [ ] **Step 3: Work space — share the item mapping and render the glance**

In `src/components/general/workSource.ts`, lift the `items` mapping out of `generalWorkSource` into an exported function, and use it in both sources:

```ts
/** A work project's tasks as the shared Work views read them. */
export function generalWorkItems(state: GeneralProjectState): WorkItem[] {
  return state.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_at: t.due_at,
    done_at: t.completed_at,
    sprint_id: t.sprint_id,
    milestone_id: t.milestone_id,
    rank: t.rank,
    holders: t.assignee_ids.map((id) => state.nameOf(id)),
    created_at: t.created_at,
  }))
}
```

Then `items: generalWorkItems(state),` in `generalWorkSource`, and `items: generalWorkItems(state),` in `generalMilestoneSource` (replacing `generalWorkSource(state, openTask).items`). Add `WorkItem` to the `../../lib/work/types` type import.

In `src/components/general/WorkSummary.tsx`:
- Signature becomes `WorkSummary({ state, onOpenTask, onSection }: { state: GeneralProjectState; onOpenTask: (id: string) => void; onSection: (s: WorkSection) => void })`.
- Imports: `import { WorkGlance } from '../work/WorkGlance'`, `import type { WorkSection } from '../../lib/work/nav'`, `import { generalWorkItems } from './workSource'`.
- First child of the outer `<div className="space-y-6">`, before "Where we are":

```tsx
<WorkGlance
  items={generalWorkItems(state)}
  sprints={state.sprints}
  milestones={state.milestones}
  mine={new Set(state.viewerId ? state.tasks.filter((t) => t.assignee_ids.includes(state.viewerId as string)).map((t) => t.id) : [])}
  onOpenTask={onOpenTask}
  onSection={onSection}
/>
```

- Update the doc comment's first line to: `How the project is going, in the order somebody asks: what is running and what needs me, how far, what moved this week, who carries it, will it finish, what is late.`

In `src/components/general/WorkTab.tsx`, the summary branch becomes:

```tsx
<WorkSummary
  state={state}
  onOpenTask={showTask}
  onSection={(s) => setParams(withWork(params, { section: s }))}
/>
```

- [ ] **Step 4: Class student — render the glance**

In `src/components/tasks/StudentTasksView.tsx`, add imports `import { WorkGlance } from '../work/WorkGlance'` and `classWorkItem` to the existing `./classWorkSource` import. The `t.section === 'summary'` branch becomes:

```tsx
<div className="space-y-4">
  <WorkGlance
    items={t.tasks.map(classWorkItem)}
    sprints={t.sprints}
    milestones={t.milestones}
    mine={new Set(viewerId ? t.tasks.filter((x) => isMine(x, viewerId)).map((x) => x.id) : [])}
    onOpenTask={t.showTask}
    onSection={t.setSection}
  />
  <BoardProgress board={active} />
  <MemberProgress
    rows={t.progress}
    viewerId={viewerId}
    title={active.group_id ? 'Your group' : 'Your progress'}
  />
  <TaskSummary rows={t.scope} />
</div>
```

(`isMine` is already imported from `../../lib/types`.)

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: `tsc -b` clean, `✓ built`.

Run: `npx eslint src/components/work src/components/general/WorkSummary.tsx src/components/general/WorkTab.tsx src/components/general/workSource.ts src/components/tasks/StudentTasksView.tsx`
Expected: no output.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/work/MilestoneBits.tsx src/components/work/WorkGlance.tsx src/components/work/MilestonesView.tsx src/components/general/workSource.ts src/components/general/WorkSummary.tsx src/components/general/WorkTab.tsx src/components/tasks/StudentTasksView.tsx
git commit -m "Open Summary on the running sprint, the next milestone and what needs you"
```

---

### Task 3: Groups × milestones grid for professors

**Files:**
- Create: `src/components/work/GroupMilestoneGrid.tsx`
- Modify: `src/components/tasks/ProfessorTasksView.tsx` (summary branch: new section after the Groups section, before "Every group")

**Interfaces:**
- Consumes: Task 1's `milestoneGrid`; Task 2's `StatusPill` from `./MilestoneBits`; `formatDay` (`src/lib/general/dates.ts`); `classMilestoneSource(t, projectId).groups` (`src/components/tasks/classWorkSource.ts`) — one `MilestoneGroup` per board, `id` = board id, `name` = `boardOwnerName(board)`, `items` = that board's tasks; `openBoard(boardId)` already defined in `ProfessorTasksView` (shows the board and switches to Tasks); `t.setSection`, `t.milestones`.
- Produces: `GroupMilestoneGrid(props: { milestones: Milestone[]; groups: MilestoneGroup[]; who: string; onOpenGroup: (id: string) => void; onSetMilestones: () => void })` where `who` is `'group'` or `'student'`.

- [ ] **Step 1: Write the grid**

Create `src/components/work/GroupMilestoneGrid.tsx`:

```tsx
import { StatusPill } from './MilestoneBits'
import { useNow } from '../../hooks/useNow'
import { formatDay } from '../../lib/general/dates'
import { milestoneGrid } from '../../lib/work/summary'
import type { Milestone, MilestoneGroup } from '../../lib/work/types'

/**
 * Every group against every milestone, for a professor: one row per group,
 * one column per milestone in date order. A cell is that group's tagged tasks
 * done, with the status the Milestones page shows. It scrolls inside its own
 * box, so a long run of milestones never widens the page.
 */
export function GroupMilestoneGrid({
  milestones,
  groups,
  who,
  onOpenGroup,
  onSetMilestones,
}: {
  milestones: Milestone[]
  groups: MilestoneGroup[]
  /** 'group' or 'student', for the copy. */
  who: string
  onOpenGroup: (id: string) => void
  onSetMilestones: () => void
}) {
  const now = useNow()
  const grid = milestoneGrid(milestones, groups, now)

  if (grid.milestones.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        No milestones yet.{' '}
        <button
          type="button"
          onClick={onSetMilestones}
          className="font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          Set them in Milestones
        </button>{' '}
        to follow each {who} against them.
      </p>
    )
  }
  if (grid.rows.length === 0) {
    return <p className="text-[13px] text-muted">No {who} has a board yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-panel border border-line">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="surface-sunken">
            <th scope="col" className="sticky left-0 z-10 surface-sunken px-3 py-2 text-left font-medium text-muted">
              {who === 'student' ? 'Student' : 'Group'}
            </th>
            {grid.milestones.map((m) => (
              <th key={m.id} scope="col" className="px-3 py-2 text-left font-medium">
                <span className="block max-w-[10rem] truncate text-ink">{m.name}</span>
                <span className="block font-mono text-[11px] font-normal text-faint">{formatDay(m.due_on)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {grid.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky left-0 z-10 surface px-3 py-2 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onOpenGroup(r.id)}
                  className="block max-w-[12rem] truncate text-ink hover:underline"
                >
                  {r.name}
                </button>
              </th>
              {r.cells.map((c) => (
                <td key={c.milestoneId} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-10 font-mono text-[12px] text-faint">
                      {c.total ? `${c.done}/${c.total}` : '—'}
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the professor Summary**

In `src/components/tasks/ProfessorTasksView.tsx`, add `import { GroupMilestoneGrid } from '../work/GroupMilestoneGrid'`. In the `t.section === 'summary'` fragment, between the Groups `<section>` (the one holding `GroupProgressTable`) and the "Every {who}" section, insert:

```tsx
{/* 3 ── every group against every milestone */}
<section className="space-y-3 border-t border-line pt-6">
  <div>
    <h3>Milestones by {who}</h3>
    <p className="mt-0.5 text-[13px] text-muted">
      How far each {who} is toward each milestone. Open {solo ? 'a student' : 'a group'} to see its tasks.
    </p>
  </div>
  <GroupMilestoneGrid
    milestones={t.milestones}
    groups={classMilestoneSource(t, project.id).groups}
    who={who}
    onOpenGroup={openBoard}
    onSetMilestones={() => t.setSection('milestones')}
  />
</section>
```

(`classMilestoneSource` is already imported; `who`, `solo` and `openBoard` are already defined in the component.)

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: clean.

Run: `npx eslint src/components/work/GroupMilestoneGrid.tsx src/components/tasks/ProfessorTasksView.tsx`
Expected: no output.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/work/GroupMilestoneGrid.tsx src/components/tasks/ProfessorTasksView.tsx
git commit -m "Show professors every group against every milestone on Summary"
```

---

### Task 4: Browser check and handoff (controller)

**Files:**
- Modify: `handoff.md` (append a Part 4 section at the end, same shape as the Part 2 and Part 3 entries)

- [ ] **Step 1: Browser pass on the dev server** (`preview_start` name from `.claude/launch.json`)
  - Work project › Work › Summary: the sprint card (or "No sprint is running"), the milestone card (or "No milestones yet"), Needs you, then the existing sections in order. "Open Backlog/Sprints/Milestones" switch section. A Needs you row opens the task dialog.
  - Class project as a student: the same three cards above board progress.
  - Class project as the professor, if the signed-in account can view one: the grid or its empty state under Groups. If no professor session is available, record that it was not seen.
  - Dark mode and 375 px wide: no sideways scroll (`document.documentElement.scrollWidth <= clientWidth`). Console has no new errors.
- [ ] **Step 2: Append the handoff section** — what changed, who sees what, code paths, checks with real numbers, what was not tried, and "Next: the Work tab plan is complete; open work is the Deferred notes".
- [ ] **Step 3: Commit and push**

```bash
git add handoff.md
git commit -m "Hand off Work tab part 4"
git push -u origin claude/work-tab-4
```
