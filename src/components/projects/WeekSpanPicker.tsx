import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { Alert } from '../ui/Field'
import { weekRange } from '../../lib/types'
import type { ClassWeek } from '../../lib/types'

export type WeekSpan = { start: number; end: number }

/**
 * The syllabus lines a project is built on. Everything a professor needs to
 * judge the span is on screen: the topics, the deliverables the syllabus
 * already names, and where the weeks sit in the term.
 */
export function WeekSpanPicker({
  weeks,
  value,
  onChange,
}: {
  weeks: ClassWeek[]
  value: WeekSpan
  onChange: (next: WeekSpan) => void
}) {
  const span = weeks.filter((w) => w.week_no >= value.start && w.week_no <= value.end)
  const remaining = weeks.filter((w) => w.phase === 'upcoming' || w.phase === 'current')
  const noBasis = span.every((w) => !w.assessments && !w.topics)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-[13.5px] font-medium text-ink">From week</span>
          <Select
            value={String(value.start)}
            onChange={(e) => {
              const start = Number(e.target.value)
              onChange({ start, end: Math.max(start, value.end) })
            }}
            options={weeks.map((w) => ({
              value: String(w.week_no),
              label: `Week ${w.week_no}${w.title ? ` · ${w.title}` : ''}`,
            }))}
          />
        </label>

        <label className="space-y-1.5">
          <span className="block text-[13.5px] font-medium text-ink">To week</span>
          <Select
            value={String(value.end)}
            onChange={(e) => onChange({ ...value, end: Number(e.target.value) })}
            options={weeks
              .filter((w) => w.week_no >= value.start)
              .map((w) => ({
                value: String(w.week_no),
                label: `Week ${w.week_no}${w.title ? ` · ${w.title}` : ''}`,
              }))}
          />
        </label>
      </div>

      {remaining.length > 0 && (
        <p className="text-[12.5px] text-faint">
          {remaining.length} week{remaining.length === 1 ? '' : 's'} left in the term.
        </p>
      )}

      <ul className="space-y-2">
        {span.map((w) => (
          <li
            key={w.week_id}
            className={`rounded-xl border px-4 py-3 ${
              w.phase === 'past'
                ? 'border-line surface-sunken opacity-80'
                : w.phase === 'current'
                  ? 'border-amber-400 bg-amber-400/8'
                  : 'border-line surface'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[14px] font-semibold text-ink">
                Week {w.week_no}
                {w.title ? ` · ${w.title}` : ''}
              </p>
              <p className="font-mono text-[11.5px] text-faint">
                {weekRange(w)}
                {w.phase === 'past' && ' · already passed'}
              </p>
            </div>
            {w.topics && (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{w.topics}</p>
            )}
            {w.assessments && (
              <p className="mt-1.5 flex gap-1.5 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                {w.assessments}
              </p>
            )}
          </li>
        ))}
      </ul>

      {noBasis && (
        <Alert tone="info">
          These weeks carry no topics or deliverables in the syllabus. Fill them in on the
          syllabus first — a project needs something to be based on.
        </Alert>
      )}

      {span.some((w) => w.phase === 'past') && (
        <Alert tone="info">
          Part of this span has already passed. That is allowed — students still see the
          project — but check the deadline makes sense.
        </Alert>
      )}
    </div>
  )
}

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
