import { analyseTeam, peerFlagLabel } from '../peerMath'
import { PEER_DIMENSIONS } from '../peerDimensions'
import type { StudentWork } from '../report'
import { formatPoints } from '../scoreMath'
import type { BoardScore, PeerResult, ProjectCriterion, ScoreSheetRow } from '../types'
import type { Block, Cell, Column, ReportDoc } from './doc'

export type GradingProject = { id: string; title: string; total_points: number }
export type ReportHead = { classLine: string; professor: string; madeAt: string }

const NOT_RELEASED_LINE = 'Scores tagged Not released are not yet visible to students.'

/** Which tenth of the total a score falls in, 0–9. The total itself is in the top band. */
export function scoreBand(final: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(9, Math.floor((final / total) * 10)))
}

function status(r: ScoreSheetRow): Cell {
  if (!r.confirmed_at || r.final === null) return { value: 'Not confirmed', tone: 'pending' }
  return r.released ? { value: 'Released', tone: 'success' } : { value: 'Not released', tone: 'warning' }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const shown = (v: number | null) => (v === null ? '—' : formatPoints(Math.round(v * 10) / 10))

const footer = (professor: string, withLine: boolean) => ({
  lines: withLine ? [NOT_RELEASED_LINE] : [],
  signatures: [{ role: 'Prepared by', name: professor }],
})

/** One project, every student on it. */
export function gradingClassDoc(input: ReportHead & {
  project: GradingProject
  sheet: ScoreSheetRow[]
  criteria: ProjectCriterion[]
  boardScores: BoardScore[]
  boardNames: Map<string, string>
  work: StudentWork[]
  peer: PeerResult[]
}): ReportDoc {
  const { project, sheet, criteria, boardScores, boardNames, work, peer } = input
  const total = project.total_points
  const points = new Map(boardScores.map((s) => [`${s.board_id}:${s.criterion_id}`, Number(s.points)]))
  const flagsOf = new Map<string, string>()
  for (const board of new Set(peer.map((p) => p.board_id))) {
    for (const m of analyseTeam(peer.filter((p) => p.board_id === board))) {
      flagsOf.set(`${board}:${m.student_id}`, m.flags.map((f) => peerFlagLabel(f, m.is_open).label).join('; '))
    }
  }
  const workOf = new Map(work.map((w) => [`${w.board_id}:${w.student_id}`, w]))

  const columns: Column[] = [
    { key: 'student', label: 'Student', type: 'text' },
    { key: 'group', label: 'Group', type: 'text' },
    ...criteria.map<Column>((c) => ({ key: `crit-${c.id}`, label: c.label, type: 'score', outOf: c.max_points })),
    { key: 'groupTotal', label: 'Group total', type: 'score', outOf: total },
    { key: 'factor', label: 'Peer factor', type: 'number' },
    { key: 'flags', label: 'Peer flags', type: 'text' },
    { key: 'suggested', label: 'Suggested', type: 'score', outOf: total },
    { key: 'final', label: 'Final', type: 'score', outOf: total },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'share', label: 'Share of group work', type: 'percent' },
    { key: 'tasks', label: 'Tasks finished', type: 'text' },
    { key: 'late', label: 'Late tasks', type: 'number' },
  ]

  const sorted = [...sheet].sort(
    (a, b) =>
      (boardNames.get(a.board_id) ?? '').localeCompare(boardNames.get(b.board_id) ?? '') ||
      a.student_name.localeCompare(b.student_name),
  )
  const rows: Cell[][] = sorted.map((r) => {
    const w = workOf.get(`${r.board_id}:${r.student_id}`)
    const final: Cell =
      r.final === null || !r.confirmed_at
        ? null
        : r.overridden
          ? { value: Number(r.final), tag: 'Overridden', tone: 'pending' }
          : Number(r.final)
    return [
      r.student_name,
      boardNames.get(r.board_id) ?? (r.in_group ? 'Group' : 'Individual'),
      ...criteria.map((c) => points.get(`${r.board_id}:${c.id}`) ?? null),
      r.group_total === null ? null : Number(r.group_total),
      r.factor === null ? null : Number(r.factor),
      flagsOf.get(`${r.board_id}:${r.student_id}`) || null,
      r.suggested_now === null ? null : Number(r.suggested_now),
      final,
      status(r),
      w ? Number(w.held_pct) : null,
      w ? `${w.tasks_done} of ${w.tasks_held}` : null,
      w ? w.tasks_late : null,
    ]
  })

  const confirmed = sheet.filter((r) => r.confirmed_at && r.final !== null)
  const finals = confirmed.map((r) => Number(r.final))
  const average = finals.length ? finals.reduce((s, x) => s + x, 0) / finals.length : null
  const scored = sheet.filter((r) => r.criteria > 0 && r.scored >= r.criteria).length

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Students', value: sheet.length },
        { label: 'Scored', value: scored },
        { label: 'Confirmed', value: confirmed.length },
        { label: 'Released', value: confirmed.filter((r) => r.released).length },
        { label: 'Average final', value: shown(average) },
        { label: 'Median final', value: shown(median(finals)) },
        { label: 'Overridden', value: confirmed.filter((r) => r.overridden).length },
      ],
    },
  ]
  if (sheet.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nobody is on this project yet, so there is nothing to grade.' })
  } else {
    blocks.push({ kind: 'table', id: 'grades', title: 'Grades', columns, rows })
    if (finals.length === 0) {
      blocks.push({
        kind: 'note',
        tone: 'info',
        text: 'No score is confirmed yet. Confirm scores on the project’s Work tab to see the spread.',
      })
    } else {
      const counts = Array.from({ length: 10 }, () => 0)
      for (const f of finals) counts[scoreBand(f, total)] += 1
      const bands = counts.map((n, i) => ({ label: i === 9 ? '90–100%' : `${i * 10}–${i * 10 + 9}%`, value: n }))
      const top = bands.reduce((a, b) => (b.value > a.value ? b : a))
      blocks.push({
        kind: 'chart',
        id: 'spread',
        title: 'Spread of final scores',
        chart: { kind: 'bars', rows: bands, max: Math.max(...counts), unit: '' },
        summary: `${finals.length} confirmed ${finals.length === 1 ? 'score' : 'scores'}; most fall in ${top.label} (${top.value}).`,
      })
    }
  }
  blocks.push({
    kind: 'table',
    id: 'rubric',
    title: 'Rubric',
    columns: [
      { key: 'criterion', label: 'Criterion', type: 'text' },
      { key: 'description', label: 'What earns full marks', type: 'text' },
      { key: 'points', label: 'Points', type: 'number' },
    ],
    rows: criteria.map((c) => [c.label, c.description || null, c.max_points]),
  })

  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: project.title,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: footer(input.professor, true),
  }
}

