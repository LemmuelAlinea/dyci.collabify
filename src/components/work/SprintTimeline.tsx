import { useNow } from '../../hooks/useNow'
import { reachedIn } from '../../lib/work/milestones'
import { nextCheckpoint, sprintTimeline, toDay } from '../../lib/work/sprints'
import type { TimelineState } from '../../lib/work/sprints'
import type { Milestone, Sprint, WorkItem } from '../../lib/work/types'
import { Icon } from '../ui/Icon'

function shortDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const STATE_LABEL: Record<TimelineState, string> = {
  done: 'passed',
  today: 'today',
  late: 'late',
  upcoming: 'ahead',
}

function Node({ state }: { state: TimelineState }) {
  const base = 'relative z-10 grid h-7 w-7 place-items-center rounded-full'
  if (state === 'done') {
    return (
      <span className={`${base} bg-success-500 text-success-50`}>
        <Icon name="check" size={14} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'today') {
    return (
      <span className={`${base} bg-warning-500`}>
        <span className="surface h-2.5 w-2.5 rounded-full" />
      </span>
    )
  }
  return (
    <span
      className={`${base} surface-sunken border-2 ${state === 'late' ? 'border-danger-500' : 'border-[var(--line-strong)]'}`}
    />
  )
}

/**
 * A running sprint as a row of checkpoints: kickoff, the milestones due inside
 * it, and its last day, with Today among them. The track fills up to today.
 */
export function SprintTimeline({
  sprint,
  milestones,
  items,
}: {
  sprint: Sprint
  milestones: readonly Milestone[]
  items: readonly WorkItem[]
}) {
  const now = useNow()
  const points = sprintTimeline(sprint, milestones, reachedIn(items), now)
  const next = nextCheckpoint(points)
  const n = points.length
  const today = toDay(now)
  const reachedTo = points.reduce((at, p, i) => (p.day <= today ? i : at), 0)
  const fill = reachedTo / (n - 1)
  const inset = `${50 / n}%`

  return (
    <figure className="space-y-4">
      <ol
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        aria-label={`Sprint timeline: ${points.map((p) => `${p.label}, ${shortDay(p.day)}, ${STATE_LABEL[p.state]}`).join('; ')}`}
      >
        <span aria-hidden className="absolute top-[12px] h-1 rounded-full bg-[var(--line-strong)]" style={{ left: inset, right: inset }}>
          <span className="block h-full rounded-full bg-progress" style={{ width: `${fill * 100}%` }} />
        </span>
        {points.map((p, i) => (
          <li key={`${p.day}-${i}`} className="flex min-w-0 flex-col items-center gap-2 px-1 text-center">
            <Node state={p.state} />
            <span className="mt-1 font-mono text-[12px] font-semibold text-ink">{shortDay(p.day)}</span>
            <span
              className={`w-full truncate text-[12px] ${p.state === 'late' ? 'text-danger-600 dark:text-danger-400' : 'text-muted'}`}
              title={p.label}
            >
              {p.label}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="flex items-end justify-between gap-3 border-t border-line pt-3">
        {next ? (
          <>
            <span className="min-w-0">
              <span className="block text-[12px] text-faint">Next checkpoint</span>
              <span className="block truncate text-[14px] font-semibold text-ink">{next.label}</span>
            </span>
            <span className="shrink-0 font-mono text-[12px] text-muted">{shortDay(next.day)}</span>
          </>
        ) : (
          <span className="text-[12px] text-faint">Every checkpoint has passed. Finish the sprint to move on.</span>
        )}
      </figcaption>
    </figure>
  )
}
