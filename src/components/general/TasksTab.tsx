// src/components/general/TasksTab.tsx
import { useMemo, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { StageBadge, StageSelect } from '../tasks/StageSelect'
import { TaskViewSwitch } from '../tasks/TaskViewSwitch'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { TasksFromNotes } from './TasksFromNotes'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { createTask, updateTask } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue } from '../../lib/general/dates'
import { TASK_STATUSES, projectProgress } from '../../lib/general/progress'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import type { GeneralTask } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { formatMinutes } from '../../lib/types'
import { sprintCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import type { TaskLayout } from '../../lib/work/nav'
import { applyScope, scopeOptions, scopeSprintId, scopeTargetSprint } from '../../lib/work/scope'
import type { TaskScope } from '../../lib/work/scope'
import { sprintBands } from '../../lib/work/timeline'
import { ScopePicker } from '../work/ScopePicker'
import { TaskCalendar } from '../work/TaskCalendar'
import { TimelineView } from '../work/TimelineView'
import type { GeneralProjectState } from './useGeneralProject'

/** The same column colours as a class board. */
const COLUMN_TONE: Record<GeneralTaskStatus, string> = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
}

const NEXT: Record<GeneralTaskStatus, { to: GeneralTaskStatus; label: string; icon: 'check' | 'refresh' }> = {
  todo: { to: 'in_progress', label: 'Start', icon: 'check' },
  in_progress: { to: 'done', label: 'Mark done', icon: 'check' },
  done: { to: 'todo', label: 'Reopen', icon: 'refresh' },
}

/**
 * A work project's tasks: Board, List, Timeline and Calendar over the same
 * filtered set. Summary lives beside it in Work (WorkSummary.tsx).
 */
export function TasksTab({
  state,
  layout,
  onLayout,
  scope,
  onScope,
  onOpenTask,
}: {
  state: GeneralProjectState
  layout: TaskLayout
  onLayout: (l: TaskLayout) => void
  scope: TaskScope
  onScope: (s: TaskScope) => void
  onOpenTask: (id: string | null) => void
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [assignee, setAssignee] = useState('')
  const [status, setStatus] = useState<GeneralTaskStatus | ''>('')
  const [creating, setCreating] = useState(false)
  const [fromNotes, setFromNotes] = useState(false)
  const showTask = onOpenTask

  const project = state.project
  const scoped = useMemo(() => applyScope(state.tasks, scope, state.sprints), [state.tasks, scope, state.sprints])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped
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
  }, [scoped, query, team, assignee, status])

  if (!project) return null
  const progress = projectProgress(scoped)
  const unassigned = scoped.filter((t) => t.assignee_ids.length === 0 && t.status !== 'done').length

  const assigneeOptions = [
    ...(state.viewerId ? [{ value: state.viewerId, label: 'Me' }] : []),
    { value: 'nobody', label: 'Nobody yet' },
    ...state.members
      .filter((m) => m.user_id !== state.viewerId)
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) })),
  ]

  /** Who may move a task along: its holders, anyone who manages tasks. */
  const mayMove = (t: GeneralTask) =>
    !state.archived &&
    (state.can('manage_tasks') || Boolean(state.viewerId && t.assignee_ids.includes(state.viewerId)))

  async function move(t: GeneralTask, to: GeneralTaskStatus) {
    try {
      await updateTask(t.id, { status: to })
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that task.'), 'error')
    }
  }

  return (
    <div className="space-y-4">
      {state.tasks.length > 0 && (
        <>
          {state.sprints.length > 0 && (
            <ScopePicker value={scope} options={scopeOptions(state.sprints)} onChange={onScope} />
          )}
          <TaskViewSwitch view={layout} onView={onLayout} shown={shown.length} total={scoped.length} />
          <div>
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
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[13px] text-muted">
          <strong className="text-ink">
            {progress.done} of {progress.total}
          </strong>{' '}
          done
          {progress.total > 0 && (
            <span className="text-faint">
              {' · '}
              {progress.pct}%
            </span>
          )}
          {unassigned > 0 && (
            <>
              {' · '}
              <span className="text-warning-700 dark:text-warning-300">{unassigned} with nobody on them</span>
            </>
          )}
        </p>
        {!state.archived && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="!rounded-lg" onClick={() => setFromNotes(true)}>
              <Icon name="spark" size={15} />
              From notes
            </Button>
            <Button size="sm" className="!rounded-lg" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} />
              Add task
            </Button>
          </div>
        )}
      </div>

      {state.tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="No tasks yet"
          body="Break the project into pieces somebody can pick up. Anyone on the project can add one."
          action={
            !state.archived ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button className="!rounded-xl" onClick={() => setCreating(true)}>
                  Add the first task
                </Button>
                <Button variant="outline" className="!rounded-xl" onClick={() => setFromNotes(true)}>
                  <Icon name="spark" size={15} />
                  Draft from notes
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : scoped.length === 0 ? (
        <EmptyState
          icon="target"
          title="No tasks here"
          body={
            scope === 'backlog'
              ? 'Every task is in a sprint.'
              : state.sprints.find((s) => s.id === scopeSprintId(scope, state.sprints))?.state === 'completed'
                ? 'Nothing was recorded in this sprint.'
                : 'This sprint has no tasks yet. Move some in from Backlog.'
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" body="No task fits these filters. Clear one and try again." />
      ) : layout === 'board' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((s) => {
            const column = shown.filter((t) => t.status === s.value)
            return (
              <section key={s.value} className="space-y-3">
                <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h3 className={`font-semibold ${COLUMN_TONE[s.value]}`}>{s.label}</h3>
                  <span className="font-mono text-[12px] text-faint">{column.length}</span>
                </header>
                {column.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-faint">
                    Nothing here
                  </p>
                ) : (
                  column.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      state={state}
                      canMove={mayMove(t)}
                      onMove={(to) => void move(t, to)}
                      onOpen={() => showTask(t.id)}
                    />
                  ))
                )}
              </section>
            )
          })}
        </div>
      ) : layout === 'list' ? (
        <TaskTable tasks={shown} state={state} onOpen={showTask} mayMove={mayMove} onMove={move} />
      ) : layout === 'timeline' ? (
        <TimelineView
          tasks={shown.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            starts_at: t.starts_at,
            due_at: t.due_at,
            group_id: t.team_id,
          }))}
          groups={state.teams}
          span={project}
          bands={sprintBands(state.sprints)}
          onOpen={showTask}
        />
      ) : (
        <TaskCalendar
          events={[
            ...taskCalendarEvents(shown, (t) => state.teams.find((x) => x.id === t.team_id)?.name ?? ''),
            ...sprintCalendarEvents(state.sprints),
          ]}
          onOpen={showTask}
        />
      )}

      <NewTaskDialog
        open={creating}
        onClose={() => setCreating(false)}
        state={state}
        sprintId={state.can('manage_tasks') ? scopeTargetSprint(scope, state.sprints) : null}
        onCreated={showTask}
      />
      <TasksFromNotes open={fromNotes} onClose={() => setFromNotes(false)} state={state} />
    </div>
  )
}

