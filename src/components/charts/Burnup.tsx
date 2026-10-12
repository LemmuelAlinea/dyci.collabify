import { useId } from 'react'
import { daysBetween } from '../../lib/analyticsMath'
import type { BurnupPoint } from '../../lib/analyticsMath'
import { shortDay } from './format'

/**
 * Work that exists against work finished, day by day, with the even pace that
 * would finish today's scope by `endDay`. When scope grows, the grey line
 * rises and the gap says so: a percentage alone hides new work.
 */
export function Burnup({
  points,
  endDay,
  title,
  compact = false,
}: {
  points: BurnupPoint[]
  endDay?: string | null
  title: string
  compact?: boolean
}) {
  const uid = useId()
  if (points.length === 0) return null
  const W = compact ? 260 : 640
  const H = compact ? 120 : 220
  const PAD = compact
    ? { top: 8, right: 8, bottom: 18, left: 26 }
    : { top: 12, right: 14, bottom: 26, left: 36 }
  const first = points[0].day
  const lastPoint = points[points.length - 1]
  const last = endDay && endDay > lastPoint.day ? endDay : lastPoint.day
  const span = Math.max(1, daysBetween(first, last))
  const top = Math.max(1, ...points.map((p) => p.scope))
  const x = (day: string) => PAD.left + (daysBetween(first, day) / span) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom)
  const path = (key: 'scope' | 'done') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const area = `${path('done')} L${x(lastPoint.day).toFixed(1)},${y(0)} L${x(first).toFixed(1)},${y(0)} Z`
  const ticks = compact ? [0, top] : [0, Math.round(top / 2), top]
  const desc = `${lastPoint.done} of ${lastPoint.scope} tasks done on ${shortDay(lastPoint.day)}.`

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{desc}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-[var(--line)]" strokeWidth="1" />
            <text x={PAD.left - 5} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {!compact && (
          <>
            <text x={x(first)} y={H - 8} textAnchor="start" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {shortDay(first)}
            </text>
            <text x={x(last)} y={H - 8} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {shortDay(last)}
            </text>
          </>
        )}
        <line
          x1={x(first)}
          y1={y(0)}
          x2={x(last)}
          y2={y(lastPoint.scope)}
          strokeWidth="1.25"
          strokeDasharray="4 4"
          className="stroke-amber-400"
        />
        <path d={area} className="fill-navy-600/10 dark:fill-navy-300/10" />
        <path d={path('scope')} fill="none" strokeWidth="1.5" className="stroke-[var(--ink-faint)]" />
        <path d={path('done')} fill="none" strokeWidth="2.25" strokeLinejoin="round" className="stroke-navy-600 dark:stroke-navy-300" />
      </svg>
      {!compact && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-navy-600 dark:bg-navy-300" />Done</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--ink-faint)]" />All tasks</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-amber-400" />Even pace</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th>Day</th><th>All tasks</th><th>Done</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}><td>{p.day}</td><td>{p.scope}</td><td>{p.done}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
