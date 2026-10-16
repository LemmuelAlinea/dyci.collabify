import type { SpacePerson } from '../general/types'
import { NOTE_KIND_META } from '../notes'
import type { ClassReport, WeekCoverage } from '../report'
import { projectTypeLabel, weekSpanLabel } from '../types'
import type { NoteLogRow, ProjectRow, ResultVerdict, ScoreSheetRow } from '../types'
import { CLASS_ENDED_NOTE, countableBoard } from './deliverables'
import { dayText } from './doc'
import type { Block, Cell, Kpi, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { KIND_ORDER } from './interventionLog'

export type FormalProject = Pick<
  ProjectRow,
  'id' | 'class_id' | 'title' | 'type' | 'type_label' | 'start_week' | 'end_week' | 'due_at' | 'release_at' | 'archived_at' | 'total_points'
>

export type FormalBoard = {
  id: string
  project_id: string
  group_id: string | null
  student_id: string | null
  member_count: number
  submitted_at: string | null
  result_verdict: ResultVerdict | null
}

const RATES_LINE =
  'Hand-in and accepted rates count every group with members and every student still in the class, on projects released to students.'
const RELEASED_ONLY_LINE = 'Averages count released finals only.'
const UNRELEASED_LINE = 'Projects not yet released to students are left out.'

const signatures = (professor: string) => [{ role: 'Prepared by', name: professor }, { role: 'Reviewed by (program chair)' }]

/** A project that ran: archived, or released to students by `now`. */
export function projectRan(p: Pick<ProjectRow, 'release_at' | 'archived_at'>, now: number) {
  return Boolean(p.archived_at) || !p.release_at || Date.parse(p.release_at) <= now
}

const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null)
const pctKpi = (label: string, v: number | null): Kpi => ({ label, value: v ?? '—', unit: v === null ? undefined : '%' })

/** The boards that count, and how many of them were handed in and accepted. */
function boardFigures(boards: FormalBoard[], active: ReadonlySet<string>) {
  const counted = boards.filter((b) => countableBoard(b, active))
  return {
    boards: counted.length,
    handedIn: counted.filter((b) => b.submitted_at !== null || b.result_verdict === 'accepted').length,
    accepted: counted.filter((b) => b.result_verdict === 'accepted').length,
  }
}

/** Everyone else who teaches the class: faculty its space holds at Owner or Manager, by name. */
export function coTeacherNames(
  people: Pick<SpacePerson, 'user_id' | 'first_name' | 'last_name' | 'level' | 'is_student'>[],
  professorId: string,
) {
  return people
    .filter((p) => !p.is_student && (p.level === 'owner' || p.level === 'manager') && p.user_id !== professorId)
    .map((p) => `${p.first_name} ${p.last_name}`.trim())
    .sort((a, b) => a.localeCompare(b))
}

const termText = (start: string | null, end: string | null) =>
  start && end ? `${dayText(start)} to ${dayText(end)}` : 'No term dates set'

const byWeek = (a: FormalProject, b: FormalProject) =>
  a.start_week - b.start_week || a.title.localeCompare(b.title, undefined, { numeric: true })

const note = (text: string): Block => ({ kind: 'note', tone: 'info', text })

