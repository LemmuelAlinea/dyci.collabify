import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { MilestoneDialog } from './MilestoneDialog'
import { TagTasksDialog } from './TagTasksDialog'
import { useNow } from '../../hooks/useNow'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import { addDays, toDay } from '../../lib/work/sprints'
import {
  MILESTONE_STATUS_LABEL,
  dueInLabel,
  milestoneProgress,
  milestoneStatus,
  sortMilestones,
} from '../../lib/work/milestones'
import type { MilestoneStatus } from '../../lib/work/milestones'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

const TONE: Record<MilestoneStatus, string> = {
  reached: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300',
  late: 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300',
  at_risk: 'bg-warning-50 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300',
  upcoming: 'bg-pending-soft text-pending-ink',
}

function StatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${TONE[status]}`}>
      {MILESTONE_STATUS_LABEL[status]}
    </span>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full surface-sunken">
      <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
    </span>
  )
}

/**
 * Dated goals and how close each one is. A milestone's progress is the share
 * of its tagged tasks that are done; a professor sees that per group.
 */
export function MilestonesView({ source }: { source: MilestoneSource }) {
  const now = useNow()
  const { show } = useToast()
  const [createKey, setCreateKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [deleting, setDeleting] = useState<Milestone | null>(null)
  const [tagging, setTagging] = useState<Milestone | null>(null)
  const list = sortMilestones(source.milestones)
  // A professor's source carries one group per board; everyone else reads their own items.
  const professor = source.groups.length > 0

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action()
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    }
  }

  return (
    <div className="space-y-5">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3>Milestones</h3>
          <p className="mt-0.5 max-w-prose text-[13px] text-muted">
            Dated goals. Tag the tasks that count toward each one; its progress is how many of those are done.
          </p>
        </div>
        {source.canManage && (
          <Button
            size="sm"
            className="!rounded-lg"
            onClick={() => {
              setCreateKey((k) => k + 1)
              setCreating(true)
            }}
          >
            <Icon name="plus" size={15} />
            Add milestone
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
          No milestones yet. {source.canManage ? 'Add the first one, such as a draft or a defense date.' : 'When one is set, it shows here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((m) => {
            const progress = milestoneProgress(source.items, m.id)
            const status = milestoneStatus(m, progress, now)
            const tagged = source.items.filter((i) => i.milestone_id === m.id)
            return (
              <li key={m.id} className="card space-y-3 p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-ink">{m.name}</h4>
                      {!professor && <StatusPill status={status} />}
                    </div>
                    <p className="mt-0.5 font-mono text-[12px] text-faint">
                      {formatDay(m.due_on)} · {dueInLabel(m.due_on, now)}
                    </p>
                    {m.description && <p className="mt-1.5 max-w-prose text-[13px] text-muted">{m.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {source.canTag && (
                      <Button size="sm" variant="outline" className="!rounded-lg" onClick={() => setTagging(m)}>
                        <Icon name="plus" size={15} />
                        Tag tasks
                      </Button>
                    )}
                    {source.canMarkReached && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void run(() => source.setReached(m.id, !m.reached_at), 'Could not change that milestone.')}
                      >
                        {m.reached_at ? 'Not reached yet' : 'Mark reached'}
                      </Button>
                    )}
                    {source.canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(m)}
                          aria-label={`Edit ${m.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(m)}
                          aria-label={`Delete ${m.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-500/12 dark:hover:text-danger-400"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {professor ? (
                  <ul className="divide-y divide-[var(--line)]">
                    {source.groups.map((g) => {
                      const p = milestoneProgress(g.items, m.id)
                      return (
                        <li key={g.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                          <span className="min-w-[8rem] flex-1 truncate text-[14px] text-ink">{g.name}</span>
                          <span className="w-28 shrink-0"><Bar pct={p.pct} /></span>
                          <span className="w-16 shrink-0 text-right font-mono text-[12px] text-faint">
                            {p.done}/{p.total}
                          </span>
                          <StatusPill status={milestoneStatus(m, p, now)} />
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <>
                    <div>
                      <div className="mb-1 flex items-baseline justify-between text-[12px]">
                        <span className="text-muted">
                          <strong className="text-ink">{progress.done} of {progress.total}</strong> tagged tasks done
                        </span>
                        <span className="font-mono text-faint">{progress.pct}%</span>
                      </div>
                      <Bar pct={progress.pct} />
                    </div>
                    {tagged.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[13px] text-muted">
                          {tagged.length} {tagged.length === 1 ? 'task' : 'tasks'}
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {tagged.map((i) => (
                            <li key={i.id} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => source.openTask(i.id)}
                                className={`min-w-0 flex-1 truncate text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
                              >
                                {i.title}
                              </button>
                              {source.canTag && (
                                <button
                                  type="button"
                                  onClick={() => void run(() => source.tag([i.id], null), 'Could not untag that task.')}
                                  aria-label={`Stop counting ${i.title} toward ${m.name}`}
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                                >
                                  <Icon name="x" size={14} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <MilestoneDialog
        key={createKey}
        open={creating}
        onClose={() => setCreating(false)}
        title="New milestone"
        submitLabel="Add milestone"
        initial={{ name: '', description: '', dueOn: addDays(toDay(now), 14) }}
        onSubmit={(input) => source.createMilestone(input)}
      />
      {editing && (
        <MilestoneDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          title={`Edit ${editing.name}`}
          submitLabel="Save milestone"
          initial={{ name: editing.name, description: editing.description, dueOn: editing.due_on }}
          onSubmit={(input) => source.updateMilestone(editing.id, input)}
        />
      )}
      {tagging && <TagTasksDialog open onClose={() => setTagging(null)} milestone={tagging} source={source} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await source.deleteMilestone(deleting.id)
        }}
        title={`Delete ${deleting?.name ?? 'this milestone'}?`}
        body="Its tasks stay where they are; they just stop counting toward it."
        confirmLabel="Delete milestone"
        tone="danger"
      />
    </div>
  )
}
