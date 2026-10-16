import { describe, expect, it } from 'vitest'
import { coTeacherNames, formalRecordDoc, projectRan, termRecordAllDoc } from './formalRecord'
import type { FormalBoard, FormalProject } from './formalRecord'
import { tableBlocks } from './doc'
import type { ReportDoc, TableBlock } from './doc'
import type { ClassReport, WeekCoverage } from '../report'

const NOW = Date.parse('2026-10-16T04:00:00Z')
const head = { classLine: 'QM · Quantitative Methods · 3A', professor: 'Prof. Reyes', madeAt: 'October 16, 2026' }

const cls = (over: Partial<ClassReport> = {}): ClassReport => ({
  class_id: 'c1', class_initial: 'QM', class_name: 'Quantitative Methods', code: 'IT 311', section: '3A',
  school_year: '2026-2027', semester: '1st', year_level: '3rd', term_start: '2026-08-10', term_end: '2026-12-12',
  archived_at: null, students: 30, students_removed: 2, projects: 3, projects_archived: 0, boards: 12,
  boards_submitted: 8, boards_accepted: 5, boards_returned: 1, tasks: 80, tasks_done: 60, tasks_late: 4,
  tasks_unclaimed: 3, weeks_total: 18, weeks_covered: 10, ...over,
} as ClassReport)

const project = (over: Partial<FormalProject>): FormalProject => ({
  id: 'p1', class_id: 'c1', title: 'Lab 6', type: 'laboratory', type_label: null, start_week: 3, end_week: 4,
  due_at: '2026-09-19T00:00:00Z', release_at: null, archived_at: null, total_points: 100, ...over,
})
const board = (over: Partial<FormalBoard>): FormalBoard => ({
  id: 'b', project_id: 'p1', group_id: 'g', student_id: null, member_count: 3, submitted_at: null, result_verdict: null, ...over,
})

const projects = [
  project({ id: 'p1', title: 'Lab 6', start_week: 3 }),
  project({ id: 'p2', title: 'Midterm', type: 'exam', start_week: 9, end_week: 9, archived_at: '2026-10-01T00:00:00Z', total_points: 50 }),
  project({ id: 'p3', title: 'Final paper', start_week: 15, release_at: '2026-11-01T00:00:00Z' }),
]
const active = new Set(['s1', 's2'])
const boards = [
  board({ id: 'b1', project_id: 'p1', submitted_at: '2026-09-18T00:00:00Z', result_verdict: 'accepted' }),
  board({ id: 'b2', project_id: 'p1', submitted_at: '2026-09-18T00:00:00Z' }),
  board({ id: 'b3', project_id: 'p1', result_verdict: 'returned' }),
  board({ id: 'b4', project_id: 'p1', member_count: 0 }),
  board({ id: 'b5', project_id: 'p2', group_id: null, student_id: 's1', member_count: 0, submitted_at: '2026-09-30T00:00:00Z', result_verdict: 'accepted' }),
  board({ id: 'b6', project_id: 'p2', group_id: null, student_id: 'gone', member_count: 0 }),
  board({ id: 'b7', project_id: 'p3', submitted_at: '2026-10-10T00:00:00Z' }),
]
const weeks: WeekCoverage[] = [
  { class_id: 'c1', week_no: 1, title: 'Intro', topics: '', outcomes: '', assessments: '', week_start: '2026-08-10', week_end: '2026-08-16', phase: 'past', project_titles: '', project_count: 0 } as WeekCoverage,
  { class_id: 'c1', week_no: 3, title: 'Queues', topics: '', outcomes: '', assessments: 'Lab', week_start: '2026-08-24', week_end: '2026-08-30', phase: 'past', project_titles: 'Lab 6', project_count: 1 } as WeekCoverage,
  { class_id: 'c1', week_no: 5, title: 'Markov', topics: '', outcomes: '', assessments: 'Quiz', week_start: null, week_end: null, phase: 'past', project_titles: '', project_count: 0 } as WeekCoverage,
]
const notes = [
  { kind: 'note' as const, follow_up_on: null, resolved_at: null },
  { kind: 'follow_up' as const, follow_up_on: '2026-10-01', resolved_at: '2026-10-02T00:00:00Z' },
  { kind: 'follow_up' as const, follow_up_on: '2026-10-05', resolved_at: null },
  { kind: 'nudge' as const, follow_up_on: null, resolved_at: null },
]
const scores = {
  p1: [{ final: 80, released: true }, { final: 91, released: true }, { final: null, released: true }],
  p2: [{ final: 40, released: false }],
}

const build = (over: Partial<Parameters<typeof formalRecordDoc>[0]> = {}) =>
  formalRecordDoc({
    ...head, cls: cls(), professorName: 'Maria Reyes', coTeachers: ['Jose Santos'], now: NOW,
    projects, boards, active, scores, weeks, notes, ...over,
  })
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)
const table = (doc: ReportDoc, id: string) => tableBlocks(doc).find((t) => t.id === id) as TableBlock

