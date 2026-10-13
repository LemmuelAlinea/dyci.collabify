import { describe, expect, it } from 'vitest'
import { checkInAsOf, checkInDoc, liveProjects, onProjects, weekFigures } from './checkIn'
import type { CheckInInput } from './checkIn'
import { tableBlocks } from './doc'
import type { Cell, ReportDoc } from './doc'
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

const project = (id: string, title: string, over: Partial<CheckInInput['projects'][number]> = {}) => ({
  id, title, due_at: null, release_at: null, archived_at: null, created_at: '2026-09-01T00:00:00Z', ...over,
})

// Measured after the week has ended, so as-of is the last day of the range.
const base: CheckInInput = {
  ...head, range: week, today: '2026-10-25', termStart: '2026-09-01', ended: false,
  activity: [
    act('2026-10-13', 'finished', 3), act('2026-10-13', 'started', 2), act('2026-10-14', 'commented', 4),
    act('2026-10-06', 'finished', 1),
  ],
  tasks: [
    task({ task_id: 't1', title: 'Write the model', status: 'in_progress', started_at: '2026-10-05T01:00:00Z' }),
    task({ task_id: 't2', title: 'Due soon', due_at: '2026-10-20T15:00:00Z' }),
  ],
  boards: [
    { board_id: 'b1', project_id: 'p1', name: 'Group 1', project_title: 'Lab 6', submitted_at: '2026-10-16T02:00:00Z' },
    { board_id: 'b2', project_id: 'p1', name: 'Group 2', project_title: 'Lab 6', submitted_at: null },
  ],
  results: [{ board_id: 'b2', verdict: 'returned', decided_at: '2026-10-14T03:00:00Z' }],
  roster: [student('s1', 'Ana Cruz'), student('s2', 'Ben Diaz')],
  milestones: [],
  projects: [project('p1', 'Lab 6', { due_at: '2026-10-22T15:00:00Z' })],
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
    const boards = [{ board_id: 'b1', project_id: 'p1', name: 'Group 1', project_title: 'Lab 6', submitted_at: '2026-10-11T17:00:00Z' }]
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
      table(checkInDoc({ ...base, projects: [project('p1', 'Lab 6')], tasks: [task({ title: 'Due soon', status: 'done', due_at: due, done_at })] }), 'coming')
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

const has = (doc: ReportDoc, id: string, name: string) => table(doc, id)?.rows.some((r) => r.includes(name)) ?? false
const noteText = (doc: ReportDoc) => doc.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))

describe('checkInAsOf', () => {
  it('is the last day of a range that has ended, and today while it runs', () => {
    expect(checkInAsOf(week, '2026-10-25')).toBe('2026-10-18')
    expect(checkInAsOf(week, '2026-10-18')).toBe('2026-10-18')
    expect(checkInAsOf(week, '2026-10-14')).toBe('2026-10-14')
  })
})

describe('a range that is still running', () => {
  // "This week" opened on Monday Oct 12.
  const monday = checkInDoc({
    ...base,
    today: '2026-10-12',
    activity: [act('2026-10-11', 'finished', 1, 's1'), act('2026-10-11', 'finished', 1, 's2', 'b2')],
    tasks: [
      task({ task_id: 't1', title: 'Started Friday', status: 'in_progress', started_at: '2026-10-09T01:00:00Z' }),
      task({ task_id: 't2', title: 'Due Wednesday', due_at: '2026-10-14T03:00:00Z' }),
    ],
    boards: base.boards.map((b) => ({ ...b, submitted_at: null })),
    projects: [project('p1', 'Lab 6')],
    notes: [],
  })

  it('never measures past today', () => {
    expect(has(monday, 'stuck', 'Started Friday')).toBe(false)
    expect(has(monday, 'stuck', 'Ana Cruz')).toBe(false)
    expect(has(monday, 'stuck', 'Ben Diaz')).toBe(false)
  })
  it('lists what falls due in the 7 days after today', () => {
    expect(table(monday, 'coming')!.rows.map((r) => r[2])).toEqual(['Due Wednesday'])
    const quiet = checkInDoc({ ...base, today: '2026-10-12', tasks: [], projects: [project('p1', 'Lab 6')] })
    expect(noteText(quiet)).toContain('Nothing falls due between Oct 13 and Oct 19.')
  })
  it('compares the days so far with as many days just before', () => {
    const wed = checkInDoc({
      ...base,
      today: '2026-10-14',
      activity: [
        act('2026-10-13', 'finished', 3), act('2026-10-16', 'finished', 9),
        act('2026-10-09', 'finished', 1), act('2026-10-08', 'finished', 7),
      ],
    })
    expect(kpi(wed, 'Tasks finished')).toMatchObject({ value: 3, delta: 2 })
    const block = wed.blocks.find((b) => b.kind === 'kpis')
    expect(block && block.kind === 'kpis' && block.compareLabel).toBe('Oct 9 to Oct 11, 2026')
    expect(wed.header.rangeLabel).toBe('Compared with Oct 9 to Oct 11, 2026')
    expect(noteText(wed)).toContain('This week so far: Oct 12 to Oct 14, 2026.')
  })
  it('says nothing about a partial range once it has ended', () => {
    expect(noteText(checkInDoc(base)).some((t) => t.includes('so far'))).toBe(false)
  })
  it('reads 0 for dates that have not started', () => {
    const ahead = checkInDoc({ ...base, today: '2026-10-05' })
    expect(kpi(ahead, 'Tasks finished')).toMatchObject({ value: 0 })
    expect(noteText(ahead)).toContain('These dates have not started yet, so every count reads 0.')
  })
})

