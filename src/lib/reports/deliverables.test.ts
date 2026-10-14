import { describe, expect, it } from 'vitest'
import { countableBoard, deliverableCell, deliverableLabel, deliverablesDoc } from './deliverables'
import { docToWorkbook } from './export'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { DeliverableRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const row = (over: Partial<DeliverableRow>): DeliverableRow => ({
  kind: 'milestone', board_id: 'b1', project_id: 'p1', class_id: 'c', project_title: 'Lab 6', project_archived_at: null,
  group_name: 'Group 1', student_name: null, ref_id: 'm1', title: 'Draft', due_day: '2026-10-07', due_at: null,
  tasks: 2, done: 2, done_at: '2026-10-06T02:00:00Z', days_late: 0, state: 'on_time', ...over,
})
const handIn = (over: Partial<DeliverableRow>) =>
  row({ kind: 'hand_in', ref_id: 'p1', title: 'Hand-in', due_day: '2026-10-20', due_at: '2026-10-20T09:00:00Z', tasks: null, done: null, ...over })
const rows: DeliverableRow[] = [
  row({}),
  row({ board_id: 'b2', group_name: 'Group 2', done_at: '2026-10-10T02:00:00Z', days_late: 3, state: 'late' }),
  row({ board_id: 'b10', group_name: 'Group 10', done: 1, done_at: null, days_late: null, state: 'missing' }),
  handIn({ done_at: null, days_late: null, state: 'not_due' }),
  handIn({ board_id: 'b2', group_name: 'Group 2', done_at: '2026-10-21T01:00:00Z', days_late: 1, state: 'late' }),
  handIn({ board_id: 'b10', group_name: 'Group 10', done_at: null, days_late: null, state: 'missing' }),
]
const lab6 = { id: 'p1', title: 'Lab 6', audience: 'group' as const }
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value
const notes = (doc: ReportDoc) => doc.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))

describe('deliverable states', () => {
  it('labels each state, with days late spelled out', () => {
    expect(deliverableLabel({ state: 'on_time', days_late: 0 })).toBe('On time')
    expect(deliverableLabel({ state: 'late', days_late: 1 })).toBe('Late (1 day)')
    expect(deliverableLabel({ state: 'late', days_late: 3 })).toBe('Late (3 days)')
    expect(deliverableLabel({ state: 'missing', days_late: null })).toBe('Missing')
    expect(deliverableLabel({ state: 'not_due', days_late: null })).toBe('Not due yet')
  })
  it('gives each state its tone and its spreadsheet number', () => {
    expect(deliverableCell({ state: 'on_time', days_late: 0 })).toEqual({ value: 'On time', tone: 'success', exportValue: 0 })
    expect(deliverableCell({ state: 'late', days_late: 3 })).toEqual({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 })
    expect(deliverableCell({ state: 'missing', days_late: null })).toEqual({ value: 'Missing', tone: 'danger', exportValue: null })
    expect(deliverableCell({ state: 'not_due', days_late: null })).toEqual({ value: 'Not due yet', tone: 'pending', exportValue: null })
  })
})

