import { burnupSeries, manilaDay } from '../analyticsMath'
import type { BurnupPoint } from '../analyticsMath'
import type { BoardDecision, DeliverableRow, MemberLoad, ReportSprint, ResultVerdict, TaskState } from '../types'
import { CLASS_ENDED_NOTE, LEFT_OUT_LINE, deliverableCell } from './deliverables'
import { dayText } from './doc'
import type { Block, Cell, Column, ReportDoc } from './doc'
import type { ReportHead } from './grading'

export type ProgressBoard = {
  board_id: string
  /** The group's name, or the student's on an individual project. */
  name: string
  submitted_at: string | null
  submitted_by_name: string | null
  result_verdict: ResultVerdict | null
}

export type ProgressProject = {
  id: string
  title: string
  audience: 'group' | 'individual'
  due_at: string | null
  archived_at: string | null
  created_at: string
}

type Input = ReportHead & {
  project: ProgressProject
  boards: ProgressBoard[]
  single: boolean
  tasks: TaskState[]
  members: MemberLoad[]
  deliverables: DeliverableRow[]
  sprints: ReportSprint[]
  history: BoardDecision[]
  /** A Manila day. */
  today: string
  /** The class is archived. */
  classEnded?: boolean
  /** The page left out boards with nobody on them. */
  leftOut?: boolean
}