describe('live, released projects only', () => {
  const extra: Partial<CheckInInput> = {
    projects: [
      project('p1', 'Lab 6'),
      project('p2', 'Old lab', { archived_at: '2026-10-01T00:00:00Z' }),
      project('p3', 'Next lab', { release_at: '2026-10-30T00:00:00Z' }),
    ],
    boards: [
      ...base.boards,
      { board_id: 'b3', project_id: 'p2', name: 'Group 3', project_title: 'Old lab', submitted_at: '2026-10-13T02:00:00Z' },
      { board_id: 'b4', project_id: 'p3', name: 'Group 4', project_title: 'Next lab', submitted_at: null },
    ],
    tasks: [
      ...base.tasks,
      task({
        task_id: 't3', title: 'Archived task', status: 'in_progress', started_at: '2026-10-01T00:00:00Z',
        due_at: '2026-10-20T00:00:00Z', board_id: 'b3', project_id: 'p2', project_title: 'Old lab',
      }),
    ],
    activity: [...base.activity, { ...act('2026-10-13', 'finished', 40, 's1', 'b3'), project_id: 'p2' }],
    milestones: [{ milestone_id: 'm', project_id: 'p2', board_id: 'b3', class_id: 'c', name: 'Old milestone', due_on: '2026-10-20', tasks: 1, done: 0, last_done_at: null }],
    results: [...base.results, { board_id: 'b3', verdict: 'returned', decided_at: '2026-10-14T03:00:00Z' }],
    actions: [
      ...base.actions,
      { key: 'x', kind: 'stalled_board', severity: 1, title: 'Group 3 has stopped', evidence: '', to: null, classId: 'c', boardId: 'b3', projectId: 'p2' },
    ],
  }
  const doc = checkInDoc({ ...base, ...extra })

  it('leaves an archived project out of every table and figure', () => {
    for (const id of ['moved', 'stuck', 'coming', 'attention']) {
      for (const name of ['Group 3', 'Archived task', 'Old milestone', 'Group 3 has stopped', 'Old lab']) {
        expect(has(doc, id, name)).toBe(false)
      }
    }
    expect(kpi(doc, 'Tasks finished')).toMatchObject({ value: 3 })
    expect(kpi(doc, 'Hand-ins')).toMatchObject({ value: 1 })
    expect(kpi(doc, 'Returns')).toMatchObject({ value: 1 })
  })
  it("does not call an unreleased project's groups never active", () => {
    expect(has(doc, 'stuck', 'Group 4')).toBe(false)
    expect(has(doc, 'moved', 'Group 4')).toBe(false)
  })
  it('gives the groups of a project released yesterday time before calling them never active', () => {
    const fresh = (release: string) => checkInDoc({ ...base, projects: [project('p1', 'Lab 6', { release_at: release })] })
    expect(has(fresh('2026-10-17T00:00:00Z'), 'stuck', 'Group 2')).toBe(false)
    expect(has(fresh('2026-10-10T00:00:00Z'), 'stuck', 'Group 2')).toBe(true)
  })
  it('measures a never-active group from when its project was made, when it has no release date', () => {
    const made = (created_at: string) => checkInDoc({ ...base, projects: [project('p1', 'Lab 6', { created_at })] })
    expect(has(made('2026-10-15T00:00:00Z'), 'stuck', 'Group 2')).toBe(false)
    expect(has(made('2026-10-01T00:00:00Z'), 'stuck', 'Group 2')).toBe(true)
  })
})

