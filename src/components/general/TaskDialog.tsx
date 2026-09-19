// src/components/general/TaskDialog.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  addComment,
  addLog,
  assignTask,
  deleteComment,
  deleteLog,
  deleteTask,
  deleteTaskFile,
  generalFileUrl,
  listComments,
  listFiles,
  listLogs,
  listTaskEvents,
  unassignTask,
  updateTask,
  uploadTaskFile,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue, toLocalInput } from '../../lib/general/dates'
import { describeEvent } from '../../lib/general/history'
import { TASK_STATUSES, taskShare } from '../../lib/general/progress'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import type { GeneralComment, GeneralFile, GeneralLog, GeneralTaskEvent } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { formatMinutes } from '../../lib/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

export function TaskDialog({
  state,
  taskId,
  onClose,
}: {
  state: GeneralProjectState
  taskId: string | null
  onClose: () => void
}) {
  const task = state.tasks.find((t) => t.id === taskId) ?? null
  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      title={task?.title ?? 'Task'}
      description={task ? TASK_STATUSES.find((s) => s.value === task.status)?.label : undefined}
      size="xl"
    >
      {task && <TaskBody key={task.id} state={state} taskId={task.id} onClose={onClose} />}
    </Modal>
  )
}

function TaskBody({
  state,
  taskId,
  onClose,
}: {
  state: GeneralProjectState
  taskId: string
  onClose: () => void
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  const [comments, setComments] = useState<GeneralComment[]>([])
  const [files, setFiles] = useState<GeneralFile[]>([])
  const [logs, setLogs] = useState<GeneralLog[]>([])
  const [events, setEvents] = useState<GeneralTaskEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, f, l, e] = await Promise.all([
        listComments(taskId),
        listFiles(taskId),
        listLogs(taskId),
        listTaskEvents(taskId),
      ])
      setComments(c)
      setFiles(f)
      setLogs(l)
      setEvents(e)
    } catch (err) {
      show(authErrorMessage(err, 'Could not load this task.'), 'error')
    } finally {
      setLoaded(true)
    }
  }, [taskId, show])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_task_comments', 'general_task_files', 'general_task_logs', 'general_task_events'])

  if (!task || !state.project) return null

  const me = state.viewerId
  const holds = Boolean(me && task.assignee_ids.includes(me))
  const canManage = state.can('manage_tasks')
  const createdByMe = task.created_by === me
  const archived = state.archived
  const canEdit = !archived && (canManage || holds || (createdByMe && task.assignee_ids.length === 0))
  const canAttach = !archived && (holds || state.can('edit_files'))
  const canDelete = !archived && (canManage || (createdByMe && task.assignee_ids.length === 0))

  /**
   * One write at a time. A second press would match a row the first already
   * removed, and a write that changes nothing comes back as a refusal.
   */
  async function act(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      if (done) show(done)
      await Promise.all([state.reload(), load()])
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <TaskDetails state={state} taskId={task.id} canEdit={canEdit} canManage={canManage} onSaved={load} />

        <section>
          <h3 className="text-[14px]">Comments</h3>
          <ul className="mt-2 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl surface-sunken px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-ink">
                    {c.author_id ? state.nameOf(c.author_id) : 'A former member'}
                    <span className="ml-2 font-normal text-faint">{formatDue(c.created_at)}</span>
                  </p>
                  {(c.author_id === me || canManage) && !archived && (
                    <button
                      type="button"
                      aria-label="Remove comment"
                      disabled={busy}
                      onClick={() => void act(() => deleteComment(c.id), 'Comment removed', 'Could not remove it.')}
                      className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-ink">{c.body}</p>
              </li>
            ))}
            {loaded && comments.length === 0 && <p className="text-[13px] text-faint">No comments yet.</p>}
          </ul>
          {!archived && (
            <CommentForm
              onSend={(body) =>
                act(() => addComment(task.id, task.project_id, body), '', 'Could not post that comment.')
              }
            />
          )}
        </section>
      </div>

      <div className="space-y-6">
        <section>
          <h3 className="text-[14px]">People</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {task.assignee_ids.map((id) => (
              <li
                key={id}
                className="flex items-center gap-1 rounded-full surface-sunken py-0.5 pr-1 pl-2.5 text-[12px] text-ink"
              >
                {state.nameOf(id)}
                {!archived && (canManage || id === me) && (
                  <button
                    type="button"
                    aria-label={id === me ? 'Release this task' : `Take ${state.nameOf(id)} off`}
                    disabled={busy}
                    onClick={() =>
                      void act(() => unassignTask(task.id, id), id === me ? 'Released' : 'Taken off', 'Could not change that.')
                    }
                    className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </li>
            ))}
            {task.assignee_ids.length === 0 && <li className="text-[13px] text-faint">Nobody holds this yet.</li>}
          </ul>
          {!archived && canManage && (
            <div className="mt-2 max-w-[16rem]">
              <Select
                aria-label="Assign someone"
                value=""
                onChange={(e) => {
                  const userId = e.target.value
                  if (userId) void act(() => assignTask(task.id, task.project_id, userId), 'Assigned', 'Could not assign that.')
                }}
                placeholder="Assign someone…"
                options={state.members
                  .filter(
                    (m) =>
                      !task.assignee_ids.includes(m.user_id) && m.profile?.status !== 'rejected',
                  )
                  .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))}
                className="!h-9 !text-[13px]"
              />
            </div>
          )}
          {!archived && !canManage && task.assignee_ids.length === 0 && me && (
            <Button
              size="sm"
              className="mt-2"
              loading={busy}
              onClick={() => void act(() => assignTask(task.id, task.project_id, me), 'The task is yours', 'Could not take it.')}
            >
              Take this task
            </Button>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px]">Files</h3>
            {!canAttach && !archived && <RequestAccessButton state={state} permission="edit_files" />}
          </div>
          <ul className="mt-2 space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Icon name="file" size={15} className="shrink-0 text-faint" />
                <button
                  type="button"
                  onClick={() =>
                    void generalFileUrl(f.file_path)
                      .then((url) => window.open(url, '_blank', 'noopener'))
                      .catch((err) => show(authErrorMessage(err, 'Could not open that file.'), 'error'))
                  }
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
                >
                  {f.file_name}
                </button>
                {!archived && (f.uploaded_by === me || state.can('edit_files')) && (
                  <button
                    type="button"
                    aria-label={`Remove ${f.file_name}`}
                    disabled={busy}
                    onClick={() => void act(() => deleteTaskFile(f), 'File removed', 'Could not remove that file.')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
            {loaded && files.length === 0 && <li className="text-[13px] text-faint">No files.</li>}
          </ul>
          {canAttach && (
            <FilePicker
              onPick={(file) =>
                act(() => uploadTaskFile(task.project_id, task.id, file), 'File added', 'Could not upload that file.')
              }
            />
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px]">Time</h3>
            <span className="font-mono text-[12px] text-faint">{formatMinutes(task.logged_minutes)}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-[13px]">
                <span className="w-14 shrink-0 font-mono text-ink">{formatMinutes(l.minutes)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {state.nameOf(l.user_id)}
                  {l.note ? ` · ${l.note}` : ''}
                </span>
                {l.user_id === me && !archived && (
                  <button
                    type="button"
                    aria-label="Remove time entry"
                    disabled={busy}
                    onClick={() => void act(() => deleteLog(l.id), 'Entry removed', 'Could not remove that entry.')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
            {loaded && logs.length === 0 && <li className="text-[13px] text-faint">No time logged yet.</li>}
          </ul>
          {holds && !archived && (
            <LogForm
              onLog={(minutes, note) =>
                act(() => addLog(task.id, task.project_id, minutes, note), 'Time logged', 'Could not log that time.')
              }
            />
          )}
        </section>

        <section>
          <h3 className="text-[14px]">History</h3>
          <ul className="mt-2 space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[12px] text-muted">
                {describeEvent(e, state.nameOf)}
                <span className="ml-1.5 text-faint">{formatDue(e.created_at)}</span>
              </li>
            ))}
            {loaded && events.length === 0 && <li className="text-[12px] text-faint">Nothing yet.</li>}
          </ul>
        </section>

        {canDelete && (
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={14} />
            Remove task
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await deleteTask(task.id)
          show('Task removed')
          onClose()
          await state.reload()
        }}
        title={`Remove ${task.title}?`}
        body="Its comments, files, time and history go with it. This cannot be undone."
        confirmLabel="Remove task"
      />
    </div>
  )
}

function TaskDetails({
  state,
  taskId,
  canEdit,
  canManage,
  onSaved,
}: {
  state: GeneralProjectState
  taskId: string
  canEdit: boolean
  canManage: boolean
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<GeneralTaskStatus>('todo')
  const [due, setDue] = useState('')
  const [starts, setStarts] = useState('')
  const [team, setTeam] = useState('')
  const [weight, setWeight] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updatedAt = task?.updated_at
  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description)
    setStatus(task.status)
    setDue(toLocalInput(task.due_at))
    setStarts(toLocalInput(task.starts_at))
    setTeam(task.team_id ?? '')
    setWeight(String(task.weight))
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!task || !state.project) return null
  const points = state.project.points_enabled

  if (!canEdit) {
    const teamName = state.teams.find((t) => t.id === task.team_id)?.name
    return (
      <section className="space-y-3 text-[14px]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-faint">Stage</dt>
            <dd className="text-ink">{TASK_STATUSES.find((x) => x.value === task.status)?.label}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Starts</dt>
            <dd className="text-ink">{task.starts_at ? formatDue(task.starts_at) : 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Due</dt>
            <dd
              className={
                task.due_at && isOverdue(task.due_at, task.status)
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-ink'
              }
            >
              {task.due_at ? formatDue(task.due_at) : 'Not set'}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Team</dt>
            <dd className="text-ink">{teamName ?? 'Whole project'}</dd>
          </div>
          {points && (
            <div>
              <dt className="text-[12px] text-faint">Share</dt>
              <dd className="font-mono text-ink">{taskShare(Number(task.weight), state.tasks)}%</dd>
            </div>
          )}
        </dl>
        <p className="whitespace-pre-wrap break-words text-ink">
          {task.description || 'No description.'}
        </p>
        {!state.archived && (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            Take this task or ask to manage tasks to change it.
            <RequestAccessButton state={state} permission="manage_tasks" />
          </p>
        )}
      </section>
    )
  }

  async function save() {
    if (!task) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
    const w = Number(weight)
    if (canManage && points && (!Number.isFinite(w) || w <= 0 || w > 1000))
      return setError('Points are a number above 0 and up to 1000.')
    setBusy(true)
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description,
        status,
        due_at: dueAt,
        starts_at: startsAt,
        team_id: team || null,
        ...(canManage && points ? { weight: w } : {}),
      })
      show('Task saved')
      await Promise.all([state.reload(), onSaved()])
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Title">
        {(id) => <Input id={id} maxLength={LIMIT.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralTaskStatus)}
              options={TASK_STATUSES}
            />
          )}
        </Field>
        <Field label="Starts" optional>
          {(id) => (
            <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          )}
        </Field>
        <Field label="Due" optional>
          {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
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
        {points && canManage && (
          <Field
            label="Points"
            hint={<span className="text-[12px] text-faint">{taskShare(Number(task.weight), state.tasks)}% now</span>}
          >
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
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={busy}>
          Save task
        </Button>
      </div>
    </section>
  )
}

function CommentForm({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!body.trim()) return
        setBusy(true)
        void onSend(body)
          .then(() => setBody(''))
          .finally(() => setBusy(false))
      }}
    >
      <Textarea
        aria-label="Write a comment"
        rows={2}
        maxLength={LIMIT.commentBody}
        placeholder="Write a comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy} disabled={!body.trim()}>
          Comment
        </Button>
      </div>
    </form>
  )
}

function FilePicker({ onPick }: { onPick: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          void onPick(file).finally(() => setBusy(false))
        }}
      />
      <Button variant="outline" size="sm" className="mt-2" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
        Add a file
      </Button>
    </>
  )
}

function LogForm({ onLog }: { onLog: (minutes: number, note: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="mt-2 grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        const m = Number(minutes)
        if (!Number.isInteger(m) || m < 1 || m > 1440) {
          setError('Log between 1 and 1440 minutes at a time.')
          return
        }
        setError(null)
        setBusy(true)
        void onLog(m, note)
          .then(() => {
            setMinutes('')
            setNote('')
          })
          .finally(() => setBusy(false))
      }}
    >
      <Input
        aria-label="Minutes"
        type="number"
        min={1}
        max={1440}
        placeholder="Minutes"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        className="!h-9 !text-[13px]"
      />
      <Input
        aria-label="What you did"
        maxLength={LIMIT.worklogNote}
        placeholder="What you did"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="!h-9 !text-[13px]"
      />
      <Button type="submit" size="sm" variant="outline" className="!h-9" loading={busy}>
        Log
      </Button>
      {error && <p className="text-[12px] text-red-600 sm:col-span-3 dark:text-red-400">{error}</p>}
    </form>
  )
}
