/**
 * Where a task sits on a project's timeline.
 *
 * The chart is a grid of columns at one of three scales: months, weeks
 * (Monday first, like the calendar) or the days of one month. Every column is
 * the same width on screen, so a position is worked out inside the column it
 * falls in: a date lands on its own day even though months differ in length.
 * Answers are percentages of the chart's width, drawn with CSS offsets.
 * Nothing in this file knows about React.
 */

export type WorkStatus = 'todo' | 'in_progress' | 'done'

/**
 * One task as the timeline sees it, from either space. `group_id` is a work
 * project's team or, on a professor's view of a class project, a board.
 */
export type TimelineTask = {
  id: string
  title: string
  status: WorkStatus
  starts_at: string | null
  due_at: string | null
  group_id: string | null
}

export type TimelineRow = { group: string | null; groupName: string; tasks: TimelineTask[] }

export type Scale = 'month' | 'week' | 'day'

export const SCALE_LABEL: Record<Scale, string> = { month: 'Months', week: 'Weeks', day: 'Days' }

/** On-screen width of one column, in pixels. */
export const COLUMN_WIDTH: Record<Scale, number> = { month: 128, week: 92, day: 40 }

export type Range = { start: number; end: number }

export type Column = {
  start: number
  end: number
  /** The column's own label: "Oct", "Oct 12", "12". */
  label: string
  /** A second line: the weekday under a day, the week's last day under a week. */
  sub: string
  /** Saturdays and Sundays in day scale. */
  weekend: boolean
  /** Holds today. */
  today: boolean
}

/** A label spanning several columns in the header's top row: a year, or a month. */
export type ColumnGroup = { label: string; span: number }

export type Chart = { scale: Scale; start: number; end: number; columns: Column[]; groups: ColumnGroup[] }

const DAY = 86_400_000

/** A project's dates are calendar days, so they are parsed as local midnight. */
function dayStart(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function instant(iso: string | null) {
  return iso ? new Date(iso).getTime() : null
}

function taskDates(task: TimelineTask) {
  return [instant(task.starts_at), instant(task.due_at)].filter((n): n is number => n !== null)
}

const midnight = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const monthStart = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
const addMonths = (t: number, n: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime()
}
const addDaysAt = (t: number, n: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}
const mondayOf = (t: number) => addDaysAt(midnight(t), -((new Date(t).getDay() + 6) % 7))

/** `YYYY-MM` for the month holding `t`. */
export function monthKey(t: number) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fromMonthKey(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).getTime()
}

