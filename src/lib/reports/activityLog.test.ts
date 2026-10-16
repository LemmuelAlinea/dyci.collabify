import { describe, expect, it } from 'vitest'
import { EVENT_CAP, activityFilters, activityLogDoc } from './activityLog'
import type { ActivityFilters } from './activityLog'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { ReportEventRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 16, 2026' }
const range = { from: '2026-10-01', to: '2026-10-15' }
const none: ActivityFilters = { kinds: [], projectId: '', boardId: '', actorId: '' }
const labels = { project: null, board: null, actor: null }

const ev = (over: Partial<ReportEventRow>): ReportEventRow => ({
  id: 'e', at: '2026-10-10T02:00:00Z', kind: 'claimed', detail: '', actor_id: 's1', actor_name: 'Ana Cruz',
  task_id: 't1', task_title: 'Write the model', board_id: 'b1', board_name: 'Group 1',
  project_id: 'p1', project_title: 'Lab 6', project_archived_at: null, class_id: 'c', ...over,
})
const events = [
  ev({ id: 'a', at: '2026-10-02T01:00:00Z', kind: 'created', actor_id: 'prof', actor_name: 'Prof. Reyes' }),
  ev({ id: 'b', at: '2026-10-05T01:00:00Z', kind: 'claimed' }),
  ev({ id: 'c', at: '2026-10-09T01:00:00Z', kind: 'finished', board_id: 'b2', board_name: 'Group 2', actor_id: 's2', actor_name: 'Ben Lim' }),
  ev({ id: 'd', at: '2026-10-11T01:00:00Z', kind: 'commented', detail: 'Looks fine', project_id: 'p2', project_title: 'Midterm', board_id: 'b3', board_name: 'Ana Cruz' }),
]
const doc = (over: Partial<Parameters<typeof activityLogDoc>[0]> = {}): ReportDoc =>
  activityLogDoc({ ...head, range, events, filters: none, labels, ...over })
const table = (d: ReportDoc) => tableBlocks(d)[0]

describe('activityLogDoc', () => {
  it('lists every event in the range, newest first', () => {
    expect(table(doc()).rows.map((r) => r[3])).toEqual(['Write the model', 'Write the model', 'Write the model', 'Write the model'])
    expect(table(doc()).rows.map((r) => r[0])).toEqual([
      '2026-10-11T01:00:00Z', '2026-10-09T01:00:00Z', '2026-10-05T01:00:00Z', '2026-10-02T01:00:00Z',
    ])
  })
  it('prints time, who, event, task, group, project and detail', () => {
    const t = table(doc())
    expect(t.columns.map((c) => c.label)).toEqual(['Time', 'Who', 'Event', 'Task', 'Group or student', 'Project', 'Detail'])
    expect(t.columns[0].type).toBe('datetime')
    expect(t.rows[0]).toEqual([
      '2026-10-11T01:00:00Z', 'Ana Cruz', { value: 'Commented', tone: 'pending' }, 'Write the model', 'Ana Cruz', 'Midterm', 'Looks fine',
    ])
    expect(t.rows[1][2]).toEqual({ value: 'Finished', tone: 'success' })
    expect(t.rows[3][6]).toBeNull()
  })
  it('says when the account behind an event is gone', () => {
    const t = table(doc({ events: [ev({ actor_id: null, actor_name: null })] }))
    expect(t.rows[0][1]).toBe('Not recorded')
  })
  it('tags a project that has been archived', () => {
    const t = table(doc({ events: [ev({ project_archived_at: '2026-10-12T00:00:00Z' })] }))
    expect(t.rows[0][5]).toEqual({ value: 'Lab 6', tag: 'Archived', tone: 'pending' })
  })
  it('filters by kind, project, group and who', () => {
    expect(table(doc({ filters: { ...none, kinds: ['finished', 'created'] } })).rows).toHaveLength(2)
    expect(table(doc({ filters: { ...none, projectId: 'p2' } })).rows).toHaveLength(1)
    expect(table(doc({ filters: { ...none, boardId: 'b2' } })).rows.map((r) => r[1])).toEqual(['Ben Lim'])
    expect(table(doc({ filters: { ...none, actorId: 'prof' } })).rows.map((r) => r[1])).toEqual(['Prof. Reyes'])
  })
  it('keeps an event at 23:59 Manila on the last day and drops one at midnight after it', () => {
    const edge = [
      ev({ id: 'in', at: '2026-10-15T15:59:00Z' }),
      ev({ id: 'out', at: '2026-10-15T16:00:00Z' }),
      ev({ id: 'first', at: '2026-09-30T16:00:00Z' }),
      ev({ id: 'before', at: '2026-09-30T15:59:00Z' }),
    ]
    expect(table(doc({ events: edge })).rows.map((r) => r[0])).toEqual(['2026-10-15T15:59:00Z', '2026-09-30T16:00:00Z'])
  })
  it('caps the screen at 500 rows and keeps every row for the exports', () => {
    const many = Array.from({ length: 600 }, (_, i) => ev({ id: `x${String(i).padStart(3, '0')}` }))
    const t = table(doc({ events: many }))
    expect(EVENT_CAP).toBe(500)
    expect(t.cap).toBe(500)
    expect(t.rows).toHaveLength(600)
  })
  it('says what to do when nothing matches', () => {
    const d = doc({ filters: { ...none, kinds: ['file_removed'] } })
    expect(tableBlocks(d)).toHaveLength(0)
    expect(d.blocks).toContainEqual({ kind: 'note', tone: 'info', text: 'No activity in these dates. Widen the dates or clear a filter.' })
  })
  it('heads the sheet with the dates and the filters', () => {
    const d = doc({
      filters: { kinds: ['claimed', 'finished'], projectId: 'p1', boardId: 'b1', actorId: 's1' },
      labels: { project: 'Lab 6', board: 'Group 1 · Lab 6', actor: 'Cruz, Ana' },
    })
    expect(d.header.title).toBe('Activity log')
    expect(d.header.subtitle).toBe('Oct 1 to Oct 15, 2026')
    expect(d.header.rangeLabel).toBe('Claimed, Finished · Project: Lab 6 · Group: Group 1 · Lab 6 · Who: Cruz, Ana')
    expect(doc().header.rangeLabel).toBeNull()
  })
  it('signs and explains the record', () => {
    const d = doc()
    expect(d.footer.lines).toEqual([
      'Times are Manila time, to the minute.',
      'Archived and deleted tasks are left out, and so is their history.',
    ])
    expect(d.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }])
  })
})

describe('activityFilters', () => {
  const known = { projects: new Set(['p1']), boards: new Set(['b1']), actors: new Set(['s1']) }
  it('keeps ids this class has', () => {
    const f = { kinds: ['claimed' as const], projectId: 'p1', boardId: 'b1', actorId: 's1' }
    expect(activityFilters(f, known)).toEqual(f)
  })
  it('reads an id from another class, or an unknown kind, as no filter', () => {
    const raw = { kinds: ['claimed', 'toString'] as never[], projectId: 'px', boardId: 'bx', actorId: 'sx' }
    expect(activityFilters(raw, known)).toEqual({ kinds: ['claimed'], projectId: '', boardId: '', actorId: '' })
  })
})