describe('projectRan', () => {
  it('counts archived, unscheduled and released projects, not ones waiting for release', () => {
    expect(projectRan({ release_at: null, archived_at: null }, NOW)).toBe(true)
    expect(projectRan({ release_at: '2026-10-01T00:00:00Z', archived_at: null }, NOW)).toBe(true)
    expect(projectRan({ release_at: '2026-11-01T00:00:00Z', archived_at: null }, NOW)).toBe(false)
    expect(projectRan({ release_at: '2026-11-01T00:00:00Z', archived_at: '2026-10-02T00:00:00Z' }, NOW)).toBe(true)
  })
})

describe('coTeacherNames', () => {
  it('names faculty at Owner or Manager, not the professor, members or students', () => {
    const people = [
      { user_id: 'prof', first_name: 'Maria', last_name: 'Reyes', level: 'owner', is_student: false },
      { user_id: 'f2', first_name: 'Jose', last_name: 'Santos', level: 'manager', is_student: false },
      { user_id: 'f1', first_name: 'Ana', last_name: 'Bautista', level: 'owner', is_student: false },
      { user_id: 'f3', first_name: 'Leo', last_name: 'Cruz', level: 'member', is_student: false },
      { user_id: 's1', first_name: 'Ben', last_name: 'Lim', level: 'manager', is_student: true },
    ] as Parameters<typeof coTeacherNames>[0]
    expect(coTeacherNames(people, 'prof')).toEqual(['Ana Bautista', 'Jose Santos'])
  })
})

describe('formalRecordDoc', () => {
  const doc = build()

  it('heads the record with the class and its term', () => {
    expect(doc.header.title).toBe('Formal term record')
    expect(doc.header.subtitle).toBe('QM · Quantitative Methods')
    expect(doc.header.rangeLabel).toBe('Aug 10, 2026 to Dec 12, 2026')
    expect(table(doc, 'class').rows).toEqual([
      ['Course', 'QM · Quantitative Methods'],
      ['Code and section', 'IT 311 3A'],
      ['Year and semester', '3rd year · 1st semester · 2026-2027'],
      ['Term', 'Aug 10, 2026 to Dec 12, 2026'],
      ['Status', 'Running'],
      ['Professor', 'Maria Reyes'],
      ['Co-teachers', 'Jose Santos'],
    ])
  })
  it('says None when nobody co-teaches, and when the class ended', () => {
    const ended = build({ coTeachers: [], cls: cls({ archived_at: '2026-12-15T02:00:00Z' }) })
    expect(table(ended, 'class').rows[4]).toEqual(['Status', 'Ended Dec 15, 2026'])
    expect(table(ended, 'class').rows[6]).toEqual(['Co-teachers', 'None'])
    expect(ended.blocks[0]).toEqual({ kind: 'note', tone: 'info', text: 'This class has ended. The report shows it as it was left.' })
  })
  it('counts enrolment, projects run and the two rates over boards that count', () => {
    // Ran: p1 and p2. Counted boards: b1, b2, b3 (b4 is empty) and b5 (b6's student left). Handed in: b1, b2, b5. Accepted: b1, b5.
    expect(kpi(doc, 'Students enrolled')?.value).toBe(30)
    expect(kpi(doc, 'Students removed')?.value).toBe(2)
    expect(kpi(doc, 'Projects run')?.value).toBe(2)
    expect(kpi(doc, 'Hand-in rate')).toEqual({ label: 'Hand-in rate', value: 75, unit: '%' })
    expect(kpi(doc, 'Accepted rate')).toEqual({ label: 'Accepted rate', value: 50, unit: '%' })
    expect(kpi(doc, 'Syllabus weeks covered')?.value).toBe('10/18')
    expect(kpi(doc, 'Work finished')).toEqual({ label: 'Work finished', value: 75, unit: '%' })
  })
  it('lists the projects that ran, with rates and released finals', () => {
    const t = table(doc, 'projects')
    expect(t.columns.map((c) => c.label)).toEqual([
      'Project', 'Type', 'Weeks', 'Due', 'Groups or students', 'Handed in', 'Accepted', 'Points', 'Average released final', 'Finals released',
    ])
    expect(t.rows).toEqual([
      ['Lab 6', 'Laboratory', 'Weeks 3–4', '2026-09-19T00:00:00Z', 3, 66.7, 33.3, 100, 85.5, 2],
      [{ value: 'Midterm', tag: 'Archived', tone: 'pending' }, 'Exam', 'Week 9', '2026-09-19T00:00:00Z', 1, 100, 100, 50, null, 0],
    ])
  })
  it('shows a dash, never 0% or NaN, when nothing counts', () => {
    const empty = build({ boards: [board({ id: 'x', project_id: 'p1', member_count: 0 })], cls: cls({ tasks: 0, tasks_done: 0 }) })
    expect(kpi(empty, 'Hand-in rate')).toEqual({ label: 'Hand-in rate', value: '—', unit: undefined })
    expect(kpi(empty, 'Accepted rate')?.value).toBe('—')
    expect(kpi(empty, 'Work finished')?.value).toBe('—')
    expect(table(empty, 'projects').rows[0].slice(4, 7)).toEqual([0, null, null])
  })
  it('lists every syllabus week and what was set against it', () => {
    const t = table(doc, 'coverage')
    expect(t.title).toBe('Syllabus coverage')
    expect(t.rows).toEqual([
      [1, 'Aug 10, 2026 to Aug 16, 2026', 'Intro', null, null],
      [3, 'Aug 24, 2026 to Aug 30, 2026', 'Queues', 'Lab', 'Lab 6'],
      [5, null, 'Markov', 'Quiz', 'Nothing set'],
    ])
    expect(t.note).toBe(
      'Coverage means a project was set against that syllabus week. It does not measure what was taught in the room. 1 week names an assessment with nothing set against it.',
    )
  })
  it('counts notes by kind with follow-ups resolved, and a total', () => {
    expect(table(doc, 'interventions').rows).toEqual([
      ['Note', 1, 0, 0],
      ['Follow-up', 2, 2, 1],
      ['Reminder', 1, 0, 0],
      ['Total', 4, 2, 1],
    ])
  })
  it('keeps the old term report counts', () => {
    expect(table(doc, 'work').rows).toEqual([
      ['Tasks set', 80],
      ['Tasks finished', 60],
      ['Finished after the deadline', 4],
      ['Never claimed by anybody', 3],
    ])
  })
  it('says what is empty', () => {
    const bare = build({ projects: [], boards: [], weeks: [], notes: [] })
    const texts = bare.blocks.flatMap((b) => (b.kind === 'note' ? [b.text] : []))
    expect(texts).toEqual([
      'No projects were run in this class.',
      'This class has no syllabus weeks yet.',
      'No notes were written for this class.',
    ])
  })
  it('explains the rates, leaves out unreleased projects, and has two signature lines', () => {
    expect(doc.footer.lines).toEqual([
      'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.',
      'Averages count released finals only.',
      'Projects not yet released to students are left out.',
    ])
    expect(build({ projects: projects.slice(0, 2) }).footer.lines).toHaveLength(2)
    expect(doc.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }, { role: 'Reviewed by (program chair)' }])
  })
})

