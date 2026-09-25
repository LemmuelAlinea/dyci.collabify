/**
 * A report's summary in words.
 *
 * Rules, not generation: every sentence is a fixed shape filled with this
 * report's numbers, so the same data always reads the same way and nothing is
 * claimed that the tables below do not show. A member's report speaks to them
 * ("You logged …"), because it only ever holds their own work.
 */
import type { Forecast } from './forecast'
import { plural } from '../plural'

export type NarrativeTotals = {
  tasks_total: number
  done: number
  done_in_range: number
  overdue_now: number
  minutes_in_range: number
  reviews_opened: number
  reviews_applied: number
  reviews_declined: number
}

export type NarrativeInput = {
  totals: NarrativeTotals
  previous?: NarrativeTotals | null
  /** Leads only: who finished the most. */
  top?: { name: string; finished: number } | null
  /** A member's report: phrase it as "you". */
  self: boolean
  forecast?: Forecast | null
  /** Review requests still waiting on somebody. */
  reviewsWaiting?: number
}

const hours = (minutes: number) => {
  const h = Math.round((minutes / 60) * 10) / 10
  return `${h} ${h === 1 ? 'hour' : 'hours'}`
}

function delta(now: number, before: number | undefined) {
  if (before === undefined) return ''
  const d = now - before
  if (d === 0) return ', the same as the previous period'
  return `, ${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} than the previous period`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDay(iso: string) {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function reportNarrative(input: NarrativeInput): string[] {
  const { totals: t, previous: p, self } = input
  const out: string[] = []

  if (t.tasks_total === 0) {
    out.push('There are no tasks in this report yet.')
  } else {
    const share = Math.round((t.done / t.tasks_total) * 100)
    out.push(`${t.done} of ${t.tasks_total} ${plural(t.tasks_total, 'task is', 'tasks are')} done (${share}%).`)
    const finished = self
      ? `You finished ${t.done_in_range} ${plural(t.done_in_range, 'task', 'tasks')} in this range`
      : `${t.done_in_range} ${plural(t.done_in_range, 'task was', 'tasks were')} finished in this range`
    out.push(`${finished}${delta(t.done_in_range, p?.done_in_range)}.`)
  }

  out.push(
    t.overdue_now === 0
      ? 'Nothing is overdue.'
      : `${t.overdue_now} ${plural(t.overdue_now, 'task is', 'tasks are')} overdue.`,
  )

  if (!self && input.top && input.top.finished > 0) {
    out.push(
      `${input.top.name} finished the most, with ${input.top.finished} ${plural(input.top.finished, 'task', 'tasks')}.`,
    )
  }

  if (t.minutes_in_range > 0) {
    out.push(
      self
        ? `You logged ${hours(t.minutes_in_range)}.`
        : `${hours(t.minutes_in_range)} ${t.minutes_in_range === 60 ? 'was' : 'were'} logged.`,
    )
  }

  if (input.reviewsWaiting && input.reviewsWaiting > 0) {
    out.push(
      `${input.reviewsWaiting} review ${plural(input.reviewsWaiting, 'request is', 'requests are')} still waiting for an answer.`,
    )
  }

  const f = input.forecast
  if (f) {
    switch (f.state) {
      case 'finished':
        out.push('Every task is done.')
        break
      case 'not_started':
        out.push('No task has been finished yet, so there is no pace to forecast from.')
        break
      case 'on_track':
        if (f.finishesOn) out.push(`At this pace the work finishes by ${shortDay(f.finishesOn)}, before the end date.`)
        break
      case 'overrunning':
        out.push(
          `At this pace the work runs ${f.overrunDays} ${plural(f.overrunDays, 'day', 'days')} past the end date.`,
        )
        break
      case 'no_end_date':
        if (f.finishesOn) out.push(`At this pace the work finishes by ${shortDay(f.finishesOn)}. There is no end date to compare with.`)
        break
      default:
        break
    }
  }

  return out
}
