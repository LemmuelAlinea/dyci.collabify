// src/components/work/BacklogView.tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { SprintDialog } from './SprintDialog'
import { authErrorMessage } from '../../lib/authError'
import { dateRange, formatDue, isOverdue } from '../../lib/general/dates'
import { backlogItems, rankForMove, sprintItems } from '../../lib/work/backlog'
import { nextSprintDraft, plannedSprints, runningSprint } from '../../lib/work/sprints'
import type { Sprint, WorkItem, WorkSource } from '../../lib/work/types'

const BACKLOG = ''

/**
 * Planning: the sprints that have not started, each with its tasks, then
 * the backlog. Tasks move between them with a "Move to" picker (one at a
 * time, or several checked), and up and down within a list.
 */
export function BacklogView({ source }: { source: WorkSource }) {
  const { show } = useToast()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState(BACKLOG)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [deleting, setDeleting] = useState<Sprint | null>(null)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const running = runningSprint(source.sprints)
  const planned = plannedSprints(source.sprints)
  const backlog = backlogItems(source.items)
  const targets = [
    { value: BACKLOG, label: 'Backlog' },
    ...(running ? [{ value: running.id, label: `${running.name} (running)` }] : []),
    ...planned.map((s) => ({ value: s.id, label: s.name })),
  ]

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action()
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    }
  }

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function moveChecked() {
    await run(async () => {
      await source.moveToSprint([...checked], bulkTarget || null)
      setChecked(new Set())
    }, 'Could not move those tasks.')
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    await run(async () => {
      await source.addToBacklog(title.trim())
      setTitle('')
    }, 'Could not add that task.')
    setAdding(false)
  }

  const list = (items: WorkItem[]) =>
    items.length === 0 ? null : (
      <ul className="divide-y divide-[var(--line)]">
        {items.map((item, index) => (
          <ItemRow
            key={item.id}
            item={item}
            canPlan={source.canPlan}
            checked={checked.has(item.id)}
            onCheck={() => toggle(item.id)}
            onOpen={() => source.openTask(item.id)}
            targets={targets}
            onMove={(to) => void run(() => source.moveToSprint([item.id], to || null), 'Could not move that task.')}
            onStep={(dir) => {
              const rank = rankForMove(items, index, dir)
              if (rank !== null) void run(() => source.setRank(item.id, rank), 'Could not move that task.')
            }}
            first={index === 0}
            last={index === items.length - 1}
          />
        ))}
      </ul>
    )

  return (
    <div className="space-y-6">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3>Coming up</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Sprints that have not started. Move tasks in from the backlog, then start one when the team is ready.
          </p>
        </div>
        {source.canPlan && (
          <Button size="sm" className="!rounded-lg" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />
            Create sprint
          </Button>
        )}
      </div>

      {planned.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          No sprint is planned. {source.canPlan ? 'Create one, then move tasks into it.' : 'Nothing to show yet.'}
        </p>
      ) : (
        planned.map((s) => {
          const items = sprintItems(source.items, s.id)
          return (
            <section key={s.id} className="card overflow-hidden shadow-card">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h4 className="font-semibold text-ink">{s.name}</h4>
                  <p className="mt-0.5 font-mono text-[12px] text-faint">
                    {dateRange(s.starts_on, s.ends_on)} · {items.length} {items.length === 1 ? 'task' : 'tasks'}
                  </p>
                  {s.goal && <p className="mt-1 text-[13px] text-muted">{s.goal}</p>}
                </div>
                {source.canPlan && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="!rounded-lg"
                      disabled={Boolean(running)}
                      title={running ? `Finish ${running.name} first.` : undefined}
                      onClick={() => void run(() => source.startSprint(s.id), 'Could not start the sprint.')}
                    >
                      <Icon name="target" size={15} />
                      Start sprint
                    </Button>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit ${s.name}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(s)}
                      aria-label={`Delete ${s.name}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-500/12 dark:hover:text-danger-400"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </header>
              {list(items) ?? <p className="px-4 py-5 text-[13px] text-faint">No tasks in this sprint yet.</p>}
            </section>
          )
        })
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3>
              Backlog <span className="font-mono text-[13px] font-normal text-faint">{backlog.length}</span>
            </h3>
            <p className="mt-0.5 text-[13px] text-muted">Every unfinished task that is not in a sprint. The top is what comes next.</p>
          </div>
          {source.canPlan && checked.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted">{checked.size} checked</span>
              <Select
                value={bulkTarget}
                onChange={(e) => setBulkTarget(e.target.value)}
                options={targets}
                aria-label="Move checked tasks to"
                className="!h-9 !text-[13px]"
              />
              <Button size="sm" className="!rounded-lg" onClick={() => void moveChecked()}>
                Move
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>

        <div className="card overflow-hidden shadow-card">
          {list(backlog) ?? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              The backlog is empty. Every unfinished task is in a sprint.
            </p>
          )}
          {source.canAdd && (
            <form onSubmit={(e) => void add(e)} className="flex gap-2 border-t border-line p-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a task to the backlog"
                aria-label="New backlog task"
                maxLength={200}
                className="!h-10 !text-[14px]"
              />
              <Button type="submit" size="sm" className="!h-10 !rounded-lg" loading={adding} disabled={!title.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>
      </section>

      <SprintDialog
        key={creating ? 'new-open' : 'new'}
        open={creating}
        onClose={() => setCreating(false)}
        title="New sprint"
        submitLabel="Create sprint"
        initial={nextSprintDraft(source.sprints)}
        onSubmit={(input) => source.createSprint(input)}
      />
      {editing && (
        <SprintDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          title={`Edit ${editing.name}`}
          submitLabel="Save sprint"
          initial={{ name: editing.name, goal: editing.goal, startsOn: editing.starts_on, endsOn: editing.ends_on }}
          onSubmit={(input) => source.updateSprint(editing.id, input)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await source.deleteSprint(deleting.id)
        }}
        title={`Delete ${deleting?.name ?? 'this sprint'}?`}
        body="Its tasks go back to the backlog. Nothing else changes."
        confirmLabel="Delete sprint"
        tone="danger"
      />
    </div>
  )
}

function ItemRow({
  item,
  canPlan,
  checked,
  onCheck,
  onOpen,
  targets,
  onMove,
  onStep,
  first,
  last,
}: {
  item: WorkItem
  canPlan: boolean
  checked: boolean
  onCheck: () => void
  onOpen: () => void
  targets: { value: string; label: string }[]
  onMove: (to: string) => void
  onStep: (dir: -1 | 1) => void
  first: boolean
  last: boolean
}) {
  const overdue = isOverdue(item.due_at, item.status)
  const step =
    'grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:pointer-events-none disabled:opacity-30'
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      {canPlan && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          aria-label={`Check ${item.title}`}
          className="h-4 w-4 shrink-0 accent-[var(--color-navy-600)]"
        />
      )}
      <div className="min-w-0 flex-1 basis-48">
        <button
          type="button"
          onClick={onOpen}
          className={`block max-w-full truncate text-left text-[14px] font-medium hover:underline ${
            item.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {item.title}
        </button>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-faint">
          <span className={item.holders.length ? '' : 'text-warning-700 dark:text-warning-300'}>
            {item.holders.length ? item.holders.join(', ') : 'Nobody yet'}
          </span>
          {item.due_at && (
            <span className={`font-mono ${overdue ? 'text-danger-600 dark:text-danger-400' : ''}`}>{formatDue(item.due_at)}</span>
          )}
        </p>
      </div>
      {canPlan && (
        <div className="flex items-center gap-1">
          <button type="button" className={step} onClick={() => onStep(-1)} disabled={first} aria-label={`Move ${item.title} up`}>
            <Icon name="chevronDown" size={15} className="rotate-180" />
          </button>
          <button type="button" className={step} onClick={() => onStep(1)} disabled={last} aria-label={`Move ${item.title} down`}>
            <Icon name="chevronDown" size={15} />
          </button>
          <Select
            value={item.sprint_id ?? BACKLOG}
            onChange={(e) => onMove(e.target.value)}
            options={targets}
            aria-label={`Move ${item.title} to`}
            className="!h-8 !w-auto !pr-8 !pl-2.5 !text-[12px]"
          />
        </div>
      )}
    </li>
  )
}
