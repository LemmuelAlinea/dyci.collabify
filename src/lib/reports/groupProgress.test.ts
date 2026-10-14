import { describe, expect, it } from 'vitest'
import { groupProgressDoc } from './groupProgress'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { BoardDecision, DeliverableRow, MemberLoad, ReportSprint, TaskState } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const today = '2026-10-14'
const project = { id: 'p1', title: 'Lab 6', audience: 'group' as const, due_at: '2026-10-20T09:00:00Z', archived_at: null, created_at: '2026-09-01T00:00:00Z' }
const task = (over: Partial<TaskState>): TaskState => ({
  task_id: 't', title: 'T', status: 'todo', due_at: null, late: false, weight: 1, started_at: null, done_at: null,
  created_at: '2026-10-01T02:00:00Z', board_id: 'b1', class_id: 'c', project_id: 'p1', project_title: 'Lab 6',
  group_id: 'g1', group_name: 'Group 1', board_student_name: null, assignee_ids: ['s1'], assignee_names: 'Ana Cruz', ...over,
})
const tasks = [
  task({ task_id: 't1', status: 'done', done_at: '2026-10-05T02:00:00Z' }),
  task({ task_id: 't2', status: 'done', done_at: '2026-10-06T02:00:00Z', late: true, assignee_ids: ['s2'], assignee_names: 'Ben Diaz' }),
  task({ task_id: 't3', status: 'in_progress', due_at: '2026-10-10T09:00:00Z', assignee_ids: ['s2'] }),
  task({ task_id: 't4', status: 'todo', due_at: '2026-10-30T09:00:00Z', assignee_ids: [] }),
  task({ task_id: 'x1', board_id: 'b2', group_name: 'Group 2', status: 'done', done_at: '2026-10-07T02:00:00Z' }),
]
const member = (over: Partial<MemberLoad>): MemberLoad => ({
  class_id: 'c', project_id: 'p1', board_id: 'b1', group_name: 'Group 1', project_title: 'Lab 6', student_id: 's1',
  student_name: 'Ana Cruz', avatar_url: null, task_count: 1, done_count: 1, held_pct: 50, personal_pct: 50, group_size: 2,
  first_activity: null, last_finish: null, ...over,
})
const members = [
  member({}),
  member({ student_id: 's2', student_name: 'Ben Diaz', task_count: 2, done_count: 1, personal_pct: 50 }),
  member({ board_id: 'b2', group_name: 'Group 2', student_id: 's3', student_name: 'Cara Uy' }),
]
const milestone = (over: Partial<DeliverableRow>): DeliverableRow => ({
  kind: 'milestone', board_id: 'b1', project_id: 'p1', class_id: 'c', project_title: 'Lab 6', project_archived_at: null,
  group_name: 'Group 1', student_name: null, ref_id: 'm1', title: 'Draft', due_day: '2026-10-07', due_at: null,
  tasks: 2, done: 2, done_at: '2026-10-06T02:00:00Z', days_late: 0, state: 'on_time', ...over,
})
const deliverables = [
  milestone({}),
  milestone({ ref_id: 'm2', title: 'Model', due_day: '2026-10-21', tasks: 1, done: 0, done_at: null, days_late: null, state: 'not_due' }),
  milestone({ board_id: 'b2', group_name: 'Group 2', state: 'missing', done_at: null, days_late: null }),
]
const sprint = (over: Partial<ReportSprint>): ReportSprint => ({
  sprint_id: 'sp1', board_id: 'b1', class_id: 'c', project_id: 'p1', name: 'Sprint 1', starts_on: '2026-09-28',
  ends_on: '2026-10-04', state: 'completed', tasks: 3, done: 2, done_in_window: 1, ...over,
})
const sprints = [sprint({}), sprint({ sprint_id: 'sp2', name: 'Sprint 2', starts_on: '2026-10-12', ends_on: '2026-10-18', state: 'active', tasks: 2, done: 0, done_in_window: 0 })]
const history: BoardDecision[] = [
  { board_id: 'b1', verdict: 'returned', feedback: 'Add the model', decided_at: '2026-10-09T03:00:00Z', decided_by_name: 'Prof. Reyes' },
]
const b1 = { board_id: 'b1', name: 'Group 1', submitted_at: '2026-10-12T03:00:00Z', submitted_by_name: 'Ana Cruz', result_verdict: 'returned' as const, task_count: 4, done_pct: 50 }
const b2 = { board_id: 'b2', name: 'Group 2', submitted_at: null, submitted_by_name: null, result_verdict: null, task_count: 1, done_pct: 100 }
const base = { ...head, project, tasks, members, deliverables, sprints, history, today }
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value
const table = (doc: ReportDoc, title: string) => tableBlocks(doc).find((t) => t.title === title)

