const SEGMENTS = [
  'bg-navy-800 dark:bg-navy-200',
  'bg-navy-600 dark:bg-navy-300',
  'bg-navy-400 dark:bg-navy-500',
  'bg-navy-300 dark:bg-navy-600',
  'bg-navy-200 dark:bg-navy-700',
]

export type Share = { id: string; name: string; pct: number; low: boolean }

/**
 * One group's 100 per cent, split by who holds it. A member under the low-share
 * line is outlined and named in danger, so the bar is never the only signal.
 */
export function ShareBar({ shares, label }: { shares: Share[]; label: string }) {
  const sorted = [...shares].sort((a, b) => b.pct - a.pct)
  const summary = sorted.map((s) => `${s.name} ${Math.round(s.pct)}%`).join(', ')
  return (
    <div className="space-y-2">
      <div role="img" aria-label={`${label}: ${summary || 'no work held yet'}`} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full surface-sunken">
        {sorted.map((s, i) =>
          s.pct > 0 ? (
            <span
              key={s.id}
              className={`h-full ${SEGMENTS[i % SEGMENTS.length]} ${s.low ? 'ring-2 ring-inset ring-danger-500' : ''}`}
              style={{ width: `${s.pct}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${SEGMENTS[i % SEGMENTS.length]}`} />
            <span className={s.low ? 'text-danger-700 dark:text-danger-300' : 'text-muted'}>
              {s.name} <span className="font-mono">{Math.round(s.pct)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
