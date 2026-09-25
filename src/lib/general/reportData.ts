/**
 * Shaping report rows for the page: totals across projects, one project's
 * slice, per-day percentages and a forecast from the range's own pace. Pure,
 * so the document component only lays things out.
 */
import type { PeopleRow, SeriesRow, SummaryRow } from '../api/generalReports'
import type { Forecast } from './forecast'

export type Totals = Omit<SummaryRow, 'project_id'>

const ZERO: Totals = {
  tasks_total: 0, todo: 0, in_progress: 0, done: 0, done_in_range: 0, created_in_range: 0,
  overdue_now: 0, due_in_range: 0, points_total: 0, points_done: 0, minutes_in_range: 0,
  comments_in_range: 0, files_in_range: 0, commits_in_range: 0, reviews_opened: 0,
  reviews_applied: 0, reviews_declined: 0, members_active: 0,
}

export function sumSummary(rows: readonly SummaryRow[] | undefined): Totals {
  const out = { ...ZERO }
  for (const r of rows ?? []) {
    for (const k of Object.keys(ZERO) as (keyof Totals)[]) out[k] += Number(r[k]) || 0
  }
  return out
}

export function onlyProject<T extends { project_id: string }>(rows: readonly T[] | undefined, id: string | null) {
  return id ? (rows ?? []).filter((r) => r.project_id === id) : [...(rows ?? [])]
}

/** Per cent done per day, across whatever projects the rows cover. */
export function seriesPercent(rows: readonly SeriesRow[] | undefined, points = false) {
  const byDay = new Map<string, { done: number; total: number }>()
  for (const r of rows ?? []) {
    const cur = byDay.get(r.day) ?? { done: 0, total: 0 }
    cur.done += points ? Number(r.done_points) : r.done_count
    cur.total += points ? Number(r.total_points) : r.total_count
    byDay.set(r.day, cur)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, value: v.total ? Math.round((v.done / v.total) * 1000) / 10 : 0, done: v.done, total: v.total }))
}

/** One row per person, across projects: numbers summed, first and last activity widened. */
export function mergePeople(rows: readonly PeopleRow[] | undefined): PeopleRow[] {
  const map = new Map<string, PeopleRow>()
  for (const r of rows ?? []) {
    const cur = map.get(r.user_id)
    if (!cur) {
      map.set(r.user_id, { ...r, teams: [...r.teams] })
      continue
    }
    const numeric: (keyof PeopleRow)[] = [
      'tasks_held_now', 'tasks_finished_in_range', 'tasks_finished_late', 'points_finished',
      'minutes_logged', 'comments', 'files_uploaded', 'commits', 'files_changed',
      'reviews_requested', 'reviews_done', 'reviews_applied_as_author',
    ]
    for (const k of numeric) (cur[k] as number) = Number(cur[k]) + Number(r[k])
    cur.teams = [...new Set([...cur.teams, ...r.teams])]
    cur.level = cur.level ?? r.level
    cur.name = cur.name ?? r.name
    if (r.first_activity && (!cur.first_activity || r.first_activity < cur.first_activity)) cur.first_activity = r.first_activity
    if (r.last_activity && (!cur.last_activity || r.last_activity > cur.last_activity)) cur.last_activity = r.last_activity
  }
  return [...map.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

const DAY = 86_400_000

/**
 * Whether the open work fits before the end date, at the pace this range
 * shows. Same states and wording as `projectForecast`, measured from the
 * report's own series rather than every task's finish stamp.
 */
export function rangeForecast(
  series: { day: string; done: number; total: number }[],
  endsOn: string | null,
  now: number,
): Forecast | null {
  if (series.length === 0) return null
  const first = series[0]
  const last = series[series.length - 1]
  const empty = { rate: 0, daysLeft: null, finishesOn: null, overrunDays: 0 }
  if (last.total === 0) return { state: 'no_tasks', done: 0, total: 0, ...empty }
  if (last.done >= last.total) return { state: 'finished', done: last.done, total: last.total, ...empty }
  const gained = last.done - first.done
  if (gained <= 0) {
    return last.done === 0 ? { state: 'not_started', done: 0, total: last.total, ...empty } : null
  }
  const days = Math.max(1, series.length - 1)
  const perDay = gained / days
  const daysLeft = Math.ceil((last.total - last.done) / perDay)
  const finish = now + daysLeft * DAY
  const base = {
    done: last.done,
    total: last.total,
    rate: Math.round(perDay * 7 * 10) / 10,
    daysLeft,
    finishesOn: new Date(finish).toISOString(),
  }
  if (!endsOn) return { state: 'no_end_date', ...base, overrunDays: 0 }
  const [y, m, d] = endsOn.split('-').map(Number)
  const end = new Date(y, m - 1, d).getTime() + DAY
  return finish <= end
    ? { state: 'on_track', ...base, overrunDays: 0 }
    : { state: 'overrunning', ...base, overrunDays: Math.ceil((finish - end) / DAY) }
}

/** A slug for file names: lower case, dashes, nothing else. */
export function slug(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report'
}

/** collabify-<space>-<project|space>-<section>-<from>_<to>.csv */
export function reportCsvName(space: string, subject: string, section: string, from: string, to: string) {
  return `collabify-${slug(space)}-${slug(subject)}-${slug(section)}-${from}_${to}.csv`
}