describe('groupProgressDoc, one group', () => {
  const doc = groupProgressDoc({ ...base, boards: [b1], single: true })
  it('heads the report with the group and project', () => {
    expect(doc.header.title).toBe('Group progress report')
    expect(doc.header.subtitle).toBe('Group 1 · Lab 6')
  })
  it('counts done, tasks, late tasks, the hand-in and the verdict', () => {
    expect(kpi(doc, 'Done')).toBe(50)
    expect(kpi(doc, 'Tasks')).toBe(4)
    expect(kpi(doc, 'Late tasks')).toBe(2) // t2 finished late, t3 open past its due day
    expect(kpi(doc, 'Hand-in')).toBe('Handed in Oct 12, 2026')
    expect(kpi(doc, 'Verdict')).toBe('Waiting for you') // handed in again after the return
  })
  it('charts scope against done over the project, to the due day', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart?.kind === 'chart' && chart.chart.kind === 'burnup' && chart.chart.endDay).toBe('2026-10-20')
    expect(chart?.kind === 'chart' && chart.summary).toBe('2 of 4 tasks done by Oct 14, 2026. The project is due Oct 20, 2026.')
  })
  it('lists members with share, finished, held and late', () => {
    expect(table(doc, 'Members')?.rows).toEqual([
      ['Ana Cruz', 50, 1, 1, 0],
      ['Ben Diaz', 50, 1, 2, 2],
    ])
  })
  it('lists milestones with the compliance state', () => {
    const t = table(doc, 'Milestones')!
    expect(t.rows.map((r) => [r[0], r[2], r[3]])).toEqual([['Draft', 2, 2], ['Model', 0, 1]])
    expect(t.rows[0][4]).toEqual({ value: 'On time', tone: 'success', exportValue: 0 })
  })
  it('lists sprints, with carried over only once a sprint has ended', () => {
    expect(table(doc, 'Sprints')?.rows).toEqual([
      ['Sprint 1', '2026-09-28', '2026-10-04', 3, 1, 2],
      ['Sprint 2', '2026-10-12', '2026-10-18', 2, 0, null],
    ])
  })
  it('lists every answer and the current hand-in, oldest first', () => {
    const t = table(doc, 'Feedback history')!
    expect(t.rows.map((r) => [r[0], typeof r[1] === 'object' && r[1] ? r[1].value : r[1], r[2], r[3]])).toEqual([
      ['2026-10-09T03:00:00Z', 'Returned', 'Add the model', 'Prof. Reyes'],
      ['2026-10-12T03:00:00Z', 'Handed in', null, 'Ana Cruz'],
    ])
  })
})

describe('groupProgressDoc, every group', () => {
  const doc = groupProgressDoc({ ...base, boards: [b2, b1], single: false })
  it('overviews every group in name order', () => {
    expect(doc.header.subtitle).toBe('Lab 6 · every group')
    const t = table(doc, 'Groups')!
    expect(t.columns[0].label).toBe('Group')
    expect(t.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2'])
    expect(kpi(doc, 'Handed in')).toBe('1 of 2')
  })
  it('draws one burnup per group on one scale', () => {
    const charts = doc.blocks.filter((b) => b.kind === 'chart')
    expect(charts).toHaveLength(2)
    const maxes = charts.map((c) => (c.kind === 'chart' && c.chart.kind === 'burnup' ? c.chart.yMax : 0))
    expect(maxes).toEqual([4, 4])
  })
  it('combines the tables with a group column', () => {
    expect(table(doc, 'Members')?.columns[0].label).toBe('Group')
    expect(table(doc, 'Milestones')?.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 1', 'Group 2'])
  })
})

describe('groupProgressDoc, edges', () => {
  it('leaves out members on an individual project and names the student', () => {
    const solo = { ...project, audience: 'individual' as const }
    const doc = groupProgressDoc({ ...base, project: solo, boards: [{ ...b2, name: 'Ana Cruz' }], single: false, members: [] })
    expect(table(doc, 'Members')).toBeUndefined()
    expect(table(doc, 'Students')?.columns[0].label).toBe('Student')
    expect(doc.header.subtitle).toBe('Lab 6 · every student')
  })
  it('says what is empty instead of drawing empty tables', () => {
    const doc = groupProgressDoc({ ...base, boards: [b2], single: true, tasks: [], members: [], deliverables: [], sprints: [], history: [] })
    const texts = doc.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))
    expect(texts).toEqual(expect.arrayContaining([
      'No tasks on this board yet, so there is nothing to chart.',
      'This project has no milestones.',
      'No sprints planned yet.',
      'Nothing handed in or answered yet.',
    ]))
    expect(tableBlocks(doc).map((t) => t.title)).toEqual([])
  })
  it('marks an archived project', () => {
    const doc = groupProgressDoc({ ...base, project: { ...project, archived_at: '2026-10-13T00:00:00Z' }, boards: [b1], single: true })
    expect(doc.blocks.some((b) => b.kind === 'note' && b.text === 'This project is archived. The report shows it as it was left.')).toBe(true)
  })
})
