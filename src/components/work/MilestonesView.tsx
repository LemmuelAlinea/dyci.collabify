import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ActionMenu } from '../ui/ActionMenu'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { MilestoneDialog } from './MilestoneDialog'
import { ProgressBar, StatusPill } from './MilestoneBits'
import { AddSprintDialog } from './AddSprintDialog'
import { TagTasksDialog } from './TagTasksDialog'
import { useNow } from '../../hooks/useNow'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import { addDays, toDay } from '../../lib/work/sprints'
import {
  dueInLabel,
  milestoneProgress,
  milestoneStatus,
  sortMilestones,
} from '../../lib/work/milestones'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

/**
 * Dated goals and how close each one is. A milestone's progress is the share
 * of its tagged tasks that are done; a professor sees that per group. Adding
 * a sprint tags every task in it, and any that join later.
 */
export function MilestonesView({ source }: { source: MilestoneSource }) {
  const now = useNow()
  const { show } = useToast()
  const [createKey, setCreateKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [deleting, setDeleting] = useState<Milestone | null>(null)
  const [tagging, setTagging] = useState<Milestone | null>(null)
  const [addingSprint, setAddingSprint] = useState<Milestone | null>(null)
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
            Dated goals. Tag the tasks or add the sprints that count toward each one; its progress is how many of those tasks are done.
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
            const linked = source.sprints.filter((sp) => sp.milestone_id === m.id)
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
                  <ActionMenu
                    label={`Actions for ${m.name}`}
                    items={[
                      source.canTag && { label: 'Tag tasks', icon: 'plus', onSelect: () => setTagging(m) },
                      source.canTag &&
                        source.sprints.length > 0 && { label: 'Add sprint', icon: 'target', onSelect: () => setAddingSprint(m) },
                      source.canMarkReached && {
                        label: m.reached_at ? 'Not reached yet' : 'Mark reached',
                        icon: m.reached_at ? 'undo' : 'checkCircle',
                        onSelect: () => void run(() => source.setReached(m.id, !m.reached_at), 'Could not change that milestone.'),
                      },
                      source.canManage && {
                        label: 'Edit',
                        icon: 'edit',
                        onSelect: () => setEditing(m),
                        separated: source.canTag || source.canMarkReached,
                      },
                      source.canManage && { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => setDeleting(m) },
                    ]}
                  />
                </div>

                {professor ? (
                  <ul className="divide-y divide-[var(--line)]">
                    {source.groups.map((g) => {
                      const p = milestoneProgress(g.items, m.id)
                      return (
                        <li key={g.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                          <span className="min-w-[8rem] flex-1 truncate text-[14px] text-ink">{g.name}</span>
                          <span className="w-28 shrink-0"><ProgressBar pct={p.pct} /></span>
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
                      <ProgressBar pct={progress.pct} />
                    </div>
                    {linked.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] text-faint">Sprints:</span>
                        {linked.map((sp) => (
                          <span key={sp.id} className="flex items-center gap-1 rounded-lg surface-sunken py-1 pr-1 pl-2.5 text-[12px] text-ink">
                            {sp.name}
                            {source.canTag && (
                              <button
                                type="button"
                                onClick={() => void run(() => source.linkSprint(sp.id, null), 'Could not take that sprint off.')}
                                aria-label={`Stop counting ${sp.name} toward ${m.name}`}
                                className="grid h-5 w-5 place-items-center rounded-full text-faint hover:text-ink"
                              >
                                <Icon name="x" size={11} />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
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
      {addingSprint && (
        <AddSprintDialog open onClose={() => setAddingSprint(null)} milestone={addingSprint} source={source} />
      )}
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