export function monthLabel(key: string) {
  return new Date(fromMonthKey(key)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/**
 * Every date the chart draws: the tasks' starts and dues, plus `extra`
 * (sprint ends, milestones). The project's own dates are only a fallback for a
 * project whose work has no dates yet: the chart follows the work.
 */
export function dataRange(
  tasks: readonly TimelineTask[],
  extra: readonly number[] = [],
  project: { starts_on: string | null; ends_on: string | null } = { starts_on: null, ends_on: null },
): Range | null {
  const all = [...tasks.flatMap(taskDates), ...extra.filter(Number.isFinite)]
  if (all.length === 0) {
    if (project.starts_on && project.ends_on) {
      const start = dayStart(project.starts_on)
      const end = dayStart(project.ends_on) + DAY
      return end > start ? { start, end } : null
    }
    return null
  }
  const start = Math.min(...all)
  const end = Math.max(...all)
  return { start, end: end > start ? end : start + 1 }
}

/** Days for a month or less, weeks for up to about six months, months beyond. */
export function defaultScale(range: Range): Scale {
  const days = (range.end - range.start) / DAY
  if (days <= 31 && monthKey(range.start) === monthKey(range.end - 1)) return 'day'
  if (days <= 182) return 'week'
  return 'month'
}

/** The months the range touches, oldest first, as `YYYY-MM`. */
export function monthsIn(range: Range): string[] {
  const out: string[] = []
  for (let t = monthStart(range.start), i = 0; t < range.end && i < 240; t = addMonths(t, 1), i++) out.push(monthKey(t))
  return out
}

/** This month when the work runs through it, else the first month with work in it. */
export function defaultMonth(range: Range, now = Date.now()) {
  const months = monthsIn(range)
  return months.includes(monthKey(now)) ? monthKey(now) : months[0]
}

/**
 * The chart's columns. Month and week scales cover the whole range, widened
 * to whole units; day scale covers `month` (a `YYYY-MM`) alone.
 */
export function buildChart(scale: Scale, range: Range, month?: string, now = Date.now()): Chart {
  const columns: Column[] = []
  const today = midnight(now)
  const push = (start: number, end: number, label: string, sub: string, weekend = false) =>
    columns.push({ start, end, label, sub, weekend, today: today >= start && today < end })

  if (scale === 'day') {
    const first = fromMonthKey(month ?? monthKey(range.start))
    const next = addMonths(first, 1)
    for (let t = first; t < next; t = addDaysAt(t, 1)) {
      const d = new Date(t)
      push(
        t,
        addDaysAt(t, 1),
        String(d.getDate()),
        d.toLocaleDateString('en-US', { weekday: 'narrow' }),
        d.getDay() === 0 || d.getDay() === 6,
      )
    }
  } else if (scale === 'week') {
    // Guarded rather than while(true): a bad range must not hang the page.
    for (let t = mondayOf(range.start), i = 0; t < range.end && i < 520; t = addDaysAt(t, 7), i++) {
      const last = new Date(addDaysAt(t, 6))
      push(
        t,
        addDaysAt(t, 7),
        new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        `to ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      )
    }
  } else {
    for (let t = monthStart(range.start), i = 0; t < range.end && i < 240; t = addMonths(t, 1), i++) {
      push(t, addMonths(t, 1), new Date(t).toLocaleDateString('en-US', { month: 'short' }), '')
    }
  }

  // The header's top row: the year over months, the month over weeks and days.
  const groupOf = (c: Column) =>
    scale === 'month'
      ? String(new Date(c.start).getFullYear())
      : new Date(c.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const groups: ColumnGroup[] = []
  for (const c of columns) {
    const label = groupOf(c)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.span++
    else groups.push({ label, span: 1 })
  }

  return { scale, start: columns[0]?.start ?? range.start, end: columns[columns.length - 1]?.end ?? range.end, columns, groups }
}

/** Where `t` falls across the chart, 0 to 100, counted inside its own column. */
export function xOf(chart: Chart, t: number) {
  const n = chart.columns.length
  if (n === 0 || t <= chart.start) return 0
  if (t >= chart.end) return 100
  const i = chart.columns.findIndex((c) => t >= c.start && t < c.end)
  const c = chart.columns[i]
  return ((i + (t - c.start) / (c.end - c.start)) / n) * 100
}

export type Placement =
  /** `clippedStart`/`clippedEnd`: the bar runs on past that edge of the chart. */
  | { shape: 'bar'; left: number; width: number; clippedStart: boolean; clippedEnd: boolean }
  | { shape: 'diamond'; left: number }
  /** Dated, but wholly before or after what the chart shows (another month in day scale). */
  | { shape: 'outside'; side: 'before' | 'after' }
  | { shape: 'none' }

/**
 * A task with both dates is a bar from the start of its first day to the end
 * of its last; one with a single date is a diamond in the middle of that day.
 */
export function placeTask(task: TimelineTask, chart: Chart): Placement {
  const from = instant(task.starts_at)
  const to = instant(task.due_at)
  if (from === null && to === null) return { shape: 'none' }

  if (from !== null && to !== null) {
    const start = midnight(Math.min(from, to))
    const end = addDaysAt(midnight(Math.max(from, to)), 1)
    if (end <= chart.start) return { shape: 'outside', side: 'before' }
    if (start >= chart.end) return { shape: 'outside', side: 'after' }
    const left = xOf(chart, start)
    return {
      shape: 'bar',
      left,
      width: Math.max(0.4, xOf(chart, end) - left),
      clippedStart: start < chart.start,
      clippedEnd: end > chart.end,
    }
  }

  const at = midnight((from ?? to)!) + DAY / 2
  if (at < chart.start) return { shape: 'outside', side: 'before' }
  if (at >= chart.end) return { shape: 'outside', side: 'after' }
  return { shape: 'diamond', left: xOf(chart, at) }
}

/** Where today sits, or null when the chart does not show it. */
export function nowMarker(chart: Chart, now = Date.now()): number | null {
  if (now < chart.start || now >= chart.end) return null
  return xOf(chart, now)
}

export function groupRows(
  tasks: readonly TimelineTask[],
  groups: readonly { id: string; name: string }[],
  looseLabel = 'Whole project',
): TimelineRow[] {
  const order = (a: TimelineTask, b: TimelineTask) => {
    const aStart = instant(a.starts_at) ?? instant(a.due_at) ?? Number.MAX_SAFE_INTEGER
    const bStart = instant(b.starts_at) ?? instant(b.due_at) ?? Number.MAX_SAFE_INTEGER
    if (aStart !== bStart) return aStart - bStart
    const aDue = instant(a.due_at) ?? Number.MAX_SAFE_INTEGER
    const bDue = instant(b.due_at) ?? Number.MAX_SAFE_INTEGER
    if (aDue !== bDue) return aDue - bDue
    return a.title.localeCompare(b.title)
  }

  const rows: TimelineRow[] = []

  // Work that belongs to everybody reads first; it is the project's own spine.
  // A group_id pointing at no group on this list — deleted since, or filtered
  // out by the caller — belongs here too rather than nowhere.
  const known = new Set(groups.map((g) => g.id))
  const loose = tasks.filter((t) => !t.group_id || !known.has(t.group_id))
  if (loose.length) rows.push({ group: null, groupName: looseLabel, tasks: [...loose].sort(order) })

  for (const group of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = tasks.filter((t) => t.group_id === group.id)
    if (mine.length) rows.push({ group: group.id, groupName: group.name, tasks: [...mine].sort(order) })
  }

  return rows
}

/** A stretch of time drawn behind the tasks: a sprint, from its first day to the end of its last. */
export type Band = { id: string; label: string; start: number; end: number }

export function sprintBands(
  sprints: readonly { id: string; name: string; starts_on: string; ends_on: string }[],
): Band[] {
  return sprints.map((s) => ({ id: s.id, label: s.name, start: dayStart(s.starts_on), end: dayStart(s.ends_on) + DAY }))
}

export function placeBand(band: Band, chart: Chart) {
  if (band.end <= chart.start || band.start >= chart.end) return null
  const left = xOf(chart, band.start)
  return { left, width: Math.max(0.4, xOf(chart, band.end) - left) }
}

/** A single dated point drawn above the tasks: a milestone, at noon on its day. */
export type Mark = { id: string; label: string; at: number }

export function milestoneMarks(milestones: readonly { id: string; name: string; due_on: string }[]): Mark[] {
  return milestones.map((m) => ({ id: m.id, label: m.name, at: dayStart(m.due_on) + DAY / 2 }))
}

export function placeMark(mark: Mark, chart: Chart) {
  if (mark.at < chart.start || mark.at >= chart.end) return null
  return xOf(chart, mark.at)
}
