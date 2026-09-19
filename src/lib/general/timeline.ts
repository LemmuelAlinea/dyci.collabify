/**
 * Where a task sits on a project's timeline.
 *
 * Everything here answers in percentages of the window, because the chart is
 * drawn with CSS widths and offsets rather than a canvas — the same way
 * `src/components/analytics/PressureChart.tsx` draws its bars. Nothing in this
 * file knows about React or about how a date should read to a person.
 */
import type { GeneralTask } from './types'

export type TimelineTask = Pick<
  GeneralTask,
  'id' | 'title' | 'status' | 'due_at' | 'starts_at' | 'team_id'
>

/**
 * The span the chart covers, and where it came from.
 *
 * `source` is on the record so the panel can say "from this project's dates"
 * or "from its tasks" — a reader who does not know which is being shown cannot
 * tell whether a gap at the end is slack or a missing end date.
 */
export type TimelineWindow = { start: number; end: number; source: 'project' | 'tasks' | 'none' }

export type Placement =
  | { shape: 'bar'; left: number; width: number }
  | { shape: 'diamond'; left: number }
  | { shape: 'none' }

export type Tick = { at: number; left: number; label: string }

export type TimelineRow = { team: string | null; teamName: string; tasks: TimelineTask[] }

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

export function timelineWindow(
  project: { starts_on: string | null; ends_on: string | null },
  tasks: readonly TimelineTask[],
): TimelineWindow {
  if (project.starts_on && project.ends_on) {
    const start = dayStart(project.starts_on)
    // The end day is a whole day, not the instant it begins.
    const end = dayStart(project.ends_on) + DAY
    if (end > start) return { start, end, source: 'project' }
  }

  const all = tasks.flatMap(taskDates)
  if (all.length === 0) return { start: 0, end: 0, source: 'none' }

  const start = Math.min(...all)
  const end = Math.max(...all)
  // A project whose every date is the same day still needs a width to draw in.
  return { start, end: end > start ? end : start + DAY, source: 'tasks' }
}

const clamp = (n: number) => Math.min(100, Math.max(0, n))

function offset(at: number, window: TimelineWindow) {
  return clamp(((at - window.start) / (window.end - window.start)) * 100)
}

export function placeTask(task: TimelineTask, window: TimelineWindow): Placement {
  if (window.source === 'none') return { shape: 'none' }

  const from = instant(task.starts_at)
  const to = instant(task.due_at)

  if (from !== null && to !== null) {
    const left = offset(Math.min(from, to), window)
    const right = offset(Math.max(from, to), window)
    // A task that starts and ends the same day would otherwise be invisible.
    return { shape: 'bar', left, width: Math.max(1, Math.min(100 - left, right - left)) }
  }

  const only = from ?? to
  if (only === null) return { shape: 'none' }
  return { shape: 'diamond', left: offset(only, window) }
}

export function axisTicks(window: TimelineWindow): Tick[] {
  if (window.source === 'none') return []

  const span = window.end - window.start
  const byMonth = span > 70 * DAY
  const out: Tick[] = []

  const cursor = new Date(window.start)
  cursor.setHours(0, 0, 0, 0)
  if (byMonth) cursor.setDate(1)

  // Guarded rather than while(true): a bad window must not hang the page.
  for (let i = 0; i < 400; i++) {
    const at = cursor.getTime()
    if (at > window.end) break
    if (at >= window.start) {
      out.push({
        at,
        left: offset(at, window),
        label: cursor.toLocaleDateString('en-US',
          byMonth ? { month: 'short' } : { month: 'short', day: 'numeric' }),
      })
    }
    if (byMonth) cursor.setMonth(cursor.getMonth() + 1)
    else cursor.setDate(cursor.getDate() + 7)
  }

  return out
}

export function groupRows(
  tasks: readonly TimelineTask[],
  teams: readonly { id: string; name: string }[],
): TimelineRow[] {
  const order = (a: TimelineTask, b: TimelineTask) => {
    const av = instant(a.starts_at) ?? instant(a.due_at) ?? Number.MAX_SAFE_INTEGER
    const bv = instant(b.starts_at) ?? instant(b.due_at) ?? Number.MAX_SAFE_INTEGER
    if (av !== bv) return av - bv
    return a.title.localeCompare(b.title)
  }

  const rows: TimelineRow[] = []

  // Work that belongs to everybody reads first; it is the project's own spine.
  const loose = tasks.filter((t) => !t.team_id)
  if (loose.length) rows.push({ team: null, teamName: 'Whole project', tasks: [...loose].sort(order) })

  for (const team of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = tasks.filter((t) => t.team_id === team.id)
    if (mine.length) rows.push({ team: team.id, teamName: team.name, tasks: [...mine].sort(order) })
  }

  return rows
}

/** Where today sits, or null when today is outside the window. */
export function nowMarker(window: TimelineWindow, now = Date.now()): number | null {
  if (window.source === 'none') return null
  if (now < window.start || now > window.end) return null
  return offset(now, window)
}
