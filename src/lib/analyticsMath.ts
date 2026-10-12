import type { ActivityDay, ActivityKind, TaskState } from './types'

/**
 * The arithmetic under the analytics charts. Pure, so every threshold a
 * professor sees a colour for is pinned by a test.
 */

export const LOW_SHARE_PCT = 10
export const INACTIVE_DAYS = 7
export const OFTEN_LATE_MIN = 3
export const OFTEN_LATE_RATE = 0.3
export const STUCK_DAYS = 7

export type Tone = 'success' | 'warning' | 'danger' | 'pending'

/* ------------------------------------------------------------------ dates */

const DAY_MS = 86_400_000
const MANILA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The day an instant falls on in the Philippines, as YYYY-MM-DD. */
export function manilaDay(t: string | Date): string {
  return MANILA.format(typeof t === 'string' ? new Date(t) : t)
}

const utc = (day: string) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))

export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS)
}

export function mondayOf(day: string): string {
  const dow = new Date(utc(day)).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

/** The Mondays of the last `n` weeks, oldest first, ending with this week's. */
export function lastWeeks(today: string, n: number): string[] {
  const end = mondayOf(today)
  return Array.from({ length: n }, (_, i) => addDays(end, (i - n + 1) * 7))
}

/* ------------------------------------------------------------------ share */

/**
 * How unevenly work is split: 0 is perfectly even, and it approaches 1 as one
 * person holds everything. One member, or nobody holding anything, is 0 —
 * there is no split to be uneven.
 */
export function gini(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0)
  const n = xs.length
  const sum = xs.reduce((s, v) => s + v, 0)
  if (n < 2 || sum === 0) return 0
  let diff = 0
  for (const a of xs) for (const b of xs) diff += Math.abs(a - b)
  return Math.round((diff / (2 * n * sum)) * 1000) / 1000
}

/* --------------------------------------------------------------- activity */

export const WORK_KINDS: readonly ActivityKind[] = ['claimed', 'started', 'finished']
export const TALK_KINDS: readonly ActivityKind[] = ['commented', 'file_added']

export type WeekRow = { week: string; work: number; talk: number }

/** Day rows folded into Monday weeks between two days, empty weeks included. */
export function weeklyActivity(rows: ActivityDay[], from: string, to: string): WeekRow[] {
  const out = new Map<string, WeekRow>()
  for (let w = mondayOf(from); w <= mondayOf(to); w = addDays(w, 7)) {
    out.set(w, { week: w, work: 0, talk: 0 })
  }
  for (const r of rows) {
    const row = out.get(mondayOf(r.day))
    if (!row) continue
    if (WORK_KINDS.includes(r.kind)) row.work += r.n
    else if (TALK_KINDS.includes(r.kind)) row.talk += r.n
  }
  return [...out.values()]
}

export function activeByWeek(rows: ActivityDay[], people: Set<string>, weeks: string[]): number[] {
  const seen = new Map(weeks.map((w) => [w, new Set<string>()]))
  for (const r of rows) {
    if (!r.actor_id || !people.has(r.actor_id)) continue
    seen.get(mondayOf(r.day))?.add(r.actor_id)
  }
  return weeks.map((w) => seen.get(w)?.size ?? 0)
}

/* ---------------------------------------------------------------- burnup */

export type TimedTask = Pick<TaskState, 'created_at' | 'done_at' | 'status'>
export type FinishedTask = Pick<TaskState, 'done_at' | 'status' | 'late'>

export type BurnupPoint = { day: string; scope: number; done: number }

/** The day a task counts as done, or null. A reopened task keeps done_at but is not done. */
const doneDay = (t: Pick<TaskState, 'done_at' | 'status'>) =>
  t.status === 'done' && t.done_at ? manilaDay(t.done_at) : null

/**
 * Tasks that exist, and tasks finished, at the end of each day from `from` to
 * `to`. Work from before `from` is carried into the first day.
 */
export function burnupSeries(tasks: TimedTask[], from: string, to: string): BurnupPoint[] {
  if (to < from) return []
  const created = new Map<string, number>()
  const finished = new Map<string, number>()
  let scope = 0
  let done = 0
  for (const t of tasks) {
    const c = manilaDay(t.created_at)
    if (c <= from) scope++
    else created.set(c, (created.get(c) ?? 0) + 1)
    const d = doneDay(t)
    if (d === null) continue
    if (d <= from) done++
    else finished.set(d, (finished.get(d) ?? 0) + 1)
  }
  const out: BurnupPoint[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (day !== from) {
      scope += created.get(day) ?? 0
      done += finished.get(day) ?? 0
    }
    out.push({ day, scope, done })
  }
  return out
}