describe('deliverablesDoc', () => {
  it('lays groups down and milestones then the hand-in across, in name order', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null })
    const [grid] = tableBlocks(doc)
    expect(grid.title).toBe('Compliance')
    expect(grid.columns.map((c) => c.label)).toEqual(['Group', 'Draft (due Oct 7, 2026)', 'Hand-in (due Oct 20, 2026)'])
    expect(grid.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2', 'Group 10'])
    expect(grid.rows[1][1]).toEqual({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 })
    expect(grid.rows[2][2]).toEqual({ value: 'Missing', tone: 'danger', exportValue: null })
  })
  it('counts the KPIs over what is due', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null })
    expect(kpi(doc, 'On-time rate')).toBe(20)
    expect(kpi(doc, 'On time')).toBe(1)
    expect(kpi(doc, 'Late')).toBe(2)
    expect(kpi(doc, 'Missing')).toBe(2)
    expect(kpi(doc, 'Not due yet')).toBe(1)
  })
  it('keeps only what falls due inside the window', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: { from: '2026-10-01', to: '2026-10-10' } })
    expect(tableBlocks(doc)[0].columns.map((c) => c.label)).toEqual(['Group', 'Draft (due Oct 7, 2026)'])
    expect(doc.header.rangeLabel).toBe('Oct 1 to Oct 10, 2026')
  })
  it('says so when nothing falls due, with no grid, no legend and no rate', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: { from: '2026-11-01', to: '2026-11-30' } })
    expect(tableBlocks(doc)).toHaveLength(0)
    expect(notes(doc)).toContain('No milestones or hand-ins fall due in these dates. Widen the dates or pick another project.')
    expect(kpi(doc, 'On-time rate')).toBe('—')
  })
  it('names a hand-in with no deadline, and shows it only under every date', () => {
    const open = [handIn({ due_day: null, due_at: null, done_at: '2026-10-21T01:00:00Z', days_late: 0, state: 'on_time' })]
    const all = deliverablesDoc({ ...head, projects: [lab6], rows: open, window: null })
    expect(tableBlocks(all)[0].columns.map((c) => c.label)).toEqual(['Group', 'Hand-in (no due date)'])
    const dated = deliverablesDoc({ ...head, projects: [lab6], rows: open, window: { from: '2026-10-01', to: '2026-10-31' } })
    expect(tableBlocks(dated)).toHaveLength(0)
  })
  it('puts students down the side of an individual project', () => {
    const solo = { id: 'p2', title: 'Essay', audience: 'individual' as const }
    const doc = deliverablesDoc({
      ...head, projects: [solo], window: null,
      rows: [handIn({ project_id: 'p2', ref_id: 'p2', group_name: null, student_name: 'Ana Cruz', state: 'not_due', done_at: null, days_late: null })],
    })
    const [grid] = tableBlocks(doc)
    expect(grid.columns[0].label).toBe('Student')
    expect(grid.rows[0][0]).toBe('Ana Cruz')
  })
  it('gives each project its own grid, says which have no boards, and ends with the legend', () => {
    const essay = { id: 'p2', title: 'Essay', audience: 'individual' as const }
    const doc = deliverablesDoc({ ...head, projects: [lab6, essay], rows, window: null })
    expect(tableBlocks(doc).map((t) => t.title)).toEqual(['Lab 6', 'Legend'])
    expect(notes(doc)).toContain('Essay has no groups or students yet.')
    expect(doc.header.subtitle).toBe('All projects')
  })
  it('passes on a notice from the page', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null, notice: 'This class has no term dates, so every date is shown.' })
    expect(notes(doc)[0]).toBe('This class has no term dates, so every date is shown.')
  })
  it('writes the grid to Excel as days late, with a legend sheet', () => {
    const wb = docToWorkbook(deliverablesDoc({ ...head, projects: [lab6], rows, window: null }))
    expect(wb.sheets.map((s) => s.name)).toEqual(['Report', 'Compliance', 'Legend'])
    expect(wb.sheets[1].rows.slice(1)).toEqual([
      ['Group 1', '0', ''],
      ['Group 2', '3', '1'],
      ['Group 10', '', ''],
    ])
  })
  it('orders groups by name whatever order the rows arrive in', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows: [...rows].reverse(), window: null })
    expect(tableBlocks(doc)[0].rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2', 'Group 10'])
  })
  it('orders milestones by due day first, then by title with numbers read as numbers', () => {
    const ms = [
      row({ ref_id: 'm10', title: 'Milestone 10', due_day: '2026-10-07' }),
      row({ ref_id: 'm2', title: 'Milestone 2', due_day: '2026-10-07' }),
      row({ ref_id: 'm99', title: 'Zeta', due_day: '2026-10-01' }),
    ]
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows: ms, window: null })
    expect(tableBlocks(doc)[0].columns.map((c) => c.label.split(' (')[0])).toEqual(['Group', 'Zeta', 'Milestone 2', 'Milestone 10'])
  })
  it('marks a grid archived when its project is', () => {
    const archived = rows.map((r) => ({ ...r, project_archived_at: '2026-10-12T00:00:00Z' }))
    expect(tableBlocks(deliverablesDoc({ ...head, projects: [lab6], rows: archived, window: null }))[0].title).toBe('Compliance (archived)')
    const essay = { id: 'p2', title: 'Essay', audience: 'group' as const }
    const both = [...archived, row({ project_id: 'p2', project_title: 'Essay', ref_id: 'm9' })]
    const titles = tableBlocks(deliverablesDoc({ ...head, projects: [lab6, essay], rows: both, window: null })).map((t) => t.title)
    expect(titles).toEqual(['Lab 6 (archived)', 'Essay', 'Legend'])
  })
  it('keeps sheet names and table ids unique for projects with the same title', () => {
    const twin = { id: 'p2', title: 'Lab 6', audience: 'group' as const }
    const both = [...rows, row({ project_id: 'p2', ref_id: 'm9' })]
    const doc = deliverablesDoc({ ...head, projects: [lab6, twin], rows: both, window: null })
    const ids = doc.blocks.flatMap((b) => (b.kind === 'table' ? [b.id] : []))
    expect(new Set(ids).size).toBe(ids.length)
    expect(docToWorkbook(doc).sheets.map((s) => s.name)).toEqual(['Report', 'Lab 6', 'Lab 6 (2)', 'Legend'])
  })
  it('writes a group named like a formula as text in Excel', () => {
    const evil = [row({ group_name: '=1+1' })]
    const wb = docToWorkbook(deliverablesDoc({ ...head, projects: [lab6], rows: evil, window: null }))
    expect(wb.sheets[1].rows[1][0]).toBe(' =1+1')
  })
})

