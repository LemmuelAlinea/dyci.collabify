import { useId } from 'react'
import type { WeekRow } from '../../lib/analyticsMath'
import { shortDay } from './format'

/** Work (claims, starts, finishes) and talk (comments, files) per week, stacked. */
export function WeekBars({ rows, title }: { rows: WeekRow[]; title: string }) {
  const uid = useId()
  if (rows.length === 0) return null
  const W = 640
  const H = 200
  const PAD = { top: 10, right: 8, bottom: 26, left: 32 }
  const peak = Math.max(1, ...rows.map((r) => r.work + r.talk))
  const slot = (W - PAD.left - PAD.right) / rows.length
  const bw = Math.max(4, Math.min(28, slot * 0.6))
  const h = (v: number) => (v / peak) * (H - PAD.top - PAD.bottom)
  const base = H - PAD.bottom
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8))
  const total = rows.reduce((s, r) => s + r.work + r.talk, 0)

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{`${total} actions over ${rows.length} weeks.`}</desc>
        {[0, peak].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={base - h(t)} y2={base - h(t)} className="stroke-[var(--line)]" strokeWidth="1" />
            <text x={PAD.left - 5} y={base - h(t) + 3.5} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={r.week}>
              <rect x={cx - bw / 2} y={base - h(r.work)} width={bw} height={h(r.work)} rx="2" className="fill-navy-600 dark:fill-navy-300 print:fill-navy-600" />
              <rect x={cx - bw / 2} y={base - h(r.work) - h(r.talk)} width={bw} height={h(r.talk)} rx="2" className="fill-amber-400" />
              {(i % labelEvery === 0 || i === rows.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--ink-faint)] font-mono text-[10px]">
                  {shortDay(r.week)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-navy-600 dark:bg-navy-300 print:bg-navy-600" />Work</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Comments and files</span>
      </figcaption>
      {/* sr-only on a table is ignored: tables size to their rows. */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead><tr><th>Week of</th><th>Work</th><th>Comments and files</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}><td>{r.week}</td><td>{r.work}</td><td>{r.talk}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}
