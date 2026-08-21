import { CARRYING_ALONE_PCT, burnOwner, calendarDaysUntil, projectBurn } from './types'
import type { BoardBurn } from './types'

/**
 * The reading half of the analytics page: why a board is behind, when its work
 * will land, and what the professor should do about it.
 *
 * Kept out of `types.ts`, which is already the shared vocabulary for nine
 * domains. Everything here is a pure function of rows the database already
 * counted — the views hold no sentences, and this file holds no arithmetic the
 * views could have done.
 *
 * The one number this file is not allowed to invent is the burn projection.
 * `projectBurn` owns it; anything about finishing on time reuses it.
 */

/* ------------------------------------------------------------- thresholds */

/**
 * Mirrored in `supabase/analytics-insight.sql`. They live in two places because
 * one side filters rows and the other writes the sentence about them — if one
 * moves, move both, and the suite will say so.
 */
export const STALLED_DAYS = 7
export const RETURNED_QUIET_DAYS = 3
export const PILE_UP_TASKS = 5
export const REQUEST_WAIT_DAYS = 2

/* ------------------------------------------------------------------ types */

/** board_diagnosis: every cause anybody has evidence for, with its size. */
export type BoardDiagnosis = {
  board_id: string
  class_id: string
  project_id: string
  group_id: string | null
  project_title: string
  owner_name: string | null
  project_due_at: string | null
  project_locked_at: string | null
  submitted_at: string | null
  result_verdict: 'accepted' | 'returned' | null
  result_at: string | null
  task_count: number
  done_count: number
  unclaimed_count: number
  late_count: number
  member_count: number
  done_pct: number
  last_activity: string | null
  release_at: string | null
  /** Null when nothing has ever moved — a different problem from going quiet. */
  idle_days: number | null
  never_started: boolean
  overdue_open_count: number
  top_holder_id: string | null
  top_holder_name: string | null
  top_holder_pct: number | null
  members_holding_nothing: number | null
  unclaim_events: number
  reopened_events: number
  reassignments_total: number
  reassignments_pending: number
  oldest_pending_at: string | null
  returned_untouched: boolean
}

/** class_participation: one active member of a class, and what they are near. */
export type Participation = {
  class_id: string
  student_id: string
  student_name: string
  avatar_url: string | null
  boards_on: number
  tasks_held: number
  tasks_done: number
  last_move: string | null
  in_any_group: boolean
}

/** deadline_pressure: open work, bucketed by the week it falls due. */
export type Pressure = {
  class_id: string
  overdue: boolean
  week_start: string | null
  due_count: number
  board_count: number
  project_count: number
}

export type ActionKind =
  | 'overdue_work'
  | 'returned_untouched'
  | 'stalled_board'
  | 'empty_board'
  | 'unclaimed_work'
  | 'carrying_alone'
  | 'not_in_a_group'
  | 'holding_nothing'
  | 'pending_reassignment'
  | 'deadline_pile_up'
  | 'syllabus_gap'
  | 'class_unmeasured'
  /** Composed here rather than in SQL: it needs the burn projection. */
  | 'will_miss_deadline'

/** class_actions: the facts arguing for one recommendation. */
export type ActionRow = {
  class_id: string
  kind: ActionKind
  severity: number
  subject_kind: 'class' | 'project' | 'board' | 'student' | 'week'
  subject_id: string | null
  subject_name: string | null
  project_id: string | null
  board_id: string | null
  student_id: string | null
  n: number
  at: string | null
}

/** One recommendation as the page renders it. */
export type Action = {
  key: string
  kind: ActionKind
  severity: number
  title: string
  evidence: string
  to: string | null
  /** Set when several rows of one kind were folded into a single card. */
  names?: string[]
  classId: string
  boardId: string | null
  projectId: string | null
}

/* ------------------------------------------------------------ diagnostics */

