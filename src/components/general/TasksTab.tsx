// src/components/general/TasksTab.tsx
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { createTask } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue } from '../../lib/general/dates'
import { TASK_STATUSES, projectProgress, taskShare } from '../../lib/general/progress'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import type { GeneralTask } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { TaskDialog } from './TaskDialog'
import type { GeneralProjectState } from './useGeneralProject'

type View = 'board' | 'list'

export function TasksTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('board')
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [assignee, setAssignee] = useState('')
  const [status, setStatus] = useState<GeneralTaskStatus | ''>('')
  const [creating, setCreating] = useState(false)

  const openTask = params.get('task')
  const showTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  const project = state.project
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.tasks
      .filter((t) => (team ? t.team_id === team : true))
      .filter((t) =>
        assignee === ''
          ? true
          : assignee === 'nobody'
            ? t.assignee_ids.length === 0
            : t.assignee_ids.includes(assignee),
      )
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (q ? `${t.title} ${t.description}`.toLowerCase().includes(q) : true))
  }, [state.tasks, query, team, assignee, status])

  if (!project) return null
  const progress = projectProgress(state.tasks, project.points_enabled)

  const assigneeOptions = [
    ...(state.viewerId ? [{ value: state.viewerId, label: 'Me' }] : []),
    { value: 'nobody', label: 'Nobody yet' },
    ...state.members
      .filter((m) => m.user_id !== state.viewerId)
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) })),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="surface-sunken flex gap-1 rounded-lg p-0.5" role="group" aria-label="View">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
                view === v ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon name={v === 'board' ? 'kanban' : 'board'} size={15} />
              {v}
            </button>
          ))}
        </div>

        <FilterPopover
          label="Filter tasks"
          active={[query.trim(), team, assignee, status].filter(Boolean).length}
          summary={[
            query.trim() && `“${query.trim()}”`,
            team && state.teams.find((t) => t.id === team)?.name,
            assignee && assigneeOptions.find((o) => o.value === assignee)?.label,
            status && TASK_STATUSES.find((s) => s.value === status)?.label,
          ]
            .filter(Boolean)
            .join(' · ')}
          onClear={() => {
            setQuery('')
            setTeam('')
            setAssignee('')
            setStatus('')
          }}
        >
          <FilterField label="Search">
            <FilterSearch value={query} onChange={setQuery} placeholder="Title or description" />
          </FilterField>
          {state.teams.length > 0 && (
            <FilterField label="Team">
              <Select
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="Every team"
                options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                className="!h-10 !text-[13px]"
              />
            </FilterField>
          )}
          <FilterField label="Held by">
            <Select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Anyone"
              options={assigneeOptions}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
          <FilterField label="Stage">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralTaskStatus | '')}
              placeholder="Every stage"
              options={TASK_STATUSES}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
        </FilterPopover>

        <p className="text-[12px] text-muted">
          {progress.done} of {progress.total} done · {progress.pct}%
          {project.points_enabled ? ' by points' : ''}
          {shown.length !== state.tasks.length && ` · showing ${shown.length}`}
        </p>

        {!state.archived && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New task
          </Button>
        )}
      </div>

      {state.tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="No tasks yet"
          body="Break the project into pieces somebody can pick up. Anyone on the project can add one."
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" body="No task fits these filters." />
      ) : view === 'board' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((s) => {
            const column = shown.filter((t) => t.status === s.value)
            return (
              <section key={s.value} className="rounded-panel surface-sunken p-3">
                <header className="flex items-center justify-between px-1 pb-2">
                  <h3 className="text-[14px]">{s.label}</h3>
                  <span className="font-mono text-[12px] text-faint">{column.length}</span>
                </header>
                <ul className="space-y-2">
                  {column.map((t) => (
                    <li key={t.id}>
                      <TaskCard task={t} state={state} onOpen={() => showTask(t.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Held by</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                {project.points_enabled && <th className="px-4 py-2.5 font-medium">Share</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {shown.map((t) => (
                <tr key={t.id} className="group cursor-pointer hover:bg-[var(--surface-sunken)]" onClick={() => showTask(t.id)}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label={`Open ${t.title}`}
                      className="flex items-center gap-1.5 text-left font-medium text-ink hover:underline"
                    >
                      {t.title}
                      <Icon
                        name="edit"
                        size={12}
                        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted">{TASK_STATUSES.find((s) => s.value === t.status)?.label}</td>
                  <td className="px-4 py-3 text-muted">
                    {t.assignee_ids.length ? t.assignee_ids.map(state.nameOf).join(', ') : 'Nobody yet'}
                  </td>
                  <td className={`px-4 py-3 ${isOverdue(t.due_at, t.status) ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
                    {t.due_at ? formatDue(t.due_at) : '—'}
                  </td>
                  {project.points_enabled && (
                    <td className="px-4 py-3 font-mono text-faint">{taskShare(Number(t.weight), state.tasks)}%</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewTaskDialog open={creating} onClose={() => setCreating(false)} state={state} onCreated={showTask} />
      <TaskDialog state={state} taskId={openTask} onClose={() => showTask(null)} />
    </div>
  )
}

function TaskCard({ task, state, onOpen }: { task: GeneralTask; state: GeneralProjectState; onOpen: () => void }) {
  const teamName = state.teams.find((t) => t.id === task.team_id)?.name
  const overdue = isOverdue(task.due_at, task.status)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${task.title}`}
      className="group w-full rounded-card border border-line bg-[var(--surface)] p-3 text-left transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[14px] font-medium break-words text-ink">{task.title}</p>
        <Icon
          name="edit"
          size={13}
          className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {teamName && <span className="rounded-md surface-sunken px-1.5 py-0.5 text-muted">{teamName}</span>}
        {task.due_at && (
          <span className={overdue ? 'text-red-600 dark:text-red-400' : 'text-faint'}>{formatDue(task.due_at)}</span>
        )}
        {state.project?.points_enabled && (
          <span className="font-mono text-faint">{taskShare(Number(task.weight), state.tasks)}%</span>
        )}
      </div>
      <p className="mt-2 truncate text-[12px] text-muted">
        {task.assignee_ids.length ? task.assignee_ids.map(state.nameOf).join(', ') : 'Nobody yet'}
      </p>
      {(task.comment_count > 0 || task.file_count > 0) && (
        <p className="mt-1.5 flex gap-3 text-[12px] text-faint">
          {task.comment_count > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="message" size={12} />
              {task.comment_count}
            </span>
          )}
          {task.file_count > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="file" size={12} />
              {task.file_count}
            </span>
          )}
        </p>
      )}
    </button>
  )
}

function NewTaskDialog({
  open,
  onClose,
  state,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  onCreated: (id: string) => void
}) {
  const { show } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [starts, setStarts] = useState('')
  const [team, setTeam] = useState('')
  const [weight, setWeight] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = state.project
  const setsPoints = Boolean(project?.points_enabled && state.can('manage_tasks'))

  async function create() {
    if (!project) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
    const w = setsPoints ? Number(weight) : 1
    if (!Number.isFinite(w) || w <= 0 || w > 1000) return setError('Points are a number above 0 and up to 1000.')
    setBusy(true)
    try {
      const id = await createTask({
        projectId: project.id,
        title,
        description,
        dueAt,
        startsAt,
        teamId: team || null,
        weight: w,
      })
      show('Task added')
      setTitle('')
      setDescription('')
      setDue('')
      setStarts('')
      setTeam('')
      setWeight('1')
      onClose()
      await state.reload()
      onCreated(id)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void create()} loading={busy}>
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title">
          {(id) => (
            <Input id={id} maxLength={LIMIT.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" optional>
            {(id) => (
              <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            )}
          </Field>
          <Field label="Due" optional>
            {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
          {state.teams.length > 0 && (
            <Field label="Team" optional>
              {(id) => (
                <Select
                  id={id}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="Whole project"
                  options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                />
              )}
            </Field>
          )}
          {setsPoints && (
            <Field label="Points">
              {(id) => (
                <Input id={id} type="number" min={0.01} max={1000} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
              )}
            </Field>
          )}
        </div>
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