/** Per cent done at the end of each week; null for a week with nothing in it yet. */
export function completionByWeek(tasks: TimedTask[], weeks: string[]): (number | null)[] {
  const rows = tasks.map((t) => ({ c: manilaDay(t.created_at), d: doneDay(t) }))
  return weeks.map((w) => {
    const end = addDays(w, 6)
    const scope = rows.filter((r) => r.c <= end).length
    const done = rows.filter((r) => r.d !== null && r.d <= end).length
    return scope === 0 ? null : Math.round((done / scope) * 100)
  })
}

/** Of the tasks finished in each week, the per cent finished on time; null if none were. */
export function onTimeByWeek(tasks: FinishedTask[], weeks: string[]): (number | null)[] {
  const rows = tasks
    .map((t) => ({ d: doneDay(t), late: t.late }))
    .filter((r): r is { d: string; late: boolean } => r.d !== null)
  return weeks.map((w) => {
    const end = addDays(w, 6)
    const inWeek = rows.filter((r) => r.d >= w && r.d <= end)
    if (inWeek.length === 0) return null
    return Math.round((inWeek.filter((r) => !r.late).length / inWeek.length) * 100)
  })
}

/* ---------------------------------------------------------------- health */

export type HealthMeasure = 'pace' | 'overdue' | 'gini' | 'idle' | 'returns'

/**
 * The colour of one cell in the group health grid. `pace` is points of
 * completion ahead of (positive) or behind (negative) the time elapsed.
 */
export function healthTone(measure: HealthMeasure, value: number | null): Tone {
  if (value === null) return 'pending'
  switch (measure) {
    case 'pace':
      return value >= 0 ? 'success' : value > -20 ? 'warning' : 'danger'
    case 'overdue':
      return value === 0 ? 'success' : value <= 2 ? 'warning' : 'danger'
    case 'gini':
      return value < 0.3 ? 'success' : value <= 0.5 ? 'warning' : 'danger'
    case 'idle':
      return value < 4 ? 'success' : value < INACTIVE_DAYS ? 'warning' : 'danger'
    case 'returns':
      return value === 0 ? 'success' : value === 1 ? 'warning' : 'danger'
  }
}

/* --------------------------------------------------------------- students */

export type StudentFlag = 'no_group' | 'holding_nothing' | 'low_share' | 'inactive' | 'often_late'

export type FlagInput = {
  held: number
  done: number
  late: number
  /** Their smallest share on a board of two or more; null when they have none. */
  lowestShare: number | null
  inAnyGroup: boolean
  lastActiveAt: string | null
  termStarted: boolean
}

export function idleDays(last: string | null, now: Date): number | null {
  return last ? daysBetween(manilaDay(last), manilaDay(now)) : null
}

/** Prompts for a conversation, never verdicts. Each one names a fact. */
export function studentFlags(s: FlagInput, now: Date): StudentFlag[] {
  const out: StudentFlag[] = []
  if (!s.inAnyGroup) out.push('no_group')
  else if (s.held === 0) out.push('holding_nothing')
  if (s.held > 0 && s.lowestShare !== null && s.lowestShare < LOW_SHARE_PCT) out.push('low_share')
  const idle = idleDays(s.lastActiveAt, now)
  if (s.termStarted && (idle === null || idle >= INACTIVE_DAYS)) out.push('inactive')
  if (s.late >= OFTEN_LATE_MIN && s.done > 0 && s.late / s.done >= OFTEN_LATE_RATE) {
    out.push('often_late')
  }
  return out
}

/* ------------------------------------------------------------- milestones */

export type MilestoneState = 'met' | 'late' | 'upcoming' | 'no_tasks'

export function milestoneState(
  m: { tasks: number; done: number; due_on: string; last_done_at: string | null },
  today: string,
): MilestoneState {
  if (m.tasks === 0) return 'no_tasks'
  if (m.done === m.tasks) {
    return m.last_done_at && manilaDay(m.last_done_at) <= m.due_on ? 'met' : 'late'
  }
  return today > m.due_on ? 'late' : 'upcoming'
}

export function isStuck(t: Pick<TaskState, 'status' | 'started_at'>, now: Date): boolean {
  return (
    t.status === 'in_progress' &&
    !!t.started_at &&
    daysBetween(manilaDay(t.started_at), manilaDay(now)) >= STUCK_DAYS
  )
}
