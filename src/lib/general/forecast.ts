/**
 * Whether the work still open fits before the project's end date.
 *
 * Counting, not clairvoyance: the rate is what has happened so far, and the
 * projection is that rate continuing. It is on the page because it is the one
 * question a group asks in week six that nothing else in the product answers.
 *
 * `not_started` is its own state rather than a rate of zero, which is the
 * judgement Education's BurnCard makes too. A project moving at zero per day
 * reads as slow; a project nobody has opened is a different problem with a
 * different fix, and it is the one worth catching early.
 */
import type { GeneralTask } from './types'

export type ForecastState =
  | 'no_tasks'
  | 'not_started'
  | 'finished'
  | 'no_end_date'
  | 'on_track'
  | 'overrunning'

export type Forecast = {
  state: ForecastState
  done: number
  total: number
  /** Tasks finished per week so far, rounded to one decimal. 0 before any are. */
  rate: number
  /** Days from now until the projected finish. Null when there is no rate. */
  daysLeft: number | null
  /** The projected finish, as an ISO string. Null when there is no rate. */
  finishesOn: string | null
  /** Days past the project's end date. 0 when it fits or cannot be judged. */
  overrunDays: number
}

export type ForecastTask = Pick<GeneralTask, 'status' | 'completed_at'>

const DAY = 86_400_000
const WEEK = 7 * DAY

/** A project's end is a calendar day, so it is parsed as local midnight. */
function endOfDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime() + DAY
}

export function projectForecast(
  tasks: readonly ForecastTask[],
  endsOn: string | null,
  now = Date.now(),
): Forecast {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const empty = { done, total, rate: 0, daysLeft: null, finishesOn: null, overrunDays: 0 }

  if (total === 0) return { state: 'no_tasks', ...empty, done: 0, total: 0 }
  if (done === total) return { state: 'finished', ...empty }

  // Only a task that says when it finished can tell us how fast work goes.
  const stamps = tasks
    .filter((t) => t.status === 'done' && t.completed_at)
    .map((t) => new Date(t.completed_at as string).getTime())
    .sort((a, b) => a - b)

  if (stamps.length === 0) return { state: 'not_started', ...empty }

  // From the first finish to now, floored at a day: a project whose first task
  // finished an hour ago is not running at twenty-four tasks a day.
  const elapsed = Math.max(DAY, now - stamps[0])
  const rate = Math.round((stamps.length / (elapsed / WEEK)) * 10) / 10
  const remaining = total - done
  const daysLeft = Math.ceil((remaining / stamps.length) * (elapsed / DAY))
  const finish = now + daysLeft * DAY
  const finishesOn = new Date(finish).toISOString()

  if (!endsOn) {
    return { state: 'no_end_date', done, total, rate, daysLeft, finishesOn, overrunDays: 0 }
  }

  const deadline = endOfDay(endsOn)
  const overrunDays = Math.max(0, Math.ceil((finish - deadline) / DAY))

  return {
    state: overrunDays > 0 ? 'overrunning' : 'on_track',
    done,
    total,
    rate,
    daysLeft,
    finishesOn,
    overrunDays,
  }
}
