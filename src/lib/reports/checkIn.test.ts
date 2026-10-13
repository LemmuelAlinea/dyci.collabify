import { describe, expect, it } from 'vitest'
import { checkInDoc, weekFigures } from './checkIn'
import type { CheckInInput } from './checkIn'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { ActivityDay, ClassNote, RosterRow, TaskState } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const week = { from: '2026-10-12', to: '2026-10-18' }

const act = (day: string, kind: ActivityDay['kind'], n: number, actor = 's1', board = 'b1'): ActivityDay => ({
  class_id: 'c', project_id: 'p1', board_id: board, actor_id: actor, day, kind, n,
})
const task = (over: Partial<TaskState>): TaskState => ({
  task_id: 't', title: 'Task', status: 'todo', due_at: null, late: false, weight: 1, started_at: null, done_at: null,
  created_at: '2026-10-01T00:00:00Z', board_id: 'b1', class_id: 'c', project_id: 'p1', project_title: 'Lab 6',
  group_id: 'g1', group_name: 'Group 1', board_student_name: null, assignee_ids: [], assignee_names: '', ...over,
})
const student = (id: string, name: string): RosterRow => ({
  class_id: 'c', student_id: id, student_name: name, avatar_url: null, group_names: ['Group 1'], held: 1, done: 0,
  late: 0, worklog_minutes: 0, comments: 0, last_active_at: null,
})
const note = (over: Partial<ClassNote>): ClassNote => ({
  id: 'n', class_id: 'c', student_id: 's1', board_id: null, kind: 'follow_up', body: 'Check the draft',
  follow_up_on: '2026-10-15', resolved_at: null, outcome: '', created_by: 'p', created_at: '2026-10-10T00:00:00Z', ...over,
})

const base: CheckInInput = {
  ...head, range: week, termStart: '2026-09-01', ended: false,
  activity: [
    act('2026-10-13', 'finished', 3), act('2026-10-13', 'started', 2), act('2026-10-14', 'commented', 4),
    act('2026-10-06', 'finished', 1),
  ],
  tasks: [
    task({ task_id: 't1', title: 'Write the model', status: 'in_progress', started_at: '2026-10-05T01:00:00Z' }),
    task({ task_id: 't2', title: 'Due soon', due_at: '2026-10-20T15:00:00Z' }),
  ],
  boards: [
    { board_id: 'b1', name: 'Group 1', project_title: 'Lab 6', submitted_at: '2026-10-16T02:00:00Z' },
    { board_id: 'b2', name: 'Group 2', project_title: 'Lab 6', submitted_at: null },
  ],
  results: [{ board_id: 'b2', verdict: 'returned', decided_at: '2026-10-14T03:00:00Z' }],
  roster: [student('s1', 'Ana Cruz'), student('s2', 'Ben Diaz')],
  milestones: [],
  projects: [{ id: 'p1', title: 'Lab 6', due_at: '2026-10-22T15:00:00Z' }],
  actions: [{ key: 'a', kind: 'stalled_board', severity: 1, title: 'Group 2 has stopped', evidence: 'Nothing moved.', to: null, classId: 'c', boardId: 'b2', projectId: 'p1' }],
  notes: [note({ id: 'n1' }), note({ id: 'n2', follow_up_on: '2026-10-16', resolved_at: '2026-10-16T00:00:00Z' })],
  noteName: (n) => (n.student_id === 's1' ? 'Ana Cruz' : 'Group 2'),
}

const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)
const table = (doc: ReportDoc, id: string) => tableBlocks(doc).find((t) => t.id === id)

describe('weekFigures', () => {
  it('counts events, hand-ins, returns and active students inside the range only', () => {
    expect(weekFigures(base, week)).toEqual({ finished: 3, started: 2, comments: 4, handIns: 1, returns: 1, active: 1 })
    expect(weekFigures(base, { from: '2026-10-05', to: '2026-10-11' }).finished).toBe(1)
  })
  it('counts a hand-in made just after Manila midnight on the first day', () => {
    const boards = [{ board_id: 'b1', name: 'Group 1', project_title: 'Lab 6', submitted_at: '2026-10-11T17:00:00Z' }]
    expect(weekFigures({ ...base, boards }, week).handIns).toBe(1)
    expect(weekFigures({ ...base, boards }, { from: '2026-10-05', to: '2026-10-11' }).handIns).toBe(0)
  })
})