export function formalRecordDoc(input: ReportHead & {
  cls: ClassReport
  /** The class's own professor, as the class records them. */
  professorName: string
  coTeachers: string[]
  now: number
  projects: FormalProject[]
  boards: FormalBoard[]
  /** The class's active student ids. */
  active: ReadonlySet<string>
  /** score_sheet rows by project id. */
  scores: Record<string, Pick<ScoreSheetRow, 'final' | 'released'>[]>
  weeks: WeekCoverage[]
  notes: Pick<NoteLogRow, 'kind' | 'follow_up_on' | 'resolved_at'>[]
}): ReportDoc {
  const { cls } = input
  const ran = input.projects.filter((p) => projectRan(p, input.now)).sort(byWeek)
  const ranIds = new Set(ran.map((p) => p.id))
  const all = boardFigures(input.boards.filter((b) => ranIds.has(b.project_id)), input.active)
  const term = termText(cls.term_start, cls.term_end)

  const blocks: Block[] = []
  if (cls.archived_at) blocks.push(note(CLASS_ENDED_NOTE))
  blocks.push({
    kind: 'kpis',
    items: [
      { label: 'Students enrolled', value: cls.students },
      { label: 'Students removed', value: cls.students_removed },
      { label: 'Projects run', value: ran.length },
      pctKpi('Hand-in rate', rate(all.handedIn, all.boards)),
      pctKpi('Accepted rate', rate(all.accepted, all.boards)),
      { label: 'Syllabus weeks covered', value: `${cls.weeks_covered}/${cls.weeks_total}` },
      pctKpi('Work finished', rate(cls.tasks_done, cls.tasks)),
    ],
  })

  blocks.push({
    kind: 'table',
    id: 'class',
    title: 'Class',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
    ],
    rows: [
      ['Course', `${cls.class_initial} · ${cls.class_name}`],
      ['Code and section', `${cls.code} ${cls.section}`],
      ['Year and semester', `${cls.year_level} year · ${cls.semester} semester · ${cls.school_year}`],
      ['Term', term],
      ['Status', cls.archived_at ? `Ended ${dayText(cls.archived_at)}` : 'Running'],
      ['Professor', input.professorName],
      ['Co-teachers', input.coTeachers.length ? input.coTeachers.join(', ') : 'None'],
    ],
  })

  if (ran.length === 0) {
    blocks.push(note('No projects were run in this class.'))
  } else {
    blocks.push({
      kind: 'table',
      id: 'projects',
      title: 'Projects',
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'weeks', label: 'Weeks', type: 'text' },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'boards', label: 'Groups or students', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'percent' },
        { key: 'accepted', label: 'Accepted', type: 'percent' },
        { key: 'points', label: 'Points', type: 'number' },
        { key: 'average', label: 'Average released final', type: 'number', decimals: 1 },
        { key: 'released', label: 'Finals released', type: 'number' },
      ],
      rows: ran.map<Cell[]>((p) => {
        const f = boardFigures(input.boards.filter((b) => b.project_id === p.id), input.active)
        const finals = (input.scores[p.id] ?? [])
          .filter((s) => s.released && s.final !== null)
          .map((s) => Number(s.final))
        const average = finals.length ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10 : null
        return [
          p.archived_at ? { value: p.title, tag: 'Archived', tone: 'pending' } : p.title,
          projectTypeLabel(p),
          weekSpanLabel(p),
          p.due_at,
          f.boards,
          rate(f.handedIn, f.boards),
          rate(f.accepted, f.boards),
          p.total_points,
          average,
          finals.length,
        ]
      }),
    })
  }

  if (input.weeks.length === 0) {
    blocks.push(note('This class has no syllabus weeks yet.'))
  } else {
    const gaps = input.weeks.filter((w) => w.project_count === 0 && w.assessments.trim() !== '').length
    blocks.push({
      kind: 'table',
      id: 'coverage',
      title: 'Syllabus coverage',
      columns: [
        { key: 'week', label: 'Week', type: 'number' },
        { key: 'dates', label: 'Dates', type: 'text' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'asks', label: 'What the syllabus asks for', type: 'text' },
        { key: 'set', label: 'What was set against it', type: 'text' },
      ],
      rows: input.weeks.map<Cell[]>((w) => [
        w.week_no,
        w.week_start && w.week_end ? `${dayText(w.week_start)} to ${dayText(w.week_end)}` : null,
        w.title,
        w.assessments.trim() || null,
        w.project_titles || (w.assessments.trim() ? 'Nothing set' : null),
      ]),
      note:
        'Coverage means a project was set against that syllabus week. It does not measure what was taught in the room.' +
        (gaps ? ` ${gaps} ${gaps === 1 ? 'week names' : 'weeks name'} an assessment with nothing set against it.` : ''),
    })
  }

  const kinds = KIND_ORDER.map((k) => {
    const of = input.notes.filter((n) => n.kind === k)
    const followUps = of.filter((n) => n.follow_up_on !== null)
    return { k, notes: of.length, followUps: followUps.length, resolved: followUps.filter((n) => n.resolved_at !== null).length }
  }).filter((x) => x.notes > 0)
  if (kinds.length === 0) {
    blocks.push(note('No notes were written for this class.'))
  } else {
    const sum = (f: (x: (typeof kinds)[number]) => number) => kinds.reduce((a, x) => a + f(x), 0)
    blocks.push({
      kind: 'table',
      id: 'interventions',
      title: 'Interventions',
      columns: [
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'number' },
        { key: 'followUps', label: 'Follow-ups', type: 'number' },
        { key: 'resolved', label: 'Follow-ups resolved', type: 'number' },
      ],
      rows: [
        ...kinds.map<Cell[]>((x) => [NOTE_KIND_META[x.k].label, x.notes, x.followUps, x.resolved]),
        ['Total', sum((x) => x.notes), sum((x) => x.followUps), sum((x) => x.resolved)],
      ],
    })
  }

  blocks.push({
    kind: 'table',
    id: 'work',
    title: 'Work',
    columns: [
      { key: 'measure', label: 'Measure', type: 'text' },
      { key: 'count', label: 'Count', type: 'number' },
    ],
    rows: [
      ['Tasks set', cls.tasks],
      ['Tasks finished', cls.tasks_done],
      ['Finished after the deadline', cls.tasks_late],
      ['Never claimed by anybody', cls.tasks_unclaimed],
    ],
  })

  return {
    header: {
      title: 'Formal term record',
      subtitle: `${cls.class_initial} · ${cls.class_name}`,
      classLine: input.classLine,
      rangeLabel: term,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [RATES_LINE, RELEASED_ONLY_LINE, ...(ran.length < input.projects.length ? [UNRELEASED_LINE] : [])],
      signatures: signatures(input.professor),
    },
  }
}