/** Every student against every project: the grade-book grid. */
export function gradingGridDoc(input: ReportHead & {
  students: { id: string; name: string }[]
  projects: { project: GradingProject; sheet: ScoreSheetRow[] }[]
}): ReportDoc {
  const columns: Column[] = [
    { key: 'student', label: 'Student', type: 'text' },
    ...input.projects.map<Column>(({ project, sheet }) => ({
      key: `p-${project.id}`,
      label: sheet.some((r) => r.released) ? project.title : `${project.title} (not released)`,
      type: 'score',
      outOf: project.total_points,
    })),
    { key: 'overall', label: 'Overall', type: 'percent' },
  ]
  const finalOf = (sheet: ScoreSheetRow[], sid: string) => {
    const r = sheet.find((x) => x.student_id === sid && x.confirmed_at && x.final !== null)
    return r ? Number(r.final) : null
  }
  const rows: Cell[][] = [...input.students]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const cells = input.projects.map(({ sheet }) => finalOf(sheet, s.id))
      let got = 0
      let of = 0
      input.projects.forEach(({ project }, i) => {
        if (cells[i] !== null) {
          got += cells[i] as number
          of += project.total_points
        }
      })
      return [s.name, ...cells, of > 0 ? (got / of) * 100 : null]
    })
  const released = input.projects.filter(({ sheet }) => sheet.some((r) => r.released)).length
  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: 'All projects',
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks: [
      {
        kind: 'kpis',
        items: [
          { label: 'Students', value: input.students.length },
          { label: 'Projects', value: input.projects.length },
          { label: 'Released', value: released },
        ],
      },
      {
        kind: 'table',
        id: 'gradebook',
        title: 'Grade book',
        columns,
        rows,
        note: 'A blank cell has no confirmed score. Overall is the student’s finals over the totals of the projects they have a score on.',
      },
    ],
    footer: footer(input.professor, released < input.projects.length),
  }
}

