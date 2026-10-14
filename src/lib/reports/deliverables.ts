import type { Tone } from '../analyticsMath'
import type { DeliverableRow, DeliverableState } from '../types'
import { dayText } from './doc'
import type { Block, Cell, Column, ReportDoc, RichCell } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

export type DeliverableProject = { id: string; title: string; audience: 'group' | 'individual' }

/** Said under both B3 reports when the page left boards out. */
export const LEFT_OUT_LINE = 'Groups with no members and students no longer in the class are left out.'
/** Opens both B3 reports for an archived class. */
export const CLASS_ENDED_NOTE = 'This class has ended. The report shows it as it was left.'

/**
 * Whether a board belongs in the B3 reports: a group's while it has members, a
 * student's while they are still active in the class. `active` is the class's
 * active student ids.
 */
export function countableBoard(
  b: { group_id: string | null; student_id: string | null; member_count: number },
  active: ReadonlySet<string>,
) {
  if (b.group_id) return b.member_count > 0
  return b.student_id !== null && active.has(b.student_id)
}

const TONE: Record<DeliverableState, Tone> = { on_time: 'success', late: 'warning', missing: 'danger', not_due: 'pending' }

export function deliverableLabel(r: Pick<DeliverableRow, 'state' | 'days_late'>): string {
  switch (r.state) {
    case 'on_time':
      return 'On time'
    case 'late': {
      const n = r.days_late ?? 1
      return `Late (${n} ${n === 1 ? 'day' : 'days'})`
    }
    case 'missing':
      return 'Missing'
    default:
      return 'Not due yet'
  }
}

