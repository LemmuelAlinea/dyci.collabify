import { formatPoints } from '../../lib/scoreMath'

/** Labelled horizontal bars: one category per line, scaled to `max`. */
export function Bars({
  rows,
  max,
  unit = '',
  title,
}: {
  rows: { label: string; value: number }[]
  max: number
  unit?: string
  title: string
}) {
  const summary = rows.map((r) => `${r.label} ${formatPoints(r.value)}${unit}`).join(', ')
  return (
    <div role="img" aria-label={`${title}: ${summary}`} className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[12px]"
        >
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full surface-sunken">
            <span
              className="block h-full rounded-full bg-progress"
              style={{ width: `${max > 0 ? Math.min(100, (r.value / max) * 100) : 0}%` }}
            />
          </span>
          <span className="text-right font-mono tabular-nums text-ink">
            {formatPoints(r.value)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  )
}