describe('checkInDoc', () => {
  const doc = checkInDoc(base)

  it('shows each figure with its change from the week before', () => {
    expect(kpi(doc, 'Tasks finished')).toMatchObject({ value: 3, delta: 2 })
    expect(kpi(doc, 'Tasks started')).toMatchObject({ value: 2, delta: 2 })
    expect(kpi(doc, 'Students active')).toMatchObject({ value: 1, delta: 0 })
    const block = doc.blocks.find((b) => b.kind === 'kpis')
    expect(block && block.kind === 'kpis' && block.compareLabel).toBe('Oct 5 to Oct 11, 2026')
  })
  it('lists every group with what moved', () => {
    const moved = table(doc, 'moved')!
    expect(moved.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2'])
    expect(moved.rows[0]).toEqual(['Group 1', 'Lab 6', 3, 2, 4, '2026-10-16T02:00:00Z', 0])
    expect(moved.rows[1][6]).toBe(1)
  })
  it('measures stuck work and idle people as of the last day of the range', () => {
    const stuck = table(doc, 'stuck')!
    const kinds = stuck.rows.map((r) => (r[0] as { value: string }).value)
    expect(kinds).toContain('Task')
    expect(kinds).toContain('Group')
    expect(kinds).toContain('Student')
    const t = stuck.rows.find((r) => r[1] === 'Write the model')!
    expect(t[4]).toBe(13)
    expect(stuck.rows.some((r) => r[1] === 'Ben Diaz')).toBe(true)
    expect(stuck.rows.some((r) => r[1] === 'Ana Cruz')).toBe(false)
  })
  it('keeps a task stuck that finished only after the range ended', () => {
    const late = checkInDoc({ ...base, tasks: [task({ task_id: 't1', title: 'Write the model', status: 'done', started_at: '2026-10-05T01:00:00Z', done_at: '2026-10-20T01:00:00Z' })] })
    expect(table(late, 'stuck')!.rows.some((r) => r[1] === 'Write the model')).toBe(true)
    const early = checkInDoc({ ...base, tasks: [task({ task_id: 't1', title: 'Write the model', status: 'done', started_at: '2026-10-05T01:00:00Z', done_at: '2026-10-17T01:00:00Z' })] })
    expect(table(early, 'stuck')!.rows.some((r) => r[1] === 'Write the model')).toBe(false)
  })
  it('counts a task stuck at exactly 7 days in progress, not 6', () => {
    const at = (started_at: string) => checkInDoc({ ...base, tasks: [task({ title: 'Edge', status: 'in_progress', started_at })] })
    expect(table(at('2026-10-11T04:00:00Z'), 'stuck')!.rows.some((r) => r[1] === 'Edge')).toBe(true)
    expect(table(at('2026-10-12T04:00:00Z'), 'stuck')!.rows.some((r) => r[1] === 'Edge')).toBe(false)
  })
  it('counts a student idle at exactly 7 days, not 6', () => {
    const only = (day: string) => checkInDoc({ ...base, activity: [act(day, 'finished', 1, 's1')], roster: [student('s1', 'Ana Cruz')], boards: [] })
    expect(table(only('2026-10-11'), 'stuck')!.rows.some((r) => r[1] === 'Ana Cruz')).toBe(true)
    const six = table(only('2026-10-12'), 'stuck')
    expect(six === undefined || !six.rows.some((r) => r[1] === 'Ana Cruz')).toBe(true)
  })
  it('lists never-active groups and students only once the term has started', () => {
    const never = (termStart: string | null) => table(checkInDoc({ ...base, termStart }), 'stuck')!
    expect(never('2026-09-01').rows.some((r) => r[1] === 'Ben Diaz')).toBe(true)
    expect(never('2026-09-01').rows.some((r) => r[1] === 'Group 2')).toBe(true)
    expect(never(null).rows.some((r) => r[1] === 'Ben Diaz' || r[1] === 'Group 2')).toBe(false)
    expect(never('2026-10-19').rows.some((r) => r[1] === 'Ben Diaz' || r[1] === 'Group 2')).toBe(false)
  })
  it('lists what falls due in the 7 days after the range', () => {
    const coming = table(doc, 'coming')!
    expect(coming.rows.map((r) => [r[1], r[2]])).toEqual([['Task', 'Due soon'], ['Project', 'Lab 6']])
  })
  it('lists a task due in the window that was finished only after the range ended', () => {
    const due = '2026-10-20T15:00:00Z'
    const rows = (done_at: string) =>
      table(checkInDoc({ ...base, projects: [], tasks: [task({ title: 'Due soon', status: 'done', due_at: due, done_at })] }), 'coming')
    expect(rows('2026-10-19T01:00:00Z')!.rows.map((r) => r[2])).toEqual(['Due soon'])
    expect(rows('2026-10-17T01:00:00Z')).toBeUndefined()
  })
  it('lists the ranked actions, then open follow-ups due in the range', () => {
    const attention = table(doc, 'attention')!
    expect(attention.rows.map((r) => r[1])).toEqual(['Group 2 has stopped', 'Follow up with Ana Cruz'])
  })
  it('leaves activity after the range out of the chart', () => {
    const late = checkInDoc({ ...base, activity: [...base.activity, act('2026-10-20', 'finished', 50)] })
    const chart = late.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.kind === 'weekBars' && chart.chart.rows.at(-1)).toMatchObject({ work: 5, talk: 4 })
    expect(chart && chart.kind === 'chart' && chart.summary).toContain('The week ending Oct 18')
  })
  it('charts the 8 weeks ending on the range', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.kind === 'weekBars' && chart.chart.rows.length).toBe(8)
  })
  it('says so in words when nothing happened', () => {
    // No boards, nobody on the roster, nothing due: idle groups and students would otherwise be "stuck".
    const quiet = checkInDoc({ ...base, activity: [], results: [], tasks: [], actions: [], notes: [],
      boards: [], roster: [], projects: [], milestones: [] })
    expect(kpi(quiet, 'Tasks finished')).toMatchObject({ value: 0, delta: 0 })
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text === 'This class has no project boards yet.')).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing is stuck'))).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing falls due'))).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing needs you'))).toBe(true)
  })
  it('says the class has ended instead of reporting on it', () => {
    const ended = checkInDoc({ ...base, ended: true })
    expect(ended.blocks).toEqual([{ kind: 'note', tone: 'info', text: 'This class has ended. The weekly check-in covers live classes.' }])
  })
})