/** The every-class version: one row per class, with the same figures each class's own record gives. */
export function termRecordAllDoc(input: ReportHead & {
  classes: ClassReport[]
  now: number
  projects: FormalProject[]
  boards: FormalBoard[]
  /** Each class's active student ids. */
  active: ReadonlyMap<string, ReadonlySet<string>>
}): ReportDoc {
  const ran = input.projects.filter((p) => projectRan(p, input.now))
  const classOf = new Map(ran.map((p) => [p.id, p.class_id]))
  const rows = input.classes.map((c) => ({
    c,
    projects: ran.filter((p) => p.class_id === c.class_id).length,
    f: boardFigures(
      input.boards.filter((b) => classOf.get(b.project_id) === c.class_id),
      input.active.get(c.class_id) ?? new Set<string>(),
    ),
  }))
  const total = (g: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + g(x), 0)
  const boards = total((x) => x.f.boards)

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Classes', value: input.classes.length },
        { label: 'Students enrolled', value: total((x) => x.c.students) },
        { label: 'Projects run', value: total((x) => x.projects) },
        pctKpi('Hand-in rate', rate(total((x) => x.f.handedIn), boards)),
        pctKpi('Accepted rate', rate(total((x) => x.f.accepted), boards)),
      ],
    },
  ]
  if (rows.length === 0) {
    blocks.push(note('You have no classes yet.'))
  } else {
    blocks.push({
      kind: 'table',
      id: 'classes',
      title: 'Classes',
      columns: [
        { key: 'class', label: 'Class', type: 'text' },
        { key: 'section', label: 'Section', type: 'text' },
        { key: 'term', label: 'Term', type: 'text' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'removed', label: 'Removed', type: 'number' },
        { key: 'projects', label: 'Projects run', type: 'number' },
        { key: 'boards', label: 'Groups or students', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'percent' },
        { key: 'accepted', label: 'Accepted', type: 'percent' },
        { key: 'covered', label: 'Syllabus weeks covered', type: 'number' },
        { key: 'weeks', label: 'Syllabus weeks', type: 'number' },
        { key: 'finished', label: 'Work finished', type: 'percent' },
      ],
      rows: rows.map<Cell[]>(({ c, projects, f }) => {
        const name = `${c.class_initial} · ${c.class_name}`
        return [
          c.archived_at ? { value: name, tag: 'Ended', tone: 'pending' } : name,
          c.section,
          termText(c.term_start, c.term_end),
          c.students,
          c.students_removed,
          projects,
          f.boards,
          rate(f.handedIn, f.boards),
          rate(f.accepted, f.boards),
          c.weeks_covered,
          c.weeks_total,
          rate(c.tasks_done, c.tasks),
        ]
      }),
    })
  }

  return {
    header: {
      title: 'Formal term record',
      subtitle: 'Every class you teach',
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: [RATES_LINE, ...(ran.length < input.projects.length ? [UNRELEASED_LINE] : [])],
      signatures: signatures(input.professor),
    },
  }
}