describe('deliverablesDoc, final fixes', () => {
  const essay = { id: 'p2', title: 'Essay', audience: 'individual' as const }
  it('says a project with no boards has no groups or students, in place of the dates sentence', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6, essay], rows, window: null })
    expect(notes(doc)).toContain('Essay has no groups or students yet.')
    expect(notes(doc)).not.toContain('Nothing on Essay falls due in these dates.')
    const windowed = deliverablesDoc({ ...head, projects: [lab6, essay], rows, window: { from: '2026-10-01', to: '2026-10-10' } })
    expect(notes(windowed)).toContain('Essay has no groups or students yet.')
  })
  it('keeps the dates sentence for a project whose rows fall outside the window, never under every date', () => {
    const essayRows = [row({ project_id: 'p2', project_title: 'Essay', ref_id: 'm9', due_day: '2026-11-15' })]
    const windowed = deliverablesDoc({ ...head, projects: [lab6, essay], rows: [...rows, ...essayRows], window: { from: '2026-10-01', to: '2026-10-10' } })
    expect(notes(windowed)).toContain('Nothing on Essay falls due in these dates.')
    const every = deliverablesDoc({ ...head, projects: [lab6, essay], rows: [...rows, ...essayRows], window: null })
    expect(notes(every).some((t) => t.startsWith('Nothing on'))).toBe(false)
  })
  it('says the projects have no groups or students when none has any rows', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6, essay], rows: [], window: null })
    expect(notes(doc)).toContain('These projects have no groups or students yet.')
    expect(notes(doc)).not.toContain('No milestones or hand-ins fall due in these dates. Widen the dates or pick another project.')
    expect(notes(doc).some((t) => t.endsWith('has no groups or students yet.'))).toBe(false)
    expect(tableBlocks(doc)).toHaveLength(0)
    expect(kpi(doc, 'On-time rate')).toBe('—')
  })
  it('opens with a note when the class has ended', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows, window: null, classEnded: true, notice: 'This project is not released yet.' })
    expect(doc.blocks[0]).toEqual({ kind: 'note', tone: 'info', text: 'This class has ended. The report shows it as it was left.' })
    expect(notes(deliverablesDoc({ ...head, projects: [lab6], rows, window: null }))).not.toContain('This class has ended. The report shows it as it was left.')
  })
  it('says in the footer when boards were left out', () => {
    const line = 'Groups with no members and students no longer in the class are left out.'
    expect(deliverablesDoc({ ...head, projects: [lab6], rows, window: null, leftOut: true }).footer.lines).toContain(line)
    expect(deliverablesDoc({ ...head, projects: [lab6], rows, window: null }).footer.lines).not.toContain(line)
  })
})

describe('countableBoard', () => {
  const active = new Set(['s1'])
  it('counts a group board only while its group has members', () => {
    expect(countableBoard({ group_id: 'g1', student_id: null, member_count: 3 }, active)).toBe(true)
    expect(countableBoard({ group_id: 'g1', student_id: null, member_count: 0 }, active)).toBe(false)
  })
  it('counts a student board only while the student is an active class member', () => {
    expect(countableBoard({ group_id: null, student_id: 's1', member_count: 0 }, active)).toBe(true)
    expect(countableBoard({ group_id: null, student_id: 's2', member_count: 0 }, active)).toBe(false)
    expect(countableBoard({ group_id: null, student_id: null, member_count: 0 }, active)).toBe(false)
  })
  it('says one project has no groups or students when it has no rows', () => {
    const doc = deliverablesDoc({ ...head, projects: [lab6], rows: [], window: null })
    expect(notes(doc)).toEqual(['This project has no groups or students yet.'])
  })
})
