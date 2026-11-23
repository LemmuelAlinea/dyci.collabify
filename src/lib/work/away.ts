import type { AwayRange } from '../api/workload'
import { formatDayLabel, formatDayRange } from './hours'

/**
 * How someone's leave reads next to their name on `today` (YYYY-MM-DD): a leave
 * under way is "Away today" for a single part day, else "Away until <last day>";
 * in a picker a coming leave reads "Away 26–28 Nov". Nothing otherwise.
 */
export function awayText(ranges: readonly AwayRange[], today: string, where: 'picker' | 'holder'): string | null {
  const now = ranges.find((r) => r.first_day <= today && r.last_day >= today)
  if (now) return now.part_day && now.last_day === today ? 'Away today' : `Away until ${formatDayLabel(now.last_day)}`
  if (where === 'holder') return null
  const next = [...ranges].filter((r) => r.first_day > today).sort((a, b) => a.first_day.localeCompare(b.first_day))[0]
  return next ? `Away ${formatDayRange(next.first_day, next.last_day)}` : null
}