/** One student across every project of the class. */
export function gradingStudentDoc(input: ReportHead & {
  student: { id: string; name: string }
  projects: {
    project: GradingProject
    row: ScoreSheetRow | null
    criteria: ProjectCriterion[]
    boardScores: BoardScore[]
    peer: PeerResult[]
  }[]
}): ReportDoc {
  const blocks: Block[] = [
    {
      kind: 'table',
      id: 'projects',
      title: 'Projects',
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'final', label: 'Final', type: 'number' },
        { key: 'groupTotal', label: 'Group total', type: 'number' },
        { key: 'adjust', label: 'Adjustment', type: 'number' },
        { key: 'factor', label: 'Peer factor', type: 'number' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      rows: input.projects.map(({ project, row }) => {
        const final = row && row.confirmed_at && row.final !== null ? Number(row.final) : null
        const group = row?.group_total === null || row?.group_total === undefined ? null : Number(row.group_total)
        return [
          `${project.title} (of ${project.total_points})`,
          final,
          group,
          final !== null && group !== null && row?.in_group ? Math.round((final - Math.min(group, project.total_points)) * 2) / 2 : null,
          row?.factor_saved === null || row?.factor_saved === undefined ? null : Number(row.factor_saved),
          row ? status(row) : { value: 'Not on this project', tone: 'pending' },
        ]
      }),
    },
  ]

  for (const { project, row, criteria, boardScores, peer } of input.projects) {
    if (!row) continue
    blocks.push({ kind: 'heading', text: project.title, level: 3 })
    const points = new Map(boardScores.filter((s) => s.board_id === row.board_id).map((s) => [s.criterion_id, Number(s.points)]))
    blocks.push({
      kind: 'table',
      id: `rubric-${project.id}`,
      title: `${project.title}: rubric`,
      columns: [
        { key: 'criterion', label: 'Criterion', type: 'text' },
        { key: 'points', label: 'Points', type: 'number' },
        { key: 'max', label: 'Out of', type: 'number' },
      ],
      rows: criteria.map((c) => [c.label, points.get(c.id) ?? null, c.max_points]),
    })
    const mine = peer.find((p) => p.student_id === input.student.id && p.board_id === row.board_id)
    if (mine && mine.raters >= 2) {
      const team = peer.filter((p) => p.board_id === row.board_id)
      const avg = (key: string) => {
        const xs = team.map((p) => (p as unknown as Record<string, number | null>)[key]).filter((v): v is number => v !== null)
        return xs.length ? Math.round((xs.reduce((s, x) => s + Number(x), 0) / xs.length) * 100) / 100 : null
      }
      blocks.push({
        kind: 'table',
        id: `peer-${project.id}`,
        title: `${project.title}: how teammates saw ${input.student.name}`,
        columns: [
          { key: 'dimension', label: 'Behaviour', type: 'text' },
          { key: 'mine', label: input.student.name, type: 'number' },
          { key: 'team', label: 'Team', type: 'number' },
        ],
        rows: PEER_DIMENSIONS.map((d) => {
          const v = (mine as unknown as Record<string, number | null>)[`${d.key}_avg`]
          return [d.label, v === null ? null : Number(v), avg(`${d.key}_avg`)]
        }),
      })
    }
  }

  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: input.student.name,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: footer(input.professor, input.projects.some(({ row }) => row && !row.released)),
  }
}
