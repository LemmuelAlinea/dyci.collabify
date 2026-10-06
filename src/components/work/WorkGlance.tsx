import { Burndown } from './Burndown'
import { ProgressBar, StatusPill } from './MilestoneBits'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useNow } from '../../hooks/useNow'
import { dateRange, formatDay, formatDue } from '../../lib/general/dates'
import { dueInLabel } from '../../lib/work/milestones'
import type { WorkSection } from '../../lib/work/nav'
import { daysLeft, daysLeftLabel, runningSprint, sprintCounts } from '../../lib/work/sprints'
import { needsYou, nextMilestone } from '../../lib/work/summary'
import type { Milestone, Sprint, WorkItem } from '../../lib/work/types'

/** Rows shown per Needs you group before "and N more". */
const LIST_CAP = 5

type GlanceProps = {
  items: WorkItem[]
  sprints: Sprint[]
  milestones: Milestone[]
  /** Ids of the tasks the viewer holds. */
  mine: ReadonlySet<string>
  onOpenTask: (id: string) => void
  onSection: (s: WorkSection) => void
}

/**
 * The top of Summary: the running sprint, the next milestone, and what needs
 * the viewer now. The same cards in either space; each one links to the
 * section where that work is done.
 */
export function WorkGlance({ items, sprints, milestones, mine, onOpenTask, onSection }: GlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SprintCard items={items} sprints={sprints} onSection={onSection} />
      <MilestoneCard items={items} milestones={milestones} onSection={onSection} />
      <div className="lg:col-span-2">
        <NeedsYouCard items={items} mine={mine} onOpenTask={onOpenTask} />
      </div>
    </div>
  )
}

function CardHead({ icon, label, action, onAction }: { icon: IconName; label: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <button
        type="button"
        onClick={onAction}
        className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
      >
        {action}
      </button>
    </div>
  )
}

function Counted({ done, total, noun, pct }: { done: number; total: number; noun: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">
          <strong className="text-ink">
            {done} of {total}
          </strong>{' '}
          {noun} done
        </span>
        <span className="font-mono text-faint">{pct}%</span>
      </div>
      <ProgressBar pct={pct} />
    </div>
  )
}

function SprintCard({ items, sprints, onSection }: Pick<GlanceProps, 'items' | 'sprints' | 'onSection'>) {
  const now = useNow()
  const sprint = runningSprint(sprints)

  if (!sprint) {
    const planned = sprints.some((s) => s.state === 'planned')
    return (
      <section className="card p-4 shadow-card sm:p-5">
        <CardHead icon="target" label="Running sprint" action="Open Backlog" onAction={() => onSection('backlog')} />
        <p className="mt-3 text-[13px] text-muted">
          No sprint is running.{' '}
          {planned ? 'Start a planned one from Backlog.' : 'Plan one from Backlog when the team is ready.'}
        </p>
      </section>
    )
  }

  const { done, total } = sprintCounts(items, sprint.id)
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="target" label="Running sprint" action="Open Sprints" onAction={() => onSection('sprints')} />
      <h3 className="mt-2 truncate">{sprint.name}</h3>
      {sprint.goal && <p className="mt-0.5 text-[13px] text-muted">{sprint.goal}</p>}
      <p className="mt-1 text-[12px] text-faint">
        {dateRange(sprint.starts_on, sprint.ends_on)} · {daysLeftLabel(daysLeft(sprint, now))}
      </p>
      <div className="mt-3">
        <Counted done={done} total={total} noun="tasks" pct={pct} />
      </div>
      <div className="mt-4">
        <Burndown sprint={sprint} items={items} />
      </div>
    </section>
  )
}

function MilestoneCard({ items, milestones, onSection }: Pick<GlanceProps, 'items' | 'milestones' | 'onSection'>) {
  const now = useNow()
  const next = nextMilestone(milestones, items, now)
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="pin" label="Next milestone" action="Open Milestones" onAction={() => onSection('milestones')} />
      {!next ? (
        <p className="mt-3 text-[13px] text-muted">
          {milestones.length === 0 ? 'No milestones yet.' : 'Every milestone is reached.'}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate">{next.milestone.name}</h3>
            <StatusPill status={next.status} />
          </div>
          <p className="mt-1 text-[12px] text-faint">
            {formatDay(next.milestone.due_on)} · {dueInLabel(next.milestone.due_on, now)}
          </p>
          <div className="mt-3">
            <Counted done={next.done} total={next.total} noun="tagged tasks" pct={next.pct} />
          </div>
          {next.total === 0 && <p className="mt-2 text-[12px] text-faint">No task counts toward it yet.</p>}
        </>
      )}
    </section>
  )
}

function NeedsYouCard({ items, mine, onOpenTask }: Pick<GlanceProps, 'items' | 'mine' | 'onOpenTask'>) {
  const now = useNow()
  const n = needsYou(items, mine, now)
  const groups = [
    { key: 'overdue', label: 'Overdue', tone: 'text-danger-700 dark:text-danger-300', rows: n.overdue },
    { key: 'soon', label: 'Due this week', tone: 'text-warning-800 dark:text-warning-300', rows: n.dueSoon },
    { key: 'unheld', label: 'Nobody on it', tone: 'text-pending-ink', rows: n.unheld },
  ].filter((g) => g.rows.length > 0)

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name="alert" size={13} />
        Needs you
      </span>
      {groups.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          Nothing needs you right now. None of your tasks is late or due this week, and every open
          task has someone on it.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="min-w-0">
              <h4 className={`text-[13px] font-semibold ${g.tone}`}>
                {g.label} <span className="font-mono font-normal text-faint">{g.rows.length}</span>
              </h4>
              <ul className="mt-1.5 space-y-0.5">
                {g.rows.slice(0, LIST_CAP).map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(i.id)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 truncate text-[14px] text-ink">{i.title}</span>
                      {i.due_at && (
                        <span className="shrink-0 font-mono text-[11px] text-faint">{formatDue(i.due_at)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {g.rows.length > LIST_CAP && (
                <p className="mt-1 px-2 text-[12px] text-faint">and {g.rows.length - LIST_CAP} more</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