/** A grid cell: the label in its tone, and days late for a spreadsheet (0 on time, empty otherwise). */
export function deliverableCell(r: Pick<DeliverableRow, 'state' | 'days_late'>): RichCell {
  const exportValue = r.state === 'on_time' ? 0 : r.state === 'late' ? r.days_late ?? 1 : null
  return { value: deliverableLabel(r), tone: TONE[r.state], exportValue }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
const boardName = (r: DeliverableRow) => r.group_name ?? r.student_name ?? 'A board'
const columnLabel = (r: DeliverableRow) =>
  r.kind === 'hand_in'
    ? r.due_day ? `Hand-in (due ${dayText(r.due_day)})` : 'Hand-in (no due date)'
    : `${r.title} (due ${dayText(r.due_day as string)})`

const LEGEND: Block = {
  kind: 'table',
  id: 'legend',
  title: 'Legend',
  columns: [
    { key: 'state', label: 'State', type: 'status' },
    { key: 'meaning', label: 'Meaning', type: 'text' },
    { key: 'sheet', label: 'In Excel and CSV', type: 'text' },
  ],
  rows: [
    [{ value: 'On time', tone: 'success' }, 'Handed in by the deadline, or every task done by the end of the due day.', '0'],
    [{ value: 'Late (N days)', tone: 'warning' }, 'Done after the deadline or due day. N counts the days late, rounded up.', 'N'],
    [{ value: 'Missing', tone: 'danger' }, 'Past due and not done.', 'Empty'],
    [{ value: 'Not due yet', tone: 'pending' }, 'Due later.', 'Empty'],
  ],
}

export function deliverablesDoc(input: ReportHead & {
  projects: DeliverableProject[]
  rows: DeliverableRow[]
  /** Null means every date. */
  window: DayRange | null
  notice?: string | null
  /** The class is archived. */
  classEnded?: boolean
  /** The page left out boards with nobody on them. */
  leftOut?: boolean
}): ReportDoc {
  const { window } = input
  const wanted = new Set(input.projects.map((p) => p.id))
  const inWindow = (r: DeliverableRow) =>
    window === null || (r.due_day !== null && r.due_day >= window.from && r.due_day <= window.to)
  const mineAll = input.rows.filter((r) => wanted.has(r.project_id))
  const shown = mineAll.filter(inWindow)
  // A project with no rows at all has no boards: nothing could ever fall due on it.
  const hasRows = new Set(mineAll.map((r) => r.project_id))

  const due = shown.filter((r) => r.state !== 'not_due')
  const count = (s: DeliverableState) => shown.filter((r) => r.state === s).length
  const rate = due.length ? Math.round((count('on_time') / due.length) * 1000) / 10 : null
  const blocks: Block[] = []
  if (input.classEnded) blocks.push({ kind: 'note', tone: 'info', text: CLASS_ENDED_NOTE })
  if (input.notice) blocks.push({ kind: 'note', tone: 'info', text: input.notice })
  blocks.push({
    kind: 'kpis',
    items: [
      { label: 'On-time rate', value: rate ?? '—', unit: rate === null ? undefined : '%' },
      { label: 'On time', value: count('on_time') },
      { label: 'Late', value: count('late') },
      { label: 'Missing', value: count('missing') },
      { label: 'Not due yet', value: count('not_due') },
    ],
  })

  let grids = 0
  for (const p of input.projects) {
    const mine = shown.filter((r) => r.project_id === p.id)
    if (mine.length === 0) {
      // When no project has rows the closing sentence says so for all of them.
      if (input.projects.length > 1 && hasRows.size > 0) {
        blocks.push({
          kind: 'note',
          tone: 'info',
          text: hasRows.has(p.id) ? `Nothing on ${p.title} falls due in these dates.` : `${p.title} has no groups or students yet.`,
        })
      }
      continue
    }
    // One column per deliverable: milestones by due day, then title; the hand-in last.
    const keyOf = (r: DeliverableRow) => `${r.kind}:${r.ref_id}`
    const firstOf = new Map<string, DeliverableRow>()
    for (const r of mine) if (!firstOf.has(keyOf(r))) firstOf.set(keyOf(r), r)
    const deliverables = [...firstOf.values()].sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'hand_in' ? 1 : -1
        : (a.due_day ?? '').localeCompare(b.due_day ?? '') || byName(a.title, b.title),
    )
    const boards = new Map<string, string>()
    for (const r of mine) boards.set(r.board_id, boardName(r))
    const cellAt = new Map(mine.map((r) => [`${r.board_id}|${keyOf(r)}`, r]))
    const columns: Column[] = [
      { key: 'who', label: p.audience === 'group' ? 'Group' : 'Student', type: 'text' },
      ...deliverables.map((d) => ({ key: keyOf(d), label: columnLabel(d), type: 'status' as const })),
    ]
    const rows = [...boards.entries()]
      .sort((a, b) => byName(a[1], b[1]))
      .map<Cell[]>(([id, name]) => [
        name,
        ...deliverables.map((d) => {
          const r = cellAt.get(`${id}|${keyOf(d)}`)
          return r ? deliverableCell(r) : null
        }),
      ])
    blocks.push({
      kind: 'table',
      id: `compliance-${p.id}`,
      title: `${input.projects.length > 1 ? p.title : 'Compliance'}${mine.some((r) => r.project_archived_at) ? ' (archived)' : ''}`,
      columns,
      rows,
    })
    grids++
  }

  if (grids === 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      text:
        hasRows.size > 0
          ? 'No milestones or hand-ins fall due in these dates. Widen the dates or pick another project.'
          : input.projects.length === 1
            ? 'This project has no groups or students yet.'
            : 'These projects have no groups or students yet.',
    })
  } else {
    blocks.push(LEGEND)
  }

  return {
    header: {
      title: 'Deliverables & milestone compliance',
      subtitle: input.projects.length === 1 ? input.projects[0].title : 'All projects',
      classLine: input.classLine,
      rangeLabel: window ? rangeText(window) : 'Every date',
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [
        'A milestone is met when all its tasks are done by the end of its due day, Manila time.',
        "A hand-in is on time when it arrives by the project's deadline. Collabify keeps the latest hand-in time only.",
        ...(input.leftOut ? [LEFT_OUT_LINE] : []),
      ],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
