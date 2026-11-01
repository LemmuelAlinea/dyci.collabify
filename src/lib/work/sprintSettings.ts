/**
 * A work project's sprint settings: whether sprints start and finish on their
 * own, what happens to unfinished tasks, how long a sprint runs and when.
 * A project with no saved row uses the defaults. The table and the job that
 * reads it are in supabase/sprint-settings.sql.
 */
import type { Sprint } from './types'

export type SprintCarry = 'ask' | 'next' | 'backlog'

export type SprintSettings = {
  autoFinish: boolean
  autoStart: boolean
  carry: SprintCarry
  lengthDays: number
  /** 0 is Sunday. Null follows the first sprint's start day. */
  startWeekday: number | null
  /** Manila time, quarter hours only: 'HH:MM'. */
  runAt: string
}

export const DEFAULT_SPRINT_SETTINGS: SprintSettings = {
  autoFinish: false,
  autoStart: false,
  carry: 'ask',
  lengthDays: 14,
  startWeekday: null,
  runAt: '09:00',
}

/** The weekday sprints start on: the saved one, else the first sprint's, else Monday. */
export function startWeekdayOf(settings: SprintSettings, sprints: readonly Sprint[]): number {
  if (settings.startWeekday !== null) return settings.startWeekday
  const first = sprints.reduce<string | null>((min, s) => (min && min < s.starts_on ? min : s.starts_on), null)
  if (!first) return 1
  const [y, m, d] = first.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}
