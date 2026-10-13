import { INACTIVE_DAYS, STUCK_DAYS, addDays, daysBetween, manilaDay, mondayOf, weeklyActivity } from '../analyticsMath'
import type { Action } from '../insight'
import type { ActivityDay, ClassNote, MilestoneProgress, RosterRow, TaskState } from '../types'
import type { Block, Cell, Kpi, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { previousRange, rangeText } from './range'
import type { DayRange } from './range'

export type CheckInBoard = { board_id: string; project_id: string; name: string; project_title: string; submitted_at: string | null }
export type CheckInResult = { board_id: string; verdict: 'accepted' | 'returned'; decided_at: string }
export type CheckInProject = {
  id: string
  title: string
  due_at: string | null
  release_at: string | null
  archived_at: string | null
  created_at: string
}

export type CheckInInput = ReportHead & {
  range: DayRange
  /** Today, a Manila day. Nothing is measured past it. */
  today: string
  /** First day of the term (a Manila day). Nobody is called never-active before it starts. */
  termStart: string | null
  /** The class has ended; Phase A views carry nothing for it. */
  ended: boolean
  activity: ActivityDay[]
  tasks: TaskState[]
  boards: CheckInBoard[]
  results: CheckInResult[]
  roster: RosterRow[]
  milestones: MilestoneProgress[]
  projects: CheckInProject[]
  actions: Action[]
  notes: ClassNote[]
  noteName: (n: ClassNote) => string
}

export type WeekFigures = { finished: number; started: number; comments: number; handIns: number; returns: number; active: number }

const within = (day: string, r: DayRange) => day >= r.from && day <= r.to

/**
 * The day a check-in is measured to: the last day of the range once it has
 * ended, and today while it runs. A past week reads the same every time it is
 * printed, and a running one never counts days that have not happened.
 */
export function checkInAsOf(r: DayRange, today: string): string {
  return r.to < today ? r.to : today
}

/** The projects a check-in reads as of a day: not archived, and released by then. */
export function liveProjects<P extends Pick<CheckInProject, 'archived_at' | 'release_at'>>(projects: P[], asOf: string): P[] {
  return projects.filter((p) => !p.archived_at && (!p.release_at || manilaDay(p.release_at) <= asOf))
}

/** Rows on those projects. A row on no project (about the class or a student) stays. */
export function onProjects<T extends { project_id: string | null }>(rows: T[], ids: Set<string>): T[] {
  return rows.filter((x) => x.project_id === null || ids.has(x.project_id))
}

export function weekFigures(
  input: Pick<CheckInInput, 'activity' | 'boards' | 'results' | 'roster'>,
  r: DayRange,
): WeekFigures {
  const sum = (kind: ActivityDay['kind']) =>
    input.activity.filter((a) => a.kind === kind && within(a.day, r)).reduce((s, a) => s + a.n, 0)
  const students = new Set(input.roster.map((s) => s.student_id))
  const active = new Set(
    input.activity.filter((a) => within(a.day, r) && a.actor_id && students.has(a.actor_id)).map((a) => a.actor_id),
  )
  return {
    finished: sum('finished'),
    started: sum('started'),
    comments: sum('commented'),
    handIns: input.boards.filter((b) => b.submitted_at && within(manilaDay(b.submitted_at), r)).length,
    returns: input.results.filter((x) => x.verdict === 'returned' && within(manilaDay(x.decided_at), r)).length,
    active: active.size,
  }
}

const SEVERITY: Record<number, { value: string; tone: 'danger' | 'warning' | 'pending' }> = {
  1: { value: 'Urgent', tone: 'danger' },
  2: { value: 'Soon', tone: 'warning' },
  3: { value: 'Note', tone: 'pending' },
}
const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const dayText = (day: string) => DAY.format(new Date(`${day}T00:00:00+08:00`))
const brief = (s: string) => (s.trim().length > 140 ? `${s.trim().slice(0, 140)}…` : s.trim())

export function checkInDoc(input: CheckInInput): ReportDoc {
  const r = input.range
  const asOf = checkInAsOf(r, input.today)
  const started = asOf >= r.from
  // Counted from the first day to as-of, and compared with as many days just before.
  const span: DayRange = { from: r.from, to: started ? asOf : r.from }
  const prev = previousRange(span)
  const aWeek = daysBetween(r.from, r.to) === 6
  const header = {
    title: 'Weekly class check-in',
    subtitle: rangeText(r),
    classLine: input.classLine,
    rangeLabel: `Compared with ${rangeText(prev)}`,
    madeAt: input.madeAt,
  }
  const footer = {
    lines: ['Counts are events recorded in Collabify. A flag is a prompt for a conversation, not a verdict.'],
    signatures: [{ role: 'Prepared by', name: input.professor }],
  }
  if (input.ended) {
    return { header, blocks: [{ kind: 'note', tone: 'info', text: 'This class has ended. The weekly check-in covers live classes.' }], footer }
  }

  // Only projects that are live and released by as-of; an archived or unreleased one appears nowhere.
  const projects = liveProjects(input.projects, asOf)
  const projectIds = new Set(projects.map((p) => p.id))
  const liveBoards = input.boards.filter((b) => projectIds.has(b.project_id))
  const boardIds = new Set(liveBoards.map((b) => b.board_id))
  const activity = onProjects(input.activity, projectIds)
  const tasks = onProjects(input.tasks, projectIds)
  const milestones = onProjects(input.milestones, projectIds)
  const results = input.results.filter((x) => boardIds.has(x.board_id))
  const actions = input.actions.filter((a) => !a.projectId || projectIds.has(a.projectId))
  const scoped = { activity, boards: liveBoards, results, roster: input.roster }

  const now = started ? weekFigures(scoped, span) : weekFigures({ ...scoped, activity: [], boards: [], results: [] }, span)
  const before = weekFigures(scoped, prev)
  const kpi = (label: string, k: keyof WeekFigures): Kpi => ({ label, value: now[k], delta: now[k] - before[k] })

  const blocks: Block[] = []
  if (!started) {
    blocks.push({ kind: 'note', tone: 'info', text: 'These dates have not started yet, so every count reads 0.' })
  } else if (asOf < r.to) {
    blocks.push({ kind: 'note', tone: 'info', text: `${aWeek ? 'This week' : 'These dates'} so far: ${rangeText(span)}.` })
  }
  blocks.push({
    kind: 'kpis',
    compareLabel: rangeText(prev),
    items: [
      kpi('Tasks finished', 'finished'),
      kpi('Tasks started', 'started'),
      kpi('Hand-ins', 'handIns'),
      kpi('Returns', 'returns'),
      kpi('Comments', 'comments'),
      kpi('Students active', 'active'),
    ],
  })

  // Moved: every board, quiet ones included, so silence shows.
  const boards = [...liveBoards].sort((a, b) => a.name.localeCompare(b.name) || a.project_title.localeCompare(b.project_title))
  const inSpan = (day: string) => started && within(day, span)
  if (boards.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'This class has no project boards yet.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'moved',
      title: aWeek ? 'Moved this week' : 'Moved in these dates',
      columns: [
        { key: 'group', label: 'Group', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'finished', label: 'Finished', type: 'number' },
        { key: 'started', label: 'Started', type: 'number' },
        { key: 'comments', label: 'Comments', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'date' },
        { key: 'returns', label: 'Returns', type: 'number' },
      ],
      rows: boards.map<Cell[]>((b) => {
        const mine = activity.filter((a) => a.board_id === b.board_id && inSpan(a.day))
        const n = (kind: ActivityDay['kind']) => mine.filter((a) => a.kind === kind).reduce((s, a) => s + a.n, 0)
        return [
          b.name,
          b.project_title,
          n('finished'),
          n('started'),
          n('commented'),
          b.submitted_at && inSpan(manilaDay(b.submitted_at)) ? b.submitted_at : null,
          results.filter((x) => x.board_id === b.board_id && x.verdict === 'returned' && inSpan(manilaDay(x.decided_at))).length,
        ]
      }),
    })
  }

  // Stuck, measured as of the last day of the range, or today while it runs.
  // Judged by started_at and done_at, not today's status, so a past week reads as it stood.
  const doneBy = (t: TaskState) => t.status === 'done' && !t.done_at ? true : !!t.done_at && manilaDay(t.done_at) <= asOf
  const termStarted = input.termStart !== null && input.termStart <= asOf
  const stuckTasks: { row: Cell[]; days: number }[] = []
  for (const t of tasks) {
    if (!t.started_at) continue
    const since = manilaDay(t.started_at)
    if (since > asOf || doneBy(t)) continue
    const days = daysBetween(since, asOf)
    if (days >= STUCK_DAYS) {
      stuckTasks.push({ row: [{ value: 'Task', tone: 'warning' }, t.title, `${t.group_name ?? t.board_student_name ?? 'A board'} · ${t.project_title}`, since, days], days })
    }
  }
  const stuck: Cell[][] = stuckTasks.sort((a, b) => b.days - a.days).map((x) => x.row)
  // A group is never active only once its project has been out a while: from the
  // later of the term's start and the project's release (or, unreleased, its making).
  const projectDay = new Map(projects.map((p) => [p.id, manilaDay(p.release_at ?? p.created_at)]))
  for (const b of boards) {
    if (b.submitted_at && manilaDay(b.submitted_at) <= asOf) continue
    const days = activity.filter((a) => a.board_id === b.board_id && a.day <= asOf).map((a) => a.day).sort()
    const last = days.at(-1) ?? null
    const idle = last ? daysBetween(last, asOf) : null
    let flag: boolean
    if (idle !== null) flag = idle >= INACTIVE_DAYS
    else if (input.termStart === null) flag = false
    else {
      const out = projectDay.get(b.project_id) ?? input.termStart
      flag = daysBetween(out > input.termStart ? out : input.termStart, asOf) >= INACTIVE_DAYS
    }
    if (flag) stuck.push([{ value: 'Group', tone: 'warning' }, b.name, b.project_title, last, idle])
  }
  for (const s of [...input.roster].sort((a, b) => a.student_name.localeCompare(b.student_name))) {
    const days = activity.filter((a) => a.actor_id === s.student_id && a.day <= asOf).map((a) => a.day).sort()
    const last = days.at(-1) ?? null
    const idle = last ? daysBetween(last, asOf) : null
    if (idle === null ? termStarted : idle >= INACTIVE_DAYS) {
      stuck.push([{ value: 'Student', tone: 'pending' }, s.student_name, s.group_names.join(', ') || null, last, idle])
    }
  }
  if (stuck.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing is stuck: no task has sat in progress, and every group and student has been active.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'stuck',
      title: 'Stuck',
      columns: [
        { key: 'type', label: 'What', type: 'status' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'where', label: 'Where', type: 'text' },
        { key: 'since', label: 'Last moved', type: 'date' },
        { key: 'days', label: 'Days', type: 'number' },
      ],
      rows: stuck,
      note: `A task counts after ${STUCK_DAYS} days in progress; a group or student after ${INACTIVE_DAYS} days with no activity. Never active shows no date: a student is listed once the term has started, a group ${INACTIVE_DAYS} days after both the term and its project have started.`,
    })
  }

  // Coming up: the 7 days after as-of.
  const from = addDays(asOf, 1)
  const to = addDays(asOf, 7)
  const soon = (day: string) => day >= from && day <= to
  const coming: Cell[][] = []
  for (const t of tasks) {
    if (!t.due_at || doneBy(t)) continue
    const d = manilaDay(t.due_at)
    if (soon(d)) coming.push([d, 'Task', t.title, `${t.group_name ?? t.board_student_name ?? 'A board'} · ${t.project_title}`])
  }
  for (const p of projects) {
    if (p.due_at && soon(manilaDay(p.due_at))) coming.push([manilaDay(p.due_at), 'Project', p.title, null])
  }
  const seen = new Set<string>()
  for (const m of milestones) {
    if (seen.has(m.milestone_id) || !soon(m.due_on)) continue
    seen.add(m.milestone_id)
    coming.push([m.due_on, 'Milestone', m.name, projects.find((p) => p.id === m.project_id)?.title ?? null])
  }
  const ORDER = { Task: 0, Milestone: 1, Project: 2 } as Record<string, number>
  coming.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || ORDER[String(a[1])] - ORDER[String(b[1])])
  if (coming.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: `Nothing falls due between ${dayText(from)} and ${dayText(to)}.` })
  } else {
    blocks.push({
      kind: 'table',
      id: 'coming',
      title: 'Coming up in the next 7 days',
      columns: [
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'what', label: 'What', type: 'text' },
        { key: 'where', label: 'Where', type: 'text' },
      ],
      rows: coming,
    })
  }

  // Needs attention: the ranked list as of now, then every follow-up still open
  // as of as-of and due by a week after it, overdue ones included.
  const openBy = (n: ClassNote) => !n.resolved_at || manilaDay(n.resolved_at) > asOf
  const attention: Cell[][] = [
    ...actions.map<Cell[]>((a) => [SEVERITY[a.severity] ?? SEVERITY[3], a.title, a.evidence || null]),
    ...input.notes
      .filter((n): n is ClassNote & { follow_up_on: string } => n.follow_up_on !== null && n.follow_up_on <= to && openBy(n))
      .sort((a, b) => a.follow_up_on.localeCompare(b.follow_up_on))
      .map<Cell[]>((n) => {
        const overdue = n.follow_up_on < asOf
        return [
          overdue ? { value: 'Overdue', tone: 'danger' } : { value: 'Follow-up', tone: 'warning' },
          `Follow up with ${input.noteName(n)}`,
          `${overdue ? 'Was due' : 'Due'} ${dayText(n.follow_up_on)}. Noted: ${brief(n.body)}`,
        ]
      }),
  ]
  if (attention.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing needs you right now.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'attention',
      title: 'Needs attention',
      columns: [
        { key: 'level', label: 'Level', type: 'status' },
        { key: 'what', label: 'What', type: 'text' },
        { key: 'why', label: 'Why', type: 'text' },
      ],
      rows: attention,
      note: 'The ranked list is as of the day this report was made.',
    })
  }

  const weeks = weeklyActivity(activity.filter((a) => a.day <= asOf), addDays(mondayOf(asOf), -49), asOf)
  const last = weeks.at(-1)
  const avg = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.work + w.talk, 0) / weeks.length) : 0
  blocks.push({
    kind: 'chart',
    id: 'weekly',
    title: 'Activity, the last 8 weeks',
    chart: { kind: 'weekBars', rows: weeks },
    summary: `The week ending ${dayText(asOf)}: ${last?.work ?? 0} work events and ${last?.talk ?? 0} comments or files. The 8-week average is ${avg} a week.`,
  })

  return { header, blocks, footer }
}
