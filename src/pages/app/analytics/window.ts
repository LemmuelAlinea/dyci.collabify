import { manilaDay } from '../../../lib/analyticsMath'
import type { AnalyticsData } from './useAnalytics'

/**
 * The term dates of every class in view, by class. `class_pace` also needs a
 * syllabus, so a dated class without one is read from `class_unmeasured`.
 */
export function termsOf(
  data: Pick<AnalyticsData, 'shownPace' | 'shownUnmeasured'>,
): Map<string, { start: string; end: string }> {
  const out = new Map<string, { start: string; end: string }>()
  for (const p of data.shownPace) out.set(p.class_id, { start: p.term_start, end: p.term_end })
  for (const u of data.shownUnmeasured) {
    if (u.term_start && u.term_end) out.set(u.class_id, { start: u.term_start, end: u.term_end })
  }
  return out
}

/**
 * The window every time chart on the page shares: from the earliest term start
 * (or the first task, for a class with no dates) to today, with the term end as
 * the far edge of the axis.
 */
export function classWindow(data: AnalyticsData, today: string) {
  const terms = [...termsOf(data).values()]
  const starts = terms.map((t) => t.start)
  const ends = terms.map((t) => t.end)
  const firstTask = data.shownTasks.reduce<string | null>((min, t) => {
    const d = manilaDay(t.created_at)
    return min === null || d < min ? d : min
  }, null)
  const from = starts.length ? starts.sort()[0] : (firstTask ?? today)
  const end = ends.length ? ends.sort()[ends.length - 1] : today
  const to = today < end ? today : end
  return { from, to: to < from ? from : to, end }
}