describe('liveProjects and onProjects', () => {
  it('keeps projects that are not archived and are released by the day', () => {
    const ps = [
      project('a', 'A'),
      project('b', 'B', { archived_at: '2026-10-01T00:00:00Z' }),
      project('c', 'C', { release_at: '2026-10-18T15:30:00Z' }),
      project('d', 'D', { release_at: '2026-10-17T15:30:00Z' }),
    ]
    // 15:30 UTC is 23:30 in Manila, the same day.
    expect(liveProjects(ps, '2026-10-17').map((p) => p.id)).toEqual(['a', 'd'])
    expect(liveProjects(ps, '2026-10-18').map((p) => p.id)).toEqual(['a', 'c', 'd'])
  })
  it('keeps rows on those projects, and rows on no project', () => {
    const rows = [{ project_id: 'a' }, { project_id: 'b' }, { project_id: null }]
    expect(onProjects(rows, new Set(['a']))).toEqual([{ project_id: 'a' }, { project_id: null }])
  })
})

describe('follow-ups under Needs attention', () => {
  const rows = (notes: ClassNote[]) => table(checkInDoc({ ...base, actions: [], notes }), 'attention')?.rows ?? []
  const level = (r: Cell[]) => (r[0] as { value: string }).value

  it('keeps an open follow-up due before the range, marked overdue', () => {
    const r = rows([note({ id: 'o', follow_up_on: '2026-10-07' })])
    expect(r).toHaveLength(1)
    expect(r[0][0]).toEqual({ value: 'Overdue', tone: 'danger' })
    expect(String(r[0][2])).toContain('Was due Oct 7.')
  })
  it('drops one resolved by the end of the range and keeps one resolved after it', () => {
    expect(rows([note({ follow_up_on: '2026-10-07', resolved_at: '2026-10-17T00:00:00Z' })])).toHaveLength(0)
    expect(rows([note({ follow_up_on: '2026-10-07', resolved_at: '2026-10-20T00:00:00Z' })])).toHaveLength(1)
  })
  it('lists each once, through 7 days after the range, oldest first', () => {
    const r = rows([
      note({ id: 'a', follow_up_on: '2026-10-25' }),
      note({ id: 'b', follow_up_on: '2026-10-26' }),
      note({ id: 'c', follow_up_on: '2026-10-15' }),
      note({ id: 'd', follow_up_on: '2026-10-18' }),
    ])
    expect(r.map(level)).toEqual(['Overdue', 'Follow-up', 'Follow-up'])
    expect(r.map((x) => String(x[2]).slice(0, 20))).toEqual(['Was due Oct 15. Note', 'Due Oct 18. Noted: C', 'Due Oct 25. Noted: C'])
  })
})

describe('section headings', () => {
  it('say this week only for a 7-day range', () => {
    expect(table(checkInDoc(base), 'moved')!.title).toBe('Moved this week')
    const month = checkInDoc({ ...base, range: { from: '2026-09-19', to: '2026-10-18' } })
    expect(table(month, 'moved')!.title).toBe('Moved in these dates')
  })
})

describe('a week with no activity at all', () => {
  it('lists the idle groups and students, and reads 0 everywhere', () => {
    const quiet = checkInDoc({
      ...base,
      activity: [act('2026-09-28', 'finished', 2, 's1', 'b1')],
      results: [],
      notes: [],
      actions: [],
      boards: base.boards.map((b) => ({ ...b, submitted_at: null })),
      tasks: [],
    })
    for (const label of ['Tasks finished', 'Tasks started', 'Hand-ins', 'Returns', 'Comments', 'Students active']) {
      expect(kpi(quiet, label)).toMatchObject({ value: 0 })
    }
    expect(table(quiet, 'moved')!.rows.every((r) => r[2] === 0 && r[3] === 0 && r[4] === 0 && r[5] === null && r[6] === 0)).toBe(true)
    const stuck = table(quiet, 'stuck')!
    expect(stuck.rows.find((r) => r[1] === 'Group 1')).toEqual([{ value: 'Group', tone: 'warning' }, 'Group 1', 'Lab 6', '2026-09-28', 20])
    expect(stuck.rows.find((r) => r[1] === 'Group 2')).toEqual([{ value: 'Group', tone: 'warning' }, 'Group 2', 'Lab 6', null, null])
    expect(stuck.rows.find((r) => r[1] === 'Ana Cruz')?.[4]).toBe(20)
    expect(stuck.rows.find((r) => r[1] === 'Ben Diaz')?.[3]).toBeNull()
    const chart = quiet.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.kind === 'weekBars' && chart.chart.rows.length).toBe(8)
  })
})

describe('stuck tasks', () => {
  it('come longest first', () => {
    const doc = checkInDoc({
      ...base,
      tasks: [
        task({ task_id: 'a', title: 'Ten days', status: 'in_progress', started_at: '2026-10-08T01:00:00Z' }),
        task({ task_id: 'b', title: 'Twenty days', status: 'in_progress', started_at: '2026-09-28T01:00:00Z' }),
      ],
    })
    const tasks = table(doc, 'stuck')!.rows.filter((r) => (r[0] as { value: string }).value === 'Task').map((r) => r[1])
    expect(tasks).toEqual(['Twenty days', 'Ten days'])
  })
})
