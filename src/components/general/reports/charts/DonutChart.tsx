import { useId } from 'react'

/** `className` strokes the ring, `dot` fills the legend swatch — both written out so Tailwind sees them. */
export type Slice = { label: string; value: number; className: string; dot: string }

/**
 * Task status as a ring, with its legend. Pure SVG: each slice is a stroked
 * circle with a dash of its share, so there is no path maths to get wrong.
 */
export function DonutChart({ slices, title }: { slices: Slice[]; title: string }) {
  const uid = useId()
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = 15.915 // circumference 100, so a dash length is a percentage
  let offset = 25
  const desc = slices.map((s) => `${s.label}: ${s.value}`).join(', ')
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{desc}</desc>
        <circle cx="21" cy="21" r={r} fill="none" strokeWidth="6" className="stroke-[var(--surface-sunken)]" />
        {total > 0 &&
          slices.map((s) => {
            if (s.value === 0) return null
            const len = (s.value / total) * 100
            const el = (
              <circle
                key={s.label}
                cx="21"
                cy="21"
                r={r}
                fill="none"
                strokeWidth="6"
                strokeDasharray={`${len} ${100 - len}`}
                strokeDashoffset={offset}
                className={s.className}
              />
            )
            offset -= len
            return el
          })}
        <text x="21" y="22.5" textAnchor="middle" className="fill-[var(--ink)] font-mono text-[6px]">
          {total}
        </text>
      </svg>
      <ul className="grid gap-1.5 text-[13px]">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
            <span className="text-ink">{s.label}</span>
            <span className="ml-auto pl-4 font-mono tabular-nums text-muted">
              {s.value}
              {total > 0 && <span className="text-faint"> · {Math.round((s.value / total) * 100)}%</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
