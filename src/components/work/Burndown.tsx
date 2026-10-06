import { useNow } from '../../hooks/useNow'
import { burndown, sprintCounts, sprintLength } from '../../lib/work/sprints'
import type { Sprint, WorkItem } from '../../lib/work/types'

const W = 320
const H = 120
const PAD = 10

/**
 * Tasks left at the end of each day, against a straight line from all of
 * them to none. Hand-drawn SVG, like the rest of the app's charts.
 */
export function Burndown({ sprint, items }: { sprint: Sprint; items: WorkItem[] }) {
  const now = useNow()
  const total = sprintCounts(items, sprint.id).total
  const points = burndown(sprint, items, now)
  const days = sprintLength(sprint)

  if (total === 0) {
    return <p className="text-[12px] text-faint">Move tasks into this sprint to see it burn down.</p>
  }
  if (points.length === 0) {
    return <p className="text-[12px] text-faint">The chart starts on the sprint's first day.</p>
  }

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, days - 1)
  const y = (left: number) => PAD + (1 - left / total) * (H - 2 * PAD)
  const line = points.map((p, i) => `${x(i)},${y(p.left)}`).join(' ')

  return (
    <figure className="space-y-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[420px]"
        role="img"
        aria-label={`Tasks left at the end of each day: ${points.map((p) => p.left).join(', ')}, out of ${total}.`}
      >
        <line x1={x(0)} y1={y(total)} x2={x(days - 1)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="4 4" />
        <polyline points={line} fill="none" strokeWidth={2.5} className="stroke-navy-500 dark:stroke-navy-300" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.left)} r={2.5} className="fill-navy-500 dark:fill-navy-300" />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-[11px] text-faint">
        <span>Solid: tasks left</span>
        <span>Dashed: an even pace to zero</span>
      </figcaption>
    </figure>
  )
}