function Holders({ task, state, size = 22 }: { task: GeneralTask; state: GeneralProjectState; size?: number }) {
  if (task.assignee_ids.length === 0) {
    return <span className="text-[12px] text-warning-700 dark:text-warning-300">Nobody yet</span>
  }
  const profiles = task.assignee_ids.map((id) => ({ id, profile: state.members.find((m) => m.user_id === id)?.profile }))
  const first = state.nameOf(task.assignee_ids[0])
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0">
        {profiles.slice(0, 3).map(
          ({ id, profile }) =>
            profile && (
              <span
                key={id}
                title={state.nameOf(id)}
                className="-ml-1.5 rounded-full ring-2 ring-[var(--surface)] first:ml-0"
              >
                <Avatar profile={profile} size={size} />
              </span>
            ),
        )}
      </span>
      <span className="min-w-0 truncate text-[12px] text-muted">
        {task.assignee_ids.length > 1 ? `${first.split(' ')[0]} +${task.assignee_ids.length - 1}` : first}
      </span>
    </span>
  )
}

function TaskCard({
  task,
  state,
  canMove,
  onMove,
  onOpen,
}: {
  task: GeneralTask
  state: GeneralProjectState
  canMove: boolean
  onMove: (to: GeneralTaskStatus) => void
  onOpen: () => void
}) {
  const teamName = state.teams.find((t) => t.id === task.team_id)?.name
  const overdue = isOverdue(task.due_at, task.status)
  const yours = Boolean(state.viewerId && task.assignee_ids.includes(state.viewerId))
  const next = NEXT[task.status]

  return (
    <article
      className={`surface group relative rounded-xl border p-3.5 shadow-card transition-colors duration-200 ${
        yours
          ? 'border-warning-300 hover:border-warning-400 dark:border-warning-400/50'
          : 'border-line hover:border-line-strong'
      }`}
    >
      {/* A stretched button rather than a wrapping one: the card holds its own controls. */}
      <button type="button" onClick={onOpen} aria-label={`Open ${task.title}`} className="absolute inset-0 z-0 rounded-xl" />
      <div className="pointer-events-none flex items-start justify-between gap-2">
        <h4
          className={`min-w-0 text-[14px] leading-snug font-medium break-words group-hover:underline ${
            task.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </h4>
        <div className="flex shrink-0 items-center gap-1">
          {teamName && (
            <span className="max-w-[8rem] truncate rounded-md bg-navy-50 px-1.5 py-0.5 text-[12px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
              {teamName}
            </span>
          )}
        </div>
      </div>

      {task.description && (
        <p className="pointer-events-none mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">
          {task.description}
        </p>
      )}

      <div className="pointer-events-none mt-3 flex flex-wrap items-center justify-between gap-2">
        <Holders task={task} state={state} />
        {(task.file_count > 0 || task.comment_count > 0) && (
          <span className="flex items-center gap-3 text-[12px] text-faint">
            {task.file_count > 0 && (
              <span className="flex items-center gap-1" title="Files attached">
                <Icon name="file" size={12} />
                {task.file_count}
              </span>
            )}
            {task.comment_count > 0 && (
              <span className="flex items-center gap-1" title="Comments">
                <Icon name="message" size={12} />
                {task.comment_count}
              </span>
            )}
          </span>
        )}
        {task.due_at && (
          <span
            className={`flex items-center gap-1 font-mono text-[12px] ${
              overdue ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
            }`}
          >
            <Icon name="clock" size={12} />
            {formatDue(task.due_at)}
          </span>
        )}
      </div>

      <div className="relative z-10 mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {canMove ? (
          <button
            type="button"
            onClick={() => onMove(next.to)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-navy-600 transition-colors hover:bg-[var(--surface-sunken)] dark:text-navy-200"
          >
            <Icon name={next.icon} size={14} />
            {next.label}
          </button>
        ) : (
          <span className="px-2 text-[12px] text-faint">
            {task.assignee_ids.length === 0 ? 'Open to the project' : 'Whoever is on it moves it'}
          </span>
        )}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Edit ${task.title}`}
          className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="edit" size={14} />
        </button>
      </div>
    </article>
  )
}

