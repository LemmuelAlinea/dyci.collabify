import { describe, expect, it } from 'vitest'
import { interventionLogDoc } from './interventionLog'
import type { LogFilters } from './interventionLog'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { NoteLogRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const range = { from: '2026-10-01', to: '2026-10-31' }
const all: LogFilters = { kinds: [], status: 'all', studentId: '', boardId: '' }

const row = (over: Partial<NoteLogRow>): NoteLogRow => ({
  id: 'n', class_id: 'c', student_id: 's1', board_id: null, kind: 'note', body: 'zz', follow_up_on: null,
  resolved_at: null, outcome: '', created_by: 'p', created_at: '2026-10-10T02:00:00Z',
  student_name: 'Ana Cruz', group_name: null, project_title: null, author_name: 'Prof. Reyes', ...over,
})
const notes = [
  row({ id: 'late', created_at: '2026-10-20T02:00:00Z', kind: 'meeting', body: 'Talked' }),
  row({ id: 'early', created_at: '2026-10-05T02:00:00Z', kind: 'follow_up', follow_up_on: '2026-10-08', body: 'Check draft' }),
  row({ id: 'nudge', created_at: '2026-10-06T02:00:00Z', kind: 'nudge', student_id: null, board_id: 'b1', student_name: null, group_name: 'Group 1', project_title: 'Lab 6', body: 'Reminder sent' }),
  row({ id: 'resolved', created_at: '2026-10-07T02:00:00Z', kind: 'follow_up', follow_up_on: '2026-10-09', resolved_at: '2026-10-09T02:00:00Z', outcome: 'Caught up' }),
  row({ id: 'outside', created_at: '2026-09-20T02:00:00Z' }),
]
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('interventionLogDoc', () => {
  const doc = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: all })
  const log = tableBlocks(doc)[0]

  it('keeps notes inside the range, oldest first', () => {
    expect(log.rows.map((r) => r[3])).toEqual(['Check draft', 'Reminder sent', 'zz', 'Talked'])
  })
  it('names what each note is about and who wrote it', () => {
    const nudge = log.rows.find((r) => r[3] === 'Reminder sent')!
    expect(nudge[2]).toBe('Group 1 · Lab 6')
    expect(nudge[1]).toEqual({ value: 'Reminder', tone: 'pending' })
    expect(log.rows[0][7]).toBe('Prof. Reyes')
  })
  it('counts kinds, open and overdue follow-ups, and reminders', () => {
    expect(kpi(doc, 'Follow-up')).toBe(2)
    expect(kpi(doc, 'Meeting')).toBe(1)
    expect(kpi(doc, 'Open follow-ups')).toBe(1)
    expect(kpi(doc, 'Overdue follow-ups')).toBe(1)
    expect(kpi(doc, 'Reminders sent')).toBe(1)
  })
  it('filters by kind, status, student and group', () => {
    const only = (f: Partial<typeof all>) =>
      tableBlocks(interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: { ...all, ...f } }))[0]?.rows.length ?? 0
    expect(only({ kinds: ['meeting'] })).toBe(1)
    expect(only({ status: 'resolved' })).toBe(1)
    expect(only({ status: 'open' })).toBe(3)
    expect(only({ boardId: 'b1' })).toBe(1)
    expect(only({ studentId: 's1' })).toBe(3)
  })
  it('says so when the filters match nothing', () => {
    const none = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: { ...all, kinds: ['peer_reminder'] } })
    expect(tableBlocks(none)).toHaveLength(0)
    expect(none.blocks.some((b) => b.kind === 'note' && b.text === 'No notes in these dates. Widen the dates or add notes from Analytics.')).toBe(true)
    expect(kpi(none, 'Open follow-ups')).toBe(0)
  })
  it('names the student and group filters in the header', () => {
    const label = (f: Partial<LogFilters>, ns = notes) =>
      interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes: ns, filters: { ...all, ...f } }).header.rangeLabel
    expect(label({ studentId: 's1' })).toBe('Student: Ana Cruz')
    expect(label({ boardId: 'b1' })).toBe('Group: Group 1 · Lab 6')
    expect(label({ boardId: 'b1' }, [row({ board_id: 'b1', group_name: 'Group 1', project_title: null })])).toBe('Group: Group 1')
    expect(label({ studentId: 'nobody', boardId: 'none' })).toBe('One student · One group')
    expect(label({})).toBeNull()
  })
  it('orders equal moments by id', () => {
    const same = [
      row({ id: 'b', body: 'second' }),
      row({ id: 'a', body: 'first' }),
    ]
    const d = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes: same, filters: all })
    expect(tableBlocks(d)[0].rows.map((r) => r[3])).toEqual(['first', 'second'])
  })
  it('puts the range edges on Manila days', () => {
    const edge = [
      row({ id: 'nov', created_at: '2026-10-31T17:00:00Z', body: 'Nov 1 in Manila' }),
      row({ id: 'oct', created_at: '2026-09-30T16:30:00Z', body: 'Oct 1 in Manila' }),
    ]
    const d = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes: edge, filters: all })
    expect(tableBlocks(d)[0].rows.map((r) => r[3])).toEqual(['Oct 1 in Manila'])
  })
  it('counts a follow-up due today as open, not overdue', () => {
    const due = [row({ id: 'due', kind: 'follow_up', follow_up_on: '2026-10-14' })]
    const d = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes: due, filters: all })
    expect(kpi(d, 'Open follow-ups')).toBe(1)
    expect(kpi(d, 'Overdue follow-ups')).toBe(0)
  })
  it('carries the staff-only footer', () => {
    expect(doc.footer.lines).toContain('Only teaching staff can read these notes.')
  })
})
