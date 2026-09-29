import type { ClassWeek } from '../../lib/types'
import type { WeekSpan } from './WeekSpanPicker'

/**
 * Title suggestions taken straight from what the chosen weeks say is due.
 * No invention: if the syllabus does not name a deliverable, nothing is offered.
 */
export function spanSuggestions(weeks: ClassWeek[], span: WeekSpan) {
  const out: string[] = []
  for (const w of weeks) {
    if (w.week_no < span.start || w.week_no > span.end) continue
    for (const part of w.assessments.split(/[;·|]/)) {
      const clean = part.trim()
      if (clean && !out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
    }
  }
  return out.slice(0, 6)
}

/** Calendar end of the last week in the span, when the class has term dates. */
export function spanEndDate(weeks: ClassWeek[], span: WeekSpan) {
  const last = weeks.filter((w) => w.week_no <= span.end).at(-1)
  return last?.week_end ?? null
}
