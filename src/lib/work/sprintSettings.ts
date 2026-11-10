/**
 * A work project's sprint settings: whether sprints start and finish on their
 * own, what happens to unfinished tasks, how long a sprint runs and when.
 * A project with no saved row uses the defaults. The table and the job that
 * reads it are in supabase/sprint-settings.sql.
 */
import type { Sprint } from './types'

export type SprintCarry = 'ask' | 'next' | 'backlog'

/** One at a time, one at a time per team, or any number at once. */
export type SprintOrganization = 'sequential' | 'streams' | 'parallel'

export type SprintSettings = {
  organization: SprintOrganization
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
  organization: 'sequential',
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

/** 'HH:MM' as a 12-hour time, such as 9:00 AM. */
export function clockTime(runAt: string) {
  const [h, m] = runAt.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The date ('YYYY-MM-DD') and time ('HH:MM') in Manila at a moment, whatever the viewer's zone. */
function manilaNow(now: number): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/** The date before a 'YYYY-MM-DD' day. */
function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/**
 * What to tell someone reopening a finished sprint: whether automatic finishing
 * would close it again, and when. Mirrors the job's finish rule in
 * supabase/sprint-settings.sql: a running sprint finishes once its end date is
 * two or more days back, or yesterday and the set time has come, in Manila time.
 */
export function reopenFinishNotice(endsOn: string, settings: SprintSettings, now: number): string | null {
  if (!settings.autoFinish) return null
  const { day, time } = manilaNow(now)
  if (endsOn >= day) return null
  const lead = "Automatic finishing is on and this sprint's end date has passed, so it will finish again"
  if (endsOn < dayBefore(day) || time >= settings.runAt.slice(0, 5)) {
    return `${lead} within 15 minutes unless you move its end date.`
  }
  return `${lead} at ${clockTime(settings.runAt)}.`
}
