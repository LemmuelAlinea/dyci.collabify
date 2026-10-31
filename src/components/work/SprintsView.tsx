// src/components/work/SprintsView.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { BugBadge } from '../general/BugBadge'
import { SprintTimeline } from './SprintTimeline'
import { FinishSprintDialog } from './FinishSprintDialog'
import { useNow } from '../../hooks/useNow'
import { dateRange } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import { sprintItems } from '../../lib/work/backlog'
import { authErrorMessage } from '../../lib/authError'
import { daysLeft, daysLeftLabel, finishedSprints, runningSprint, sprintCounts } from '../../lib/work/sprints'
import type { Milestone, Sprint, WorkSource } from '../../lib/work/types'

const COLUMN_TONE = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
} as const

/** Running the sprint, then looking back at the finished ones. */
export function SprintsView({ source, milestones = [], onPlan, archiveHref }: { source: WorkSource; milestones?: readonly Milestone[]; onPlan: () => void; archiveHref?: string }) {
  const now = useNow()
  const { show } = useToast()
  const [finishing, setFinishing] = useState(false)
  const [changing, setChanging] = useState<string | null>(null)
  const running = runningSprint(source.sprints)
  const finished = finishedSprints(source.sprints)
  const archived = finishedSprints(source.sprints, true)

  async function setArchived(id: string, archive: boolean) {
    setChanging(id)
    try {
      await source.archiveSprint(id, archive)
      show(archive ? 'Sprint archived' : 'Sprint restored')
    } catch (err) {
      show(authErrorMessage(err, archive ? 'Could not archive the sprint.' : 'Could not restore the sprint.'), 'error')
    } finally {
      setChanging(null)
    }
  }

  const history = (rows: Sprint[], isArchived: boolean) => (
    <ul className="space-y-2">
      {rows.map((s) => {
        const { done, total } = sprintCounts(source.items, s.id)
        const doneItems = sprintItems(source.items, s.id).filter((i) => i.status === 'done')
        return (
          <li key={s.id} className="surface rounded-xl border border-line px-4 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <details className="min-w-0 flex-1 basis-64">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="font-mono text-[12px] text-faint">
                    {dateRange(s.starts_on, s.ends_on)} · {done} of {total} done
                  </span>
                </summary>
                {s.goal && <p className="mt-2 text-[13px] text-muted">{s.goal}</p>}
                <ul className="mt-2 space-y-1">
                  {doneItems.map((i) => (
                    <li key={i.id} className="flex items-center gap-1.5">
                      <button type="button" onClick={() => source.openTask(i.id)} className="text-left text-[13px] text-ink hover:underline">
                        {i.title}
                      </button>
                      <BugBadge kind={i.kind} />
                    </li>
                  ))}
                  {doneItems.length === 0 && <li className="text-[12px] text-faint">Nothing was finished in it.</li>}
                </ul>
              </details>
              {source.canPlan && (
                <Button size="sm" variant="ghost" className="!rounded-lg" loading={changing === s.id}
                  onClick={() => void setArchived(s.id, !isArchived)}>
                  {isArchived ? 'Restore' : 'Archive'}
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="space-y-6">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      {running ? (
        (() => {
          const items = sprintItems(source.items, running.id)
          const { done, total } = sprintCounts(source.items, running.id)
          const pct = total ? Math.round((done / total) * 100) : 0
          const left = daysLeft(running, now)
          return (
            <section className="card space-y-5 p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Running sprint</p>
                  <h2 className="mt-1">{running.name}</h2>
                  <p className="mt-1 font-mono text-[12px] text-faint">
                    {dateRange(running.starts_on, running.ends_on)} ·{' '}
                    <span className={left <= 0 ? 'text-danger-600 dark:text-danger-400' : ''}>{daysLeftLabel(left)}</span>
                  </p>
                  {running.goal && <p className="mt-2 max-w-prose text-[14px] text-muted">{running.goal}</p>}
                </div>
                {source.canPlan && (
                  <Button size="sm" className="!rounded-lg" onClick={() => setFinishing(true)}>
                    <Icon name="checkCircle" size={15} />
                    Finish sprint
                  </Button>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">
                    <strong className="text-ink">
                      {done} of {total}
                    </strong>{' '}
                    done
                  </span>
                  <span className="font-mono text-faint">{pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full surface-sunken">
                  <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
                </div>
                {left <= 0 && source.canPlan && (
                  <p className="mt-2 text-[12px] text-warning-700 dark:text-warning-300">
                    Its last day has passed. Finish it to move what is left on.
                  </p>
                )}
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <h3 className="mb-3 text-[14px]">Sprint timeline</h3>
                  <SprintTimeline sprint={running} milestones={milestones} items={source.items} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {TASK_STATUSES.map((s) => {
                    const column = items.filter((i) => i.status === s.value)
                    return (
                      <div key={s.value} className="min-w-0">
                        <h4 className={`flex items-baseline justify-between border-b border-line pb-1.5 text-[13px] font-semibold ${COLUMN_TONE[s.value]}`}>
                          {s.label}
                          <span className="font-mono text-[12px] font-normal text-faint">{column.length}</span>
                        </h4>
                        <ul className="mt-2 space-y-1">
                          {column.map((i) => (
                            <li key={i.id} className="flex min-w-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => source.openTask(i.id)}
                                className={`min-w-0 truncate text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
                              >
                                {i.title}
                              </button>
                              <BugBadge kind={i.kind} />
                            </li>
                          ))}
                          {column.length === 0 && <li className="text-[12px] text-faint">Nothing here</li>}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )
        })()
      ) : (
        <EmptyState
          icon="target"
          title="No sprint is running"
          body={source.canPlan ? 'Plan one in Backlog, then start it.' : 'When a sprint starts, it shows here.'}
          action={
            <Button variant="outline" className="!rounded-xl" onClick={onPlan}>
              Go to Backlog
            </Button>
          }
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>Finished sprints</h3>
          {archiveHref && archived.length > 0 && (
            <Link to={archiveHref} className="text-[13px] text-muted hover:text-ink hover:underline">
              Project archive ({archived.length})
            </Link>
          )}
        </div>
        {finished.length === 0 ? (
          <p className="text-[13px] text-muted">
            {archived.length
              ? archiveHref ? 'All finished sprints are in the project archive.' : 'All finished sprints are archived.'
              : 'None yet. A sprint lands here once it is finished.'}
          </p>
        ) : history(finished, false)}
      </section>

      {!archiveHref && archived.length > 0 && (
        <details className="border-t border-line pt-5">
          <summary className="cursor-pointer font-semibold text-ink">Archived sprints ({archived.length})</summary>
          <div className="mt-3">{history(archived, true)}</div>
        </details>
      )}

      {running && finishing && (
        <FinishSprintDialog open onClose={() => setFinishing(false)} sprint={running} source={source} />
      )}
    </div>
  )
}
