import { useId } from 'react'

export type LinePoint = { day: string; value: number }

const W = 640
const H = 200
const PAD = { top: 12, right: 12, bottom: 26, left: 36 }

function shortDay(day: string) {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`
}

/**
 * Per cent done per day, 0–100 on one scale. The previous period, when there
 * is one, is a dashed line over the same days. Markers for today and the
 * project's end sit on the axis they belong to. A visually hidden table carries
 * the same numbers for a screen reader.
 */
export function LineChart({
  points,
  previous,
  todayDay,
  endDay,
  title,
}: {
  points: LinePoint[]
  previous?: LinePoint[]
  todayDay?: string
  endDay?: string | null
  title: string
}) {
  const uid = useId()
  const n = points.length
  if (n === 0) return null
  const x = (i: number) => PAD.left + (n === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (n - 1)) * (W - PAD.left - PAD.right))
  const y = (v: number) => PAD.top + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PAD.top - PAD.bottom)
  const line = (pts: LinePoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line(points)} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const ticks = [0, 25, 50, 75, 100]
  const labelEvery = Math.max(1, Math.ceil(n / 6))
  const marker = (day: string | null | undefined) => {
    if (!day) return null
    const i = points.findIndex((p) => p.day === day)
    return i >= 0 ? x(i) : null
  }
  const todayX = marker(todayDay)
  const endX = marker(endDay)
  const last = points[n - 1]
  const desc = `From ${points[0].value}% on ${shortDay(points[0].day)} to ${last.value}% on ${shortDay(last.day)}.`

  return (
    <figure className="report-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>{title}</title>
        <desc id={`${uid}d`}>{desc}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-[var(--line)]" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {t}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={p.day} x={x(i)} y={H - 8} textAnchor="middle" className="fill-[var(--ink-faint)] font-mono text-[10px]">
              {shortDay(p.day)}
            </text>
          ) : null,
        )}
        <path d={area} className="fill-navy-600/10 dark:fill-navy-300/10" />
        {previous && previous.length > 0 && (
          <path d={line(previous.slice(0, n))} fill="none" strokeWidth="1.5" strokeDasharray="4 4" className="stroke-[var(--ink-faint)]" />
        )}
        <path
          d={line(points)}
          fill="none"
          strokeWidth="2.25"
          strokeLinejoin="round"
          className="stroke-navy-600 dark:stroke-navy-300"
        />
        <circle cx={x(n - 1)} cy={y(last.value)} r="3.5" className="fill-navy-600 dark:fill-navy-300" />
        {todayX !== null && (
          <g>
            <line x1={todayX} x2={todayX} y1={PAD.top} y2={H - PAD.bottom} strokeWidth="1" className="stroke-amber-400" />
            <text x={todayX > W - 60 ? todayX - 4 : todayX + 4} y={PAD.top + 9} textAnchor={todayX > W - 60 ? 'end' : 'start'} className="fill-amber-600 dark:fill-amber-300 font-mono text-[10px]">Today</text>
          </g>
        )}
        {endX !== null && (
          <g>
            <line x1={endX} x2={endX} y1={PAD.top} y2={H - PAD.bottom} strokeWidth="1" strokeDasharray="2 3" className="stroke-red-500" />
            <text x={endX - 4} y={PAD.top + 9} textAnchor="end" className="fill-red-600 dark:fill-red-400 font-mono text-[10px]">Ends</text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Done</th>
            {previous && <th>Previous period</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{p.value}%</td>
              {previous && <td>{previous[i] ? `${previous[i].value}%` : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