/** A board's share of its weight done, as task_board_overview.done_pct works it out. */
function donePct(tasks: TaskState[]) {
  const total = tasks.reduce((s, t) => s + t.weight, 0)
  if (total === 0) return 0
  const done = tasks.reduce((s, t) => s + (t.status === 'done' ? t.weight : 0), 0)
  return Math.round((done / total) * 1000) / 10
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Finished after the deadline, or still open past its due day. */
const isLate = (t: TaskState, today: string) =>
  t.late || (t.status !== 'done' && t.due_at !== null && manilaDay(t.due_at) < today)

function handInText(b: ProgressBoard) {
  if (b.submitted_at) return `Handed in ${dayText(b.submitted_at)}`
  return b.result_verdict === 'returned' ? 'Returned, not handed in again' : 'Not handed in'
}

/** The standing answer. A hand-in after the last answer is waiting for one. */
function verdictCell(b: ProgressBoard, history: BoardDecision[]): Cell {
  const last = history
    .filter((h) => h.board_id === b.board_id)
    .reduce<BoardDecision | null>((best, h) => (!best || Date.parse(h.decided_at) > Date.parse(best.decided_at) ? h : best), null)
  if (b.submitted_at && (!last || Date.parse(last.decided_at) < Date.parse(b.submitted_at))) {
    return { value: 'Waiting for an answer', tone: 'pending' }
  }
  if (b.result_verdict === 'accepted') return { value: 'Accepted', tone: 'success' }
  if (b.result_verdict === 'returned') return { value: 'Returned', tone: 'warning' }
  return null
}

const cellValueText = (c: Cell) => (c !== null && typeof c === 'object' ? String(c.value) : c === null ? '—' : String(c))

function burnup(project: ProgressProject, tasks: TaskState[], today: string): BurnupPoint[] {
  if (tasks.length === 0) return []
  const from = tasks.reduce((min, t) => {
    const d = manilaDay(t.created_at)
    return d < min ? d : min
  }, manilaDay(project.created_at))
  let to = today
  if (project.archived_at) {
    const lastDone = tasks.reduce<string>((max, t) => (t.status === 'done' && t.done_at && manilaDay(t.done_at) > max ? manilaDay(t.done_at) : max), from)
    const due = project.due_at ? manilaDay(project.due_at) : from
    to = [lastDone, due].reduce((a, b) => (b > a ? b : a))
    if (to > today) to = today
  }
  return burnupSeries(tasks, from, to)
}

function burnupSummary(points: BurnupPoint[], project: ProgressProject) {
  const last = points[points.length - 1]
  const due = project.due_at ? ` The project is due ${dayText(project.due_at)}.` : ''
  return `${last.done} of ${last.scope} tasks done by ${dayText(last.day)}.${due}`
}

export function groupProgressDoc(input: Input): ReportDoc {
  const { project, today } = input
  const group = project.audience === 'group'
  const who = group ? 'Group' : 'Student'
  const boards = [...input.boards].sort((a, b) => byName(a.name, b.name))
  const ids = new Set(boards.map((b) => b.board_id))
  const nameOf = new Map(boards.map((b) => [b.board_id, b.name]))
  const tasks = input.tasks.filter((t) => ids.has(t.board_id))
  const tasksOf = (id: string) => tasks.filter((t) => t.board_id === id)
  const history = input.history.filter((h) => ids.has(h.board_id))
  const single = input.single && boards.length === 1
  const lead = (id: string): Cell[] => (single ? [] : [nameOf.get(id) ?? null])
  const leadCol: Column[] = single ? [] : [{ key: 'who', label: who, type: 'text' }]

  const blocks: Block[] = []
  const finish = (): ReportDoc => ({
    header: {
      title: 'Group progress report',
      subtitle: single ? `${boards[0].name} · ${project.title}` : `${project.title} · every ${group ? 'group' : 'student'}`,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [
        'Counts are tasks recorded in Collabify. A flag is a prompt for a conversation, not a verdict.',
        ...(input.leftOut ? [LEFT_OUT_LINE] : []),
      ],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  })
  if (input.classEnded) blocks.push({ kind: 'note', tone: 'info', text: CLASS_ENDED_NOTE })
  if (project.archived_at) blocks.push({ kind: 'note', tone: 'info', text: 'This project is archived. The report shows it as it was left.' })

  if (single) {
    const b = boards[0]
    blocks.push({
      kind: 'kpis',
      items: [
        { label: 'Done', value: donePct(tasksOf(b.board_id)), unit: '%' },
        { label: 'Tasks', value: tasksOf(b.board_id).length },
        { label: 'Late tasks', value: tasksOf(b.board_id).filter((t) => isLate(t, today)).length },
        { label: 'Hand-in', value: handInText(b) },
        { label: 'Verdict', value: cellValueText(verdictCell(b, history)) },
      ],
    })
  } else {
    const handedIn = boards.filter((b) => b.submitted_at).length
    blocks.push({
      kind: 'kpis',
      items: [
        { label: group ? 'Groups' : 'Students', value: boards.length },
        {
          label: 'Average done',
          value: boards.length ? Math.round((boards.reduce((s, b) => s + donePct(tasksOf(b.board_id)), 0) / boards.length) * 10) / 10 : 0,
          unit: '%',
        },
        { label: 'Handed in', value: `${handedIn} of ${boards.length}` },
        {
          label: 'Accepted',
          value: boards.filter((b) => {
            const v = verdictCell(b, history)
            return v !== null && typeof v === 'object' && v.value === 'Accepted'
          }).length,
        },
        { label: 'Late tasks', value: tasks.filter((t) => isLate(t, today)).length },
      ],
    })
    if (boards.length === 0) {
      blocks.push({
        kind: 'note',
        tone: 'info',
        text: group
          ? 'This project has no groups yet. Groups appear once students are placed in them.'
          : 'This project has no students yet. Students appear once they join the class.',
      })
      return finish()
    }
    blocks.push({
      kind: 'table',
      id: 'groups',
      title: group ? 'Groups' : 'Students',
      columns: [
        { key: 'who', label: who, type: 'text' },
        { key: 'done', label: 'Done', type: 'percent' },
        { key: 'tasks', label: 'Tasks', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'handIn', label: 'Hand-in', type: 'text' },
        { key: 'verdict', label: 'Verdict', type: 'status' },
        { key: 'returns', label: 'Returns', type: 'number' },
      ],
      rows: boards.map<Cell[]>((b) => [
        b.name,
        donePct(tasksOf(b.board_id)),
        tasksOf(b.board_id).length,
        tasksOf(b.board_id).filter((t) => isLate(t, today)).length,
        handInText(b),
        verdictCell(b, history),
        history.filter((h) => h.board_id === b.board_id && h.verdict === 'returned').length,
      ]),
    })
  }

  // Burnups: one per board, on one scale when there are several.
  const series = boards.map((b) => ({ b, points: burnup(project, tasksOf(b.board_id), today) }))
  const yMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.scope)))
  for (const { b, points } of series) {
    if (points.length === 0) {
      if (single) blocks.push({ kind: 'note', tone: 'info', text: 'No tasks on this board yet, so there is nothing to chart.' })
      continue
    }
    blocks.push({
      kind: 'chart',
      id: `burnup-${b.board_id}`,
      title: single ? 'Scope and done' : `${b.name}: scope and done`,
      chart: { kind: 'burnup', points, endDay: project.due_at ? manilaDay(project.due_at) : null, ...(single ? {} : { yMax }) },
      summary: burnupSummary(points, project),
    })
  }

  if (group) {
    const people = input.members
      .filter((m) => ids.has(m.board_id))
      .sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || byName(a.student_name, b.student_name))
    if (people.length === 0) {
      blocks.push({ kind: 'note', tone: 'info', text: 'No members yet. Members appear once students join the group.' })
    } else {
      blocks.push({
        kind: 'table',
        id: 'members',
        title: 'Members',
        columns: [
          ...leadCol,
          { key: 'member', label: 'Member', type: 'text' },
          { key: 'share', label: 'Share', type: 'percent' },
          { key: 'finished', label: 'Finished', type: 'number' },
          { key: 'held', label: 'Held', type: 'number' },
          { key: 'late', label: 'Late', type: 'number' },
        ],
        rows: people.map<Cell[]>((m) => [
          ...lead(m.board_id),
          m.student_name,
          m.held_pct,
          m.done_count,
          m.task_count,
          tasksOf(m.board_id).filter((t) => t.assignee_ids.includes(m.student_id) && isLate(t, today)).length,
        ]),
      })
    }
  }

  const milestones = input.deliverables
    .filter((d) => d.kind === 'milestone' && ids.has(d.board_id))
    .sort((a, b) =>
      byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') ||
      (a.due_day ?? '').localeCompare(b.due_day ?? '') || byName(a.title, b.title))
  if (milestones.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: "This project has no milestones. Add them on the project's Work tab." })
  } else {
    blocks.push({
      kind: 'table',
      id: 'milestones',
      title: 'Milestones',
      columns: [
        ...leadCol,
        { key: 'milestone', label: 'Milestone', type: 'text' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'done', label: 'Done', type: 'number' },
        { key: 'tasks', label: 'Tasks', type: 'number' },
        { key: 'state', label: 'State', type: 'status' },
      ],
      rows: milestones.map<Cell[]>((d) => [...lead(d.board_id), d.title, d.due_day, d.done, d.tasks, deliverableCell(d)]),
      note: 'A milestone is met when all its tasks are done by the end of its due day.',
    })
  }

  const sprints = input.sprints
    .filter((s) => ids.has(s.board_id))
    .sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || a.starts_on.localeCompare(b.starts_on))
  if (sprints.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No sprints planned yet. Sprints appear once a group plans one on its board.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'sprints',
      title: 'Sprints',
      columns: [
        ...leadCol,
        { key: 'sprint', label: 'Sprint', type: 'text' },
        { key: 'starts', label: 'Starts', type: 'date' },
        { key: 'ends', label: 'Ends', type: 'date' },
        { key: 'committed', label: 'Committed', type: 'number' },
        { key: 'done', label: 'Done in sprint', type: 'number' },
        { key: 'carried', label: 'Carried over', type: 'number' },
      ],
      rows: sprints.map<Cell[]>((s) => {
        const ended = s.state === 'completed' || s.ends_on < today
        return [...lead(s.board_id), s.name, s.starts_on, s.ends_on, s.tasks, s.done_in_window, ended ? s.tasks - s.done_in_window : null]
      }),
      note: "Done in sprint counts work finished inside the sprint's dates. Carried over is the rest, counted once the sprint has ended.",
    })
  }

  type Event = { board_id: string; at: string; cell: Cell; feedback: string | null; by: string | null }
  const events: Event[] = [
    ...history.map((h) => ({
      board_id: h.board_id,
      at: h.decided_at,
      cell: h.verdict === 'accepted' ? { value: 'Accepted', tone: 'success' as const } : { value: 'Returned', tone: 'warning' as const },
      feedback: h.feedback || null,
      by: h.decided_by_name,
    })),
    ...boards
      .filter((b) => b.submitted_at)
      .map((b) => ({ board_id: b.board_id, at: b.submitted_at as string, cell: { value: 'Handed in', tone: 'pending' as const }, feedback: null, by: b.submitted_by_name })),
  ].sort((a, b) => byName(nameOf.get(a.board_id) ?? '', nameOf.get(b.board_id) ?? '') || Date.parse(a.at) - Date.parse(b.at))
  if (events.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing handed in or answered yet.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'history',
      title: 'Feedback history',
      columns: [
        ...leadCol,
        { key: 'at', label: 'When', type: 'datetime' },
        { key: 'event', label: 'Event', type: 'status' },
        { key: 'feedback', label: 'Feedback', type: 'text' },
        { key: 'by', label: 'By', type: 'text' },
      ],
      rows: events.map<Cell[]>((e) => [...lead(e.board_id), e.at, e.cell, e.feedback, e.by]),
      note: 'Every answer is kept. Collabify keeps the latest hand-in time only.',
    })
  }

  return finish()
}
