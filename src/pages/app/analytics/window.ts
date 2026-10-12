import { manilaDay } from '../../../lib/analyticsMath'
import type { AnalyticsData } from './useAnalytics'

/**
 * The window every time chart on the page shares: from the earliest term start
 * (or the first task, for a class with no dates) to today, with the term end as
 * the far edge of the axis.
 */
export function classWindow(data: AnalyticsData, today: string) {
  const starts = data.shownPace.map((p) => p.term_start).filter(Boolean)
  const ends = data.shownPace.map((p) => p.term_end).filter(Boolean)
  const firstTask = data.shownTasks.reduce<string | null>((min, t) => {
    const d = manilaDay(t.created_at)
    return min === null || d < min ? d : min
  }, null)
  const from = starts.length ? starts.sort()[0] : (firstTask ?? today)
  const end = ends.length ? ends.sort()[ends.length - 1] : today
  const to = today < end ? today : end
  return { from, to: to < from ? from : to, end }
}
