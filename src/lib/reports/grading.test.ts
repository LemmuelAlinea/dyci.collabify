import { describe, expect, it } from 'vitest'
import { gradingClassDoc, gradingGridDoc, gradingStudentDoc, scoreBand } from './grading'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { PeerResult, ScoreSheetRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 13, 2026' }
const project = { id: 'p1', title: 'Lab 6', total_points: 100 }

const row = (over: Partial<ScoreSheetRow>): ScoreSheetRow => ({
  board_id: 'b1', student_id: 's1', student_name: 'Ana Cruz', in_group: true,
  group_total: 80, scored: 2, criteria: 2, total_points: 100, factor: null, raters: 0,
  suggested_now: 80, suggested_saved: 80, final: 80, overridden: false, factor_saved: null,
  confirmed_at: '2026-10-13T00:00:00Z', suggestion_changed: false, released: false, ...over,
})

const criteria = [
  { id: 'c1', project_id: 'p1', position: 1, label: 'Function', description: 'It works', max_points: 60 },
  { id: 'c2', project_id: 'p1', position: 2, label: 'Docs', description: 'It is explained', max_points: 40 },
]
const boardScores = [
  { board_id: 'b1', criterion_id: 'c1', points: 50, scored_at: '' },
  { board_id: 'b1', criterion_id: 'c2', points: 30, scored_at: '' },
]
const peer = (sid: string, avg: number): PeerResult => ({
  round_id: 'r1', project_id: 'p1', class_id: 'c', kind: 'final', opens_at: '2026-10-01T00:00:00Z', is_open: false,
  board_id: 'b1', group_name: 'Group 1', student_id: sid, student_name: sid, received_avg: avg, raters: 2,
  received_spread: 0, self_avg: avg, given_avg: avg, contributes_avg: avg, interacts_avg: avg, on_track_avg: avg,
  quality_avg: avg, skills_avg: avg, team_size: 3, rated_all: true,
})

const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('scoreBand', () => {
  it('puts the total in the top band and zero in the bottom', () => {
    expect(scoreBand(100, 100)).toBe(9)
    expect(scoreBand(0, 100)).toBe(0)
    expect(scoreBand(89.5, 100)).toBe(8)
    expect(scoreBand(90, 100)).toBe(9)
  })
})

describe('gradingClassDoc', () => {
  const sheet = [
    row({ student_id: 's1', student_name: 'Ana Cruz', final: 84, suggested_now: 84, factor: 1.05, released: true }),
    row({ student_id: 's2', student_name: 'Ben Diaz', final: 70, suggested_now: 76, overridden: true }),
    row({ student_id: 's3', student_name: 'Cy Ramos', final: null, confirmed_at: null, overridden: null }),
  ]
  const doc = gradingClassDoc({
    ...head, project, sheet, criteria, boardScores,
    boardNames: new Map([['b1', 'Group 1']]),
    work: [{
      class_id: 'c', project_id: 'p1', project_title: 'Lab 6', board_id: 'b1', group_name: 'Group 1',
      board_student_name: null, submitted_at: null, result_verdict: null, project_due_at: null,
      student_id: 's1', student_name: 'Ana Cruz', avatar_url: null, tasks_held: 4, tasks_done: 3, tasks_late: 1,
      held_pct: 40, personal_pct: 75, first_activity: null, last_finish: null,
    }],
    peer: [peer('s1', 4), peer('s2', 2), peer('s3', 3)],
  })
  const grades = tableBlocks(doc).find((t) => t.id === 'grades')!

  it('has one row per student with criteria, statuses and contribution', () => {
    expect(grades.rows).toHaveLength(3)
    const ana = grades.rows.find((r) => r[0] === 'Ana Cruz')!
    const cols = grades.columns.map((c) => c.key)
    expect(ana[cols.indexOf('group')]).toBe('Group 1')
    expect(ana[cols.indexOf('crit-c1')]).toBe(50)
    expect(ana[cols.indexOf('final')]).toBe(84)
    expect(ana[cols.indexOf('status')]).toEqual({ value: 'Released', tone: 'success' })
    expect(ana[cols.indexOf('share')]).toBe(40)
    expect(ana[cols.indexOf('tasks')]).toBe('3 of 4')
  })
  it('tags overrides and says which scores students cannot see yet', () => {
    const ben = grades.rows.find((r) => r[0] === 'Ben Diaz')!
    const cols = grades.columns.map((c) => c.key)
    expect(ben[cols.indexOf('final')]).toEqual({ value: 70, tag: 'Overridden', tone: 'pending' })
    expect(ben[cols.indexOf('status')]).toEqual({ value: 'Not released', tone: 'warning' })
    const cy = grades.rows.find((r) => r[0] === 'Cy Ramos')!
    expect(cy[cols.indexOf('status')]).toEqual({ value: 'Not confirmed', tone: 'pending' })
  })
  it('counts and averages only confirmed finals', () => {
    expect(kpi(doc, 'Students')).toBe(3)
    expect(kpi(doc, 'Confirmed')).toBe(2)
    expect(kpi(doc, 'Released')).toBe(1)
    expect(kpi(doc, 'Average final')).toBe('77')
    expect(kpi(doc, 'Median final')).toBe('77')
    expect(kpi(doc, 'Overridden')).toBe(1)
  })
  it('includes the rubric key and the footer line', () => {
    expect(tableBlocks(doc).find((t) => t.id === 'rubric')!.rows).toHaveLength(2)
    expect(doc.footer.lines).toContain('Scores tagged Not released are not yet visible to students.')
    expect(doc.footer.signatures[0]).toEqual({ role: 'Prepared by', name: 'Prof. Reyes' })
  })
  it('says so, with no chart, when nothing is confirmed', () => {
    const empty = gradingClassDoc({
      ...head, project, criteria, boardScores, boardNames: new Map(), work: [], peer: [],
      sheet: [row({ final: null, confirmed_at: null })],
    })
    expect(kpi(empty, 'Average final')).toBe('—')
    expect(kpi(empty, 'Median final')).toBe('—')
    expect(empty.blocks.some((b) => b.kind === 'chart')).toBe(false)
    expect(empty.blocks.some((b) => b.kind === 'note' && b.text.includes('No score is confirmed yet'))).toBe(true)
  })
})

describe('gradingClassDoc saved versus live', () => {
  const build = (r: ScoreSheetRow) =>
    gradingClassDoc({
      ...head, project, criteria, boardScores, boardNames: new Map([['b1', 'Group 1']]), work: [], peer: [],
      sheet: [r],
    })
  const cell = (doc: ReportDoc, key: string) => {
    const t = tableBlocks(doc).find((x) => x.id === 'grades')!
    return t.rows[0][t.columns.map((c) => c.key).indexOf(key)]
  }
  it('shows the saved suggestion and factor of a confirmed row, and flags the drift', () => {
    const doc = build(row({
      suggested_now: 76, suggested_saved: 84, factor: 1.0, factor_saved: 1.05, final: 84, suggestion_changed: true,
    }))
    expect(cell(doc, 'suggested')).toBe(84)
    expect(cell(doc, 'factor')).toBe(1.05)
    expect(cell(doc, 'final')).toEqual({ value: 84, tag: 'Suggestion changed', tone: 'warning' })
  })
  it('keeps the override tag and adds the drift on an overridden row', () => {
    const doc = build(row({ final: 70, overridden: true, suggestion_changed: true }))
    expect(cell(doc, 'final')).toEqual({ value: 70, tag: 'Overridden · suggestion changed', tone: 'warning' })
  })
  it('shows the live suggestion and factor of an unconfirmed row', () => {
    const doc = build(row({
      suggested_now: 76, suggested_saved: 84, factor: 1.0, factor_saved: 1.05, final: null, confirmed_at: null,
    }))
    expect(cell(doc, 'suggested')).toBe(76)
    expect(cell(doc, 'factor')).toBe(1)
  })
})

describe('gradingGridDoc', () => {
  const doc = gradingGridDoc({
    ...head,
    students: [{ id: 's2', name: 'Ben Diaz' }, { id: 's1', name: 'Ana Cruz' }],
    projects: [
      { project, sheet: [row({ student_id: 's1', final: 84, released: true }), row({ student_id: 's2', final: 70, released: true })] },
      { project: { id: 'p2', title: 'Lab 7', total_points: 50 }, sheet: [row({ student_id: 's1', final: 40, total_points: 50 })] },
    ],
  })
  const grid = tableBlocks(doc)[0]

  it('marks a project that is not released on its column', () => {
    expect(grid.columns.map((c) => c.label)).toEqual(['Student', 'Lab 6', 'Lab 7 (not released)', 'Overall'])
  })
  it('gives each student their finals and an overall percent over the projects they have', () => {
    expect(grid.rows[0]).toEqual(['Ana Cruz', 84, 40, (124 / 150) * 100])
    expect(grid.rows[1]).toEqual(['Ben Diaz', 70, null, 70])
  })
})

describe('gradingStudentDoc', () => {
  it('lists each project with the adjustment, then its breakdown and peer view', () => {
    const doc = gradingStudentDoc({
      ...head,
      student: { id: 's1', name: 'Ana Cruz' },
      projects: [{ project, row: row({ final: 84, factor_saved: 1.05 }), criteria, boardScores, peer: [peer('s1', 4), peer('s2', 3)] }],
    })
    const projects = tableBlocks(doc).find((t) => t.id === 'projects')!
    const cols = projects.columns.map((c) => c.key)
    expect(projects.rows[0][cols.indexOf('adjust')]).toBe(4)
    expect(tableBlocks(doc).some((t) => t.id === 'rubric-p1')).toBe(true)
    const seen = tableBlocks(doc).find((t) => t.id === 'peer-p1')!
    expect(seen.rows[0]).toEqual([expect.any(String), 4, 3.5])
  })
  it('flags an adjustment whose suggestion has changed since the confirm', () => {
    const doc = gradingStudentDoc({
      ...head,
      student: { id: 's1', name: 'Ana Cruz' },
      projects: [{ project, row: row({ final: 84, factor: 1.0, factor_saved: 1.05, suggestion_changed: true }), criteria, boardScores, peer: [] }],
    })
    const projects = tableBlocks(doc).find((t) => t.id === 'projects')!
    const cols = projects.columns.map((c) => c.key)
    expect(projects.rows[0][cols.indexOf('adjust')]).toEqual({ value: 4, tag: 'Suggestion changed', tone: 'warning' })
    expect(projects.rows[0][cols.indexOf('factor')]).toBe(1.05)
  })
  it('leaves a teammate with too few raters out of the team mean', () => {
    const doc = gradingStudentDoc({
      ...head,
      student: { id: 's1', name: 'Ana Cruz' },
      projects: [{
        project, row: row({ final: 84 }), criteria, boardScores,
        peer: [peer('s1', 4), peer('s2', 3), { ...peer('s3', 1), raters: 1 }],
      }],
    })
    const seen = tableBlocks(doc).find((t) => t.id === 'peer-p1')!
    expect(seen.rows[0]).toEqual([expect.any(String), 4, 3.5])
  })
})