describe('termRecordAllDoc', () => {
  const c2 = cls({ class_id: 'c2', class_initial: 'DS', class_name: 'Data Structures', section: '2B', students: 20, students_removed: 0,
    archived_at: '2026-06-01T00:00:00Z', term_start: null, term_end: null, weeks_total: 0, weeks_covered: 0, tasks: 0, tasks_done: 0 })
  const all = termRecordAllDoc({
    ...head,
    classLine: '2 classes',
    classes: [cls(), c2],
    now: NOW,
    projects: [...projects, project({ id: 'q1', class_id: 'c2', title: 'Stack lab' })],
    boards: [...boards, board({ id: 'q', project_id: 'q1', submitted_at: '2026-05-01T00:00:00Z' })],
    active: new Map([['c1', active], ['c2', new Set<string>()]]),
  })

  it('heads the record for every class', () => {
    expect(all.header.subtitle).toBe('Every class you teach')
    expect(all.header.rangeLabel).toBeNull()
  })
  it('totals across classes', () => {
    expect(kpi(all, 'Classes')?.value).toBe(2)
    expect(kpi(all, 'Students enrolled')?.value).toBe(50)
    expect(kpi(all, 'Projects run')?.value).toBe(3)
    // Counted: b1, b2, b3, b5, q. Handed in: b1, b2, b5, q. Accepted: b1, b5.
    expect(kpi(all, 'Hand-in rate')?.value).toBe(80)
    expect(kpi(all, 'Accepted rate')?.value).toBe(40)
  })
  it('gives one row per class, the same figures as its own record', () => {
    const t = table(all, 'classes')
    expect(t.columns.map((c) => c.label)).toEqual([
      'Class', 'Section', 'Term', 'Students', 'Removed', 'Projects run', 'Groups or students', 'Handed in', 'Accepted',
      'Syllabus weeks covered', 'Syllabus weeks', 'Work finished',
    ])
    expect(t.rows[0]).toEqual(['QM · Quantitative Methods', '3A', 'Aug 10, 2026 to Dec 12, 2026', 30, 2, 2, 4, 75, 50, 10, 18, 75])
    expect(t.rows[1]).toEqual([
      { value: 'DS · Data Structures', tag: 'Ended', tone: 'pending' }, '2B', 'No term dates set', 20, 0, 1, 1, 100, 0, 0, 0, null,
    ])
  })
  it('says so when there are no classes', () => {
    const none = termRecordAllDoc({ ...head, classes: [], now: NOW, projects: [], boards: [], active: new Map() })
    expect(none.blocks).toContainEqual({ kind: 'note', tone: 'info', text: 'You have no classes yet.' })
  })
  it('has the same footer and signatures', () => {
    expect(all.footer.lines[0]).toBe(
      'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.',
    )
    expect(all.footer.signatures).toEqual([{ role: 'Prepared by', name: 'Prof. Reyes' }, { role: 'Reviewed by (program chair)' }])
  })
})
