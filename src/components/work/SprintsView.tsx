// src/components/work/SprintsView.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { Burndown } from './Burndown'
import { FinishSprintDialog } from './FinishSprintDialog'
import { useNow } from '../../hooks/useNow'
import { dateRange } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import { sprintItems } from '../../lib/work/backlog'
import { daysLeft, daysLeftLabel, finishedSprints, runningSprint, sprintCounts } from '../../lib/work/sprints'
import type { WorkSource } from '../../lib/work/types'

const COLUMN_TONE = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
} as const

/** Running the sprint, then looking back at the finished ones. */
export function SprintsView({ source, onPlan }: { source: WorkSource; onPlan: () => void }) {
  const now = useNow()
  const [finishing, setFinishing] = useState(false)
  const running = runningSprint(source.sprints)
  const finished = finishedSprints(source.sprints)

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
                  <h3 className="mb-2 text-[14px]">Burndown</h3>
                  <Burndown sprint={running} items={source.items} />
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
                            <li key={i.id}>
                              <button
                                type="button"
                                onClick={() => source.openTask(i.id)}
                                className={`block w-full truncate text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
                              >
                                {i.title}
                              </button>
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
        <h3>Finished sprints</h3>
        {finished.length === 0 ? (
          <p className="text-[13px] text-muted">None yet. A sprint lands here once it is finished.</p>
        ) : (
          <ul className="space-y-2">
            {finished.map((s) => {
              const { done, total } = sprintCounts(source.items, s.id)
              const doneItems = sprintItems(source.items, s.id).filter((i) => i.status === 'done')
              return (
                <li key={s.id} className="surface rounded-xl border border-line px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{s.name}</span>
                      <span className="font-mono text-[12px] text-faint">
                        {dateRange(s.starts_on, s.ends_on)} · {done} of {total} done
                      </span>
                    </summary>
                    {s.goal && <p className="mt-2 text-[13px] text-muted">{s.goal}</p>}
                    <ul className="mt-2 space-y-1">
                      {doneItems.map((i) => (
                        <li key={i.id}>
                          <button type="button" onClick={() => source.openTask(i.id)} className="text-left text-[13px] text-ink hover:underline">
                            {i.title}
                          </button>
                        </li>
                      ))}
                      {doneItems.length === 0 && <li className="text-[12px] text-faint">Nothing was finished in it.</li>}
                    </ul>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {running && finishing && (
        <FinishSprintDialog open onClose={() => setFinishing(false)} sprint={running} source={source} />
      )}
    </div>
  )
}