export type Cause = {
  key: string
  /** Ordered by how much it explains, worst first. */
  weight: number
  text: string
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

/**
 * Why this board is where it is, in the order the causes matter.
 *
 * Every line is a fact with its number in it. There is no cause here that is
 * not measured — "the group is unmotivated" is not something a database knows,
 * and a page that guessed it would be worse than one that says nothing.
 */
export function boardCauses(d: BoardDiagnosis): Cause[] {
  const out: Cause[] = []

  if (d.task_count === 0) {
    out.push({
      key: 'empty',
      weight: 90,
      text: 'The board has no tasks on it, so there is nothing to do or to measure.',
    })
  }

  if (d.never_started && d.task_count > 0) {
    out.push({
      key: 'never_started',
      weight: 85,
      text: `${d.task_count} ${plural(d.task_count, 'task')} set and not one has been started.`,
    })
  }

  if (d.overdue_open_count > 0) {
    out.push({
      key: 'overdue',
      weight: 80,
      text: `${d.overdue_open_count} ${plural(d.overdue_open_count, 'task')} past ${
        plural(d.overdue_open_count, 'its', 'their')
      } date and still open.`,
    })
  }

  if (d.returned_untouched && d.result_at) {
    const days = Math.abs(calendarDaysUntil(d.result_at))
    out.push({
      key: 'returned',
      weight: 75,
      text: `Returned ${days} ${plural(days, 'day')} ago and nothing has moved since.`,
    })
  }

  if (d.unclaimed_count > 0) {
    out.push({
      key: 'unclaimed',
      weight: 70,
      text: `${d.unclaimed_count} ${plural(d.unclaimed_count, 'task')} nobody has claimed.`,
    })
  }

  if (d.idle_days !== null && d.idle_days >= STALLED_DAYS && !d.submitted_at) {
    out.push({
      key: 'idle',
      weight: 65,
      text: `Nothing has changed on it for ${d.idle_days} days.`,
    })
  }

  if (
    d.group_id &&
    d.top_holder_name &&
    d.top_holder_pct !== null &&
    d.top_holder_pct >= CARRYING_ALONE_PCT &&
    (d.members_holding_nothing ?? 0) > 0
  ) {
    out.push({
      key: 'carrying',
      weight: 60,
      text: `${d.top_holder_name} holds ${Math.round(d.top_holder_pct)}% of the board while ${
        d.members_holding_nothing
      } ${plural(d.members_holding_nothing ?? 0, 'member', 'members')} ${plural(
        d.members_holding_nothing ?? 0,
        'holds',
        'hold',
      )} nothing.`,
    })
  }

  if (d.reassignments_pending > 0) {
    out.push({
      key: 'pending',
      weight: 55,
      text: `${d.reassignments_pending} reassignment ${plural(
        d.reassignments_pending,
        'request',
      )} waiting on you.`,
    })
  }

  if (d.unclaim_events >= 3) {
    out.push({
      key: 'churn',
      weight: 40,
      text: `Work has been handed back ${d.unclaim_events} times — the tasks keep moving between people.`,
    })
  }

  if (d.reopened_events > 0) {
    out.push({
      key: 'reopened',
      weight: 35,
      text: `${d.reopened_events} ${plural(
        d.reopened_events,
        'task',
      )} called done and reopened.`,
    })
  }

  return out.sort((a, b) => b.weight - a.weight)
}

/* -------------------------------------------------------------- forecasts */

export type Forecast = {
  burn: ReturnType<typeof projectBurn>
  /** The day the remaining work lands at the rate measured. Null with no rate. */
  finishOn: Date | null
  /** Days past the deadline it lands. Null when it lands in time or has none. */
  lateBy: number | null
}

/**
 * When this board's work lands, at the rate it is actually moving.
 *
 * The division is `projectBurn`'s and stays there. This only turns "18 days
 * needed" into a date, because a date is what a professor plans against.
 */
export function forecast(b: BoardBurn): Forecast {
  const burn = projectBurn(b)
  if (burn.state !== 'projected' && burn.state !== 'no_deadline') {
    return { burn, finishOn: null, lateBy: null }
  }
  const finishOn = new Date()
  finishOn.setDate(finishOn.getDate() + burn.daysNeeded)
  const lateBy =
    burn.state === 'projected' && !burn.fits ? burn.daysNeeded - burn.daysLeft : null
  return { burn, finishOn, lateBy }
}

export const shortDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/* ------------------------------------------------------------ prescriptive */

/** Where a professor goes to act on one kind of finding. */
function routeFor(a: ActionRow): string | null {
  switch (a.kind) {
    case 'pending_reassignment':
      return '/professor/reassignments'
    case 'syllabus_gap':
    case 'class_unmeasured':
      return `/professor/classes/${a.class_id}`
    case 'deadline_pile_up':
      return '/professor/calendar'
    case 'not_in_a_group':
    case 'holding_nothing':
      return '/professor/groups'
    default:
      return a.project_id ? `/professor/projects/${a.project_id}` : null
  }
}

/** Kinds that repeat per student or per board and are worth folding into one. */
const FOLDED: ActionKind[] = [
  'empty_board',
  'holding_nothing',
  'not_in_a_group',
  'syllabus_gap',
]

function sentence(a: ActionRow): { title: string; evidence: string } {
  const who = a.subject_name ?? 'A board'
  switch (a.kind) {
    case 'overdue_work':
      return {
        title: `${who} has work past its date`,
        evidence: `${a.n} ${plural(a.n, 'task')} due and not done. Open the board and decide whether the date moves or the work does.`,
      }
    case 'returned_untouched':
      return {
        title: `${who} has not touched the work you returned`,
        evidence: `Returned ${a.n} days ago and nothing has changed since. They may not have read the reason.`,
      }
    case 'stalled_board':
      return {
        title: `${who} has stopped`,
        evidence: `Nothing has moved for ${a.n} days, and the board is not finished. Ask them where it stands.`,
      }
    case 'empty_board':
      return {
        title: `${who} has an empty board`,
        evidence: 'The project is out and no task has been added to it yet.',
      }
    case 'unclaimed_work':
      return {
        title: `${who} has work nobody has taken`,
        evidence: `${a.n} ${plural(a.n, 'task')} unclaimed. Until somebody holds them they cannot start.`,
      }
    case 'carrying_alone':
      return {
        title: `${who} is carrying their group`,
        evidence: `They hold ${a.n}% of the board while somebody on it holds nothing. Split the work or move a task.`,
      }
    case 'not_in_a_group':
      return {
        title: `${who} is in no group`,
        evidence: 'The class has group work out and they are not on any board of it.',
      }
    case 'holding_nothing':
      return {
        title: `${who} holds no task`,
        evidence: 'They are on a board and have taken nothing from it.',
      }
    case 'pending_reassignment':
      return {
        title: `A reassignment on ${who} is waiting on you`,
        evidence: `Asked ${a.n} days ago. The student cannot move until it is decided.`,
      }
    case 'deadline_pile_up':
      return {
        title: `${a.n} tasks all fall due in one week`,
        evidence: `Week of ${who}. There is still time to move something.`,
      }
    case 'syllabus_gap':
      return {
        title: `${who} names an assessment with nothing set`,
        evidence: 'The syllabus asks for something that week and no project covers it.',
      }
    case 'class_unmeasured':
      return {
        title: `${who} cannot be measured yet`,
        evidence:
          a.n === 2
            ? 'It has no term dates and no syllabus, so no figure on this page includes it.'
            : 'Its term dates or its syllabus are missing, so no figure on this page includes it.',
      }
    case 'will_miss_deadline':
      return { title: `${who} will miss its deadline`, evidence: '' }
  }
}

function fold(kind: ActionKind, rows: ActionRow[]): Action {
  const names = rows.map((r) => r.subject_name ?? '').filter(Boolean)
  const first = rows[0]
  const n = rows.length
  const titles: Record<string, { title: string; evidence: string }> = {
    empty_board: {
      title: `${n} boards have no tasks on them`,
      evidence: 'The projects are out and nobody has put work on these boards yet.',
    },
    holding_nothing: {
      title: `${n} students hold no task`,
      evidence: 'They are on a board and have taken nothing from it.',
    },
    not_in_a_group: {
      title: `${n} students are in no group`,
      evidence: 'The class has group work out and they are on no board of it.',
    },
    syllabus_gap: {
      title: `${n} weeks name an assessment with nothing set`,
      evidence:
        'The syllabus asks for something in those weeks and no project covers them. They are listed in full above.',
    },
  }
  const copy = titles[kind] ?? sentence(first)
  return {
    key: `${kind}-${first.class_id}`,
    kind,
    severity: first.severity,
    title: copy.title,
    evidence: copy.evidence,
    to: routeFor(first),
    names,
    classId: first.class_id,
    boardId: null,
    projectId: null,
  }
}

/**
 * The recommendations, worst first.
 *
 * Two things happen here that the database deliberately left alone. The
 * deadline projection is composed from `board_burn`, because the arithmetic
 * lives in `projectBurn` and nowhere else. And the kinds that repeat once per
 * student — twelve people holding nothing is one problem, not twelve — fold
 * into a single card that names them. A list of thirty cards is a list nobody
 * reads to the end.
 */
export function rankActions(rows: ActionRow[], burns: BoardBurn[]): Action[] {
  const projected: Action[] = burns
    .filter((b) => !b.submitted_at && b.result_verdict !== 'accepted')
    .map((b) => ({ b, f: forecast(b) }))
    .filter(({ f }) => f.lateBy !== null)
    .map(({ b, f }) => ({
      key: `will_miss_deadline-${b.board_id}`,
      kind: 'will_miss_deadline' as const,
      severity: 2,
      title: `${burnOwner(b)} will miss its deadline`,
      evidence:
        `${b.done_count} of ${b.task_count} tasks in ${b.days_active} days — ` +
        `${projectBurnRate(b)} a day. The remaining ${b.task_count - b.done_count} need about ` +
        `${f.burn.state === 'projected' ? f.burn.daysNeeded : 0} days and ${b.days_left} are left, ` +
        `so it lands around ${f.finishOn ? shortDate(f.finishOn) : '—'}, ${f.lateBy} days late.`,
      to: `/professor/projects/${b.project_id}`,
      classId: b.class_id,
      boardId: b.board_id,
      projectId: b.project_id,
    }))

  const folded = new Map<ActionKind, ActionRow[]>()
  const single: Action[] = []

  for (const r of rows) {
    if (FOLDED.includes(r.kind)) {
      const list = folded.get(r.kind) ?? []
      list.push(r)
      folded.set(r.kind, list)
      continue
    }
    const copy = sentence(r)
    single.push({
      key: `${r.kind}-${r.subject_id ?? r.board_id ?? r.class_id}-${r.at ?? ''}`,
      kind: r.kind,
      severity: r.severity,
      title: copy.title,
      evidence: copy.evidence,
      to: routeFor(r),
      classId: r.class_id,
      boardId: r.board_id,
      projectId: r.project_id,
    })
  }

  const groups = [...folded.entries()].flatMap(([kind, list]) => {
    // One card per class, so a professor with two classes is not told about
    // both under one heading.
    const byClass = new Map<string, ActionRow[]>()
    for (const r of list) byClass.set(r.class_id, [...(byClass.get(r.class_id) ?? []), r])
    return [...byClass.values()].map((rowsForClass) =>
      rowsForClass.length === 1
        ? {
            ...fold(kind, rowsForClass),
            ...sentence(rowsForClass[0]),
            key: `${kind}-${rowsForClass[0].subject_id}`,
            names: undefined,
          }
        : fold(kind, rowsForClass),
    )
  })

  return [...projected, ...single, ...groups].sort(
    (a, b) => a.severity - b.severity || a.title.localeCompare(b.title),
  )
}

/** The rate `projectBurn` measured, for printing beside the projection. */
function projectBurnRate(b: BoardBurn) {
  const burn = projectBurn(b)
  return burn.state === 'projected' || burn.state === 'no_deadline' ? burn.rate : 0
}