function TaskTable({
  tasks,
  state,
  onOpen,
  mayMove,
  onMove,
}: {
  tasks: GeneralTask[]
  state: GeneralProjectState
  onOpen: (id: string) => void
  mayMove: (t: GeneralTask) => boolean
  onMove: (t: GeneralTask, to: GeneralTaskStatus) => Promise<void>
}) {
  return (
    <div className="surface overflow-x-auto rounded-card border border-line shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] tracking-wide text-faint uppercase">
            <th className="py-2.5 pr-3 pl-4 font-medium">Task</th>
            <th className="py-2.5 pr-3 font-medium">Held by</th>
            <th className="py-2.5 pr-3 font-medium">Stage</th>
            <th className="py-2.5 pr-3 font-medium">Due</th>
            <th className="py-2.5 pr-4 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = isOverdue(t.due_at, t.status)
            const teamName = state.teams.find((x) => x.id === t.team_id)?.name
            return (
              <tr key={t.id} className="border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)]">
                <td className="py-2.5 pr-3 pl-4">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className={`block max-w-[320px] truncate text-left text-[14px] font-medium hover:underline ${
                      t.status === 'done' ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {t.title}
                  </button>
                  <span className="mt-0.5 flex items-center gap-3 text-[12px] text-faint">
                    {teamName && <span>{teamName}</span>}
                    {t.file_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="file" size={11} />
                        {t.file_count}
                      </span>
                    )}
                    {t.comment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="message" size={11} />
                        {t.comment_count}
                      </span>
                    )}
                    {t.logged_minutes > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size={11} />
                        {formatMinutes(t.logged_minutes)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="max-w-[180px] py-2.5 pr-3">
                  <Holders task={t} state={state} />
                </td>
                <td className="py-2.5 pr-3">
                  {mayMove(t) ? (
                    <StageSelect status={t.status} title={t.title} onChange={(to) => onMove(t, to)} />
                  ) : (
                    <StageBadge status={t.status} />
                  )}
                </td>
                <td className={`py-2.5 pr-3 font-mono text-[12px] ${overdue ? 'text-danger-600 dark:text-danger-400' : 'text-faint'}`}>
                  {t.due_at ? formatDue(t.due_at) : '—'}
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    aria-label={`Open ${t.title}`}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="chevronRight" size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NewTaskDialog({
  open,
  onClose,
  state,
  sprintId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  sprintId: string | null
  onCreated: (id: string) => void
}) {
  const { show } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [starts, setStarts] = useState('')
  const [team, setTeam] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = state.project

  async function create() {
    if (!project) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
    setBusy(true)
    try {
      const id = await createTask({
        projectId: project.id,
        title,
        description,
        dueAt,
        startsAt,
        teamId: team || null,
        sprintId,
      })
      show('Task added')
      setTitle('')
      setDescription('')
      setDue('')
      setStarts('')
      setTeam('')
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
