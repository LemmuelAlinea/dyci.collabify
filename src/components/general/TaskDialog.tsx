// src/components/general/TaskDialog.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../ui/Alert'
import { ActionMenu } from '../ui/ActionMenu'
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
  GENERAL_FILE_LIMIT,
  listComments,
  listFiles,
  listLogs,
  listTaskEvents,
  unassignTask,
  updateTask,
  uploadTaskFile,
} from '../../lib/api/general'
import { trashTaskFile } from '../../lib/api/trash'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue, toLocalInput } from '../../lib/general/dates'
import { describeHistory } from '../../lib/general/history'
import { stageIndex, stageName, stagesOf, statusForStage } from '../../lib/stages'
import { QA_PASSES, inQa } from '../../lib/work/qa'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import { attachFromRepo, attachSummary, repoTree } from '../../lib/general/attachFromRepo'
import { PRIORITIES } from '../../lib/general/types'
import type { GeneralComment, GeneralFile, GeneralLog, GeneralTaskEvent, TaskPriority } from '../../lib/general/types'
import { blockersOf } from '../../lib/general/taskRules'
import { LIMIT } from '../../lib/limits'
import { formatMinutes } from '../../lib/types'
import { assignableTo, canEditTask, canUnassign, keepsCreatorRights } from '../../lib/general/permissions'
import type { TaskViewer } from '../../lib/general/permissions'
import { QaActions } from '../work/QaActions'
import { ProjectFilePicker } from './ProjectFilePicker'
import { RequestAccessButton } from './RequestAccessButton'
import { BugBadge } from './BugBadge'
import { TaskDependencies } from './TaskDependencies'
import { TaskAttachmentCard } from './TaskAttachmentCard'
import { TaskDescription } from './TaskDescription'
import { TaskSubtasks } from './TaskSubtasks'
import { PersonBadge } from './RoleBadge'
import type { GeneralProjectState } from './useGeneralProject'
import { Linkify } from '../ui/Linkify'

export function TaskDialog({
  state,
  taskId,
  onClose,
}: {
  state: GeneralProjectState
  taskId: string | null
  onClose: () => void
}) {
  const { show } = useToast()
  // A parent or subtask opened from inside the window shows here; a new taskId from outside wins.
  const [opened, setOpened] = useState<{ from: string | null; id: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const shownId = opened && opened.from === taskId ? opened.id : taskId
  const task = state.tasks.find((t) => t.id === shownId) ?? null
  const [title, setTitle] = useState(task?.title ?? '')
  useEffect(() => setTitle(task?.title ?? ''), [task?.id, task?.title, task?.updated_at])
  const parent = task?.parent_id ? state.tasks.find((t) => t.id === task.parent_id) : undefined
  const me = state.viewerId
  const canManage = state.can('manage_tasks')
  const viewer: TaskViewer = {
    viewerId: me,
    manageTasks: canManage,
    archived: state.readOnly,
    leadsUser: state.leadsUser,
    role: state.project?.class_board_id ? null : state.myRole,
    holds: (id) => Boolean(me && state.tasks.some((t) => t.id === id && t.assignee_ids.includes(me))),
  }
  const canDelete = Boolean(task && !state.readOnly &&
    (canManage || (task.created_by === me && keepsCreatorRights(viewer, task))))
  const canEdit = Boolean(task && canEditTask(viewer, task))
  const canEditSchedule = Boolean(task && state.project && !state.readOnly && (state.project.class_board_id
    ? canEdit
    : state.myRole === 'pm' || state.myRole === 'coordinator' || (state.teams.some(team => team.id === task.team_id && team.leader_id === me)
      && state.teamMembers.some(member => member.team_id === task.team_id && member.user_id === me))))
  const formId = task ? `task-details-${task.id}` : undefined
  const close = () => {
    if (saving) return
    setOpened(null)
    setDeleting(false)
    setTitle(task?.title ?? '')
    onClose()
  }
  return (
    <>
    <Modal
      open={Boolean(task)}
      onClose={close}
      title={task?.title ?? 'Task'}
      titleContent={task && (canEdit ? (
        <>
          <h2 className="sr-only">{task.title}</h2>
          <input
            aria-label="Task title"
            maxLength={LIMIT.taskTitle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md bg-transparent font-display text-[20px] font-semibold text-banner-ink outline-none focus-visible:ring-2 focus-visible:ring-banner-ink/50 sm:text-[22px]"
          />
        </>
      ) : <h2>{task.title}</h2>)}
      breadcrumb={
        task?.parent_id ? (
          <ol className="flex min-w-0 items-center gap-1.5">
            <li className="min-w-0 truncate">
              {parent ? (
                <button
                  type="button"
                  onClick={() => setOpened({ from: taskId, id: parent.id })}
                  className="max-w-full truncate hover:text-banner-ink hover:underline"
                >
                  {parent.title}
                </button>
              ) : (
                'Another task'
              )}
            </li>
            <li aria-hidden="true">
              <Icon name="chevronRight" size={13} />
            </li>
            <li aria-current="page" className="shrink-0">Subtask</li>
          </ol>
        ) : undefined
      }
      description={
        task ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <BugBadge kind={task.kind} onBanner />
            {stageName(state.project?.stages, task)}
            {!state.project?.class_board_id && <>
              <span aria-hidden="true">·</span>
              {task.routing_state === 'planning' ? 'Planning route' : task.routing_state === 'coordinator_review' ? 'Coordinator review' : 'Released to team'}
            </>}
          </span>
        ) : undefined
      }
      size="xl"
      headerTone="banner"
      headerActions={canDelete && <ActionMenu
        label="Task actions"
        triggerClassName="grid h-9 w-9 place-items-center rounded-full bg-banner-ink/10 text-banner-ink hover:bg-banner-ink/20"
        items={[{ label: 'Archive task', icon: 'archive', tone: 'danger', onSelect: () => setDeleting(true) }]}
      />}
      footer={task && (canEdit || canEditSchedule) && <>
        <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
        <Button type="submit" form={formId} loading={saving}>Save changes</Button>
      </>}
    >
      {task && <TaskBody key={task.id} state={state} taskId={task.id} title={title} canEdit={canEdit} canEditSchedule={canEditSchedule} formId={formId!} saving={saving} setSaving={setSaving} onOpenTask={(id) => setOpened({ from: taskId, id })} />}
    </Modal>
    <ConfirmDialog
      open={deleting && Boolean(task)}
      onClose={() => setDeleting(false)}
      onConfirm={async () => {
        if (!task) return
        await deleteTask(task.id)
        show('Task archived')
        close()
        await state.reload()
      }}
      title={`Archive ${task?.title ?? 'task'}?`}
      body="It leaves the active task board, but comments, files, time and history stay recoverable in the project archive."
      confirmLabel="Archive task"
      tone="primary"
    />
    </>
  )
}

function TaskBody({
  state,
  taskId,
  title,
  canEdit,
  canEditSchedule,
  formId,
  saving,
  setSaving,
  onOpenTask,
}: {
  state: GeneralProjectState
  taskId: string
  title: string
  canEdit: boolean
  canEditSchedule: boolean
  formId: string
  saving: boolean
  setSaving: (saving: boolean) => void
  onOpenTask: (id: string) => void
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  // A task's project is the one on screen, so its Files are the project's.
  const projectId = state.project?.id
  const loadRepoTree = useCallback(async () => (projectId ? repoTree(projectId) : []), [projectId])
  const [comments, setComments] = useState<GeneralComment[]>([])
  const [files, setFiles] = useState<GeneralFile[]>([])
  const [logs, setLogs] = useState<GeneralLog[]>([])
  const [events, setEvents] = useState<GeneralTaskEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<'comments' | 'history' | 'time'>('comments')
  const [attachmentsOpen, setAttachmentsOpen] = useState(true)

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
  const readOnly = state.readOnly
  const work = !state.project.class_board_id
  const viewer: TaskViewer = { viewerId: me, manageTasks: canManage, archived: readOnly, leadsUser: state.leadsUser,
    role: work ? state.myRole : null,
    holds: (id) => Boolean(me && state.tasks.some((t) => t.id === id && t.assignee_ids.includes(me))) }
  const assignmentViewer: TaskViewer = { ...viewer, manageTasks: work ? state.myRole === 'pm' || state.myRole === 'coordinator' : canManage,
    ...(work ? { workAssignment: { ledTeamIds: state.teams.filter(t => t.leader_id === me).map(t => t.id), members: state.teamMembers } } : {}) }
  const unsent = !state.project.class_board_id && (task.routing_state ?? 'released') !== 'released'
  const assignable = unsent ? [] : assignableTo(
    assignmentViewer,
    task,
    state.members.filter((m) => work ? m.profile?.status === 'active' : m.profile?.status !== 'rejected').map((m) => m.user_id),
    state.roleOf,
  )
  // QA and the project manager pass or send back a task that is waiting in QA,
  // on a project that has active QA (without it the QA stage is ordinary).
  const waitingForQa =
    !readOnly &&
    state.project.has_qa &&
    (state.myRole === 'qa' || state.myRole === 'pm') &&
    inQa(task, stagesOf(state.project.stages), state.project.qa_stage)
  const canAttach = !readOnly && (holds || state.can('edit_files'))
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

  const people = (
    <section>
      <h3 className="text-[14px]">People</h3>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {task.assignee_ids.map((id) => (
          <li
            key={id}
            className="flex items-center gap-1 rounded-full surface-sunken py-0.5 pr-1 pl-2.5 text-[12px] text-ink"
          >
            {state.nameOf(id)}
            <PersonBadge userId={id} roles={state} />
            {canUnassign(viewer, id) && (
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
      {!unsent && assignable.length > 0 && (
        <div className="mt-2 max-w-[16rem]">
          <Select
            aria-label="Assign someone"
            value=""
            onChange={(e) => {
              const userId = e.target.value
              if (userId) void act(() => assignTask(task.id, task.project_id, userId), 'Assigned', 'Could not assign that.')
            }}
            placeholder={assignmentViewer.manageTasks ? 'Assign someone...' : work ? 'Assign a receiving-team member...' : 'Assign someone you lead...'}
            options={assignable.map((id) => ({ value: id, label: state.nameOf(id) }))}
            className="!h-9 !text-[13px]"
          />
        </div>
      )}
      {!work && !unsent && !readOnly && !canManage && task.assignee_ids.length === 0 && me && state.myRole !== 'qa' && (
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
  )

  return (
    <div className="space-y-5">
      {!state.project.class_board_id && (task.reviewer_id || events.some(e => e.kind === 'returned')) && <div className="surface-sunken space-y-1 rounded-xl p-3 text-[13px]">
        {task.reviewer_id && <p className="text-muted">Reviewer: {state.nameOf(task.reviewer_id)}</p>}
        {events.filter(e => e.kind === 'returned').slice(0, 1).map(e => <p key={e.id} className="text-muted">Return reason: {e.detail.reason}</p>)}
      </div>}
      {waitingForQa && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line surface-sunken px-4 py-3">
          <p className="text-[13px] text-ink">This task is waiting for QA.</p>
          <QaActions taskId={task.id} title={task.title} onDone={() => Promise.all([state.reload(), load()]).then(() => {})} />
        </section>
      )}
      <TaskDetails
        state={state}
        taskId={task.id}
        title={title}
        canEdit={canEdit}
        canEditSchedule={canEditSchedule}
        formId={formId}
        saving={saving}
        setSaving={setSaving}
        onSaved={load}
        people={people}
      >
        <TaskSubtasks state={state} task={task} busy={busy} act={act} onOpenTask={onOpenTask} />
        <TaskDependencies state={state} task={task} busy={busy} act={act} />

        <section>
          <div className="flex items-center justify-between gap-2">
            <button type="button" aria-expanded={attachmentsOpen} onClick={() => setAttachmentsOpen((open) => !open)} className="flex min-w-0 items-center gap-2 text-left">
              <Icon name={attachmentsOpen ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
              <h3 className="text-[14px]">Attachments</h3>
              {files.length > 0 && <span className="rounded bg-[var(--surface-sunken)] px-2 text-[12px] text-muted">{files.length}</span>}
            </button>
            {!canAttach && !readOnly && <RequestAccessButton state={state} permission="edit_files" />}
          </div>
          {attachmentsOpen && <>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {files.map((file) => <TaskAttachmentCard
                key={file.id}
                file={file}
                canTrash={!readOnly && (file.uploaded_by === me || state.can('edit_files')) && !busy}
                onTrash={() => void act(() => trashTaskFile(file.id), 'File moved to Trash. It stays there for 30 days.', 'Could not move it to Trash.')}
                onError={(message) => show(message, 'error')}
              />)}
              {loaded && files.length === 0 && <p className="text-[13px] text-faint">No attachments.</p>}
            </div>
            {canAttach && <div className="mt-2 flex flex-wrap items-start gap-2">
              <FilePicker
                onPick={(file) =>
                  act(() => uploadTaskFile(task.project_id, task.id, file), 'File added', 'Could not upload that file.')
                }
              />
              <ProjectFilePicker
                loadTree={loadRepoTree}
                onPick={(picked, fromFolder) =>
                  act(
                    async () => {
                      const result = await attachFromRepo(
                        picked,
                        fromFolder,
                        (file) => uploadTaskFile(task.project_id, task.id, file),
                        GENERAL_FILE_LIMIT,
                      )
                      const summary = attachSummary(result)
                      show(summary.message, summary.tone)
                    },
                    '',
                    'Could not attach those files. Try again.',
                  )
                }
              />
            </div>}
          </>}
        </section>

        <section>
          <div role="group" className="flex gap-1 border-b border-line" aria-label="Task activity">
            {(['comments', 'history', 'time'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activity === tab}
                onClick={() => setActivity(tab)}
                className={`border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${activity === tab ? 'border-navy-600 text-ink dark:border-navy-300' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {activity === 'comments' && <div className="pt-3">
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-xl surface-sunken px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-ink">
                      {c.author_id ? state.nameOf(c.author_id) : 'A former member'}
                      {c.author_id && <PersonBadge userId={c.author_id} roles={state} />}
                      <span className="font-normal text-faint">{formatDue(c.created_at)}</span>
                    </p>
                    {(c.author_id === me || canManage) && !readOnly && (
                      <button
                        type="button"
                        aria-label="Remove comment"
                        disabled={busy}
                        onClick={() => void act(() => deleteComment(c.id), 'Comment removed', 'Could not remove it.')}
                        className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-destructive-600 dark:hover:text-destructive-400"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-ink"><Linkify text={c.body} /></p>
                </li>
              ))}
              {loaded && comments.length === 0 && <p className="text-[13px] text-faint">No comments yet.</p>}
            </ul>
            {!readOnly && (
              <CommentForm
                onSend={(body) =>
                  act(() => addComment(task.id, task.project_id, body), '', 'Could not post that comment.')
                }
              />
            )}
          </div>}
          {activity === 'time' && <div className="pt-3">
            <p className="font-mono text-[12px] text-faint">Total: {formatMinutes(task.logged_minutes ?? 0)}</p>
            <ul className="mt-2 space-y-1.5">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-[13px]">
                  <span className="w-14 shrink-0 font-mono text-ink">{formatMinutes(l.minutes)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {state.nameOf(l.user_id)}
                    {l.note ? ` · ${l.note}` : ''}
                  </span>
                  {l.user_id === me && !readOnly && (
                    <button
                      type="button"
                      aria-label="Remove time entry"
                      disabled={busy}
                      onClick={() => void act(() => deleteLog(l.id), 'Entry removed', 'Could not remove that entry.')}
                      className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-destructive-600 dark:hover:text-destructive-400"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </li>
              ))}
              {loaded && logs.length === 0 && <li className="text-[13px] text-faint">No time logged yet.</li>}
            </ul>
            {holds && !readOnly && (
              <LogForm
                onLog={(minutes, note) =>
                  act(() => addLog(task.id, task.project_id, minutes, note), 'Time logged', 'Could not log that time.')
                }
              />
            )}
          </div>}
          {activity === 'history' && <ul className="divide-y divide-[var(--line)] pt-1">
            {describeHistory(events, state.nameOf).map(({ event: e, text }) => (
              <li key={e.id} className="py-3 text-[13px] leading-snug text-ink">
                <p>{text}</p>
                {(['sent_to_coordinator', 'sent_to_team', 'rerouted', 'returned'].includes(e.kind)) && (() => {
                  const detail = e.detail as typeof e.detail & { old_team_id?: string | null; new_team_id?: string | null; former_holder_ids?: string[]; reviewer_id?: string | null }
                  const teamName = (id: string | null | undefined) => state.teams.find(t => t.id === id)?.name ?? (id ? 'Former team' : 'No team')
                  return <p className="mt-1 text-[12px] text-muted">{teamName(detail.old_team_id)} to {teamName(detail.new_team_id)}{detail.reviewer_id ? ` · Reviewer: ${state.nameOf(detail.reviewer_id)}` : ''}{detail.former_holder_ids?.length ? ` · Former holders: ${detail.former_holder_ids.map(state.nameOf).join(', ')}` : ''}</p>
                })()}
                <time dateTime={e.created_at} className="mt-1 block text-[11px] text-faint">{formatDue(e.created_at)}</time>
              </li>
            ))}
            {loaded && events.length === 0 && <li className="text-[12px] text-faint">Nothing yet.</li>}
          </ul>}
        </section>
      </TaskDetails>
    </div>
  )
}

function TaskDetails({
  state,
  taskId,
  title,
  canEdit,
  canEditSchedule,
  formId,
  saving,
  setSaving,
  onSaved,
  people,
  children,
}: {
  state: GeneralProjectState
  taskId: string
  title: string
  canEdit: boolean
  canEditSchedule: boolean
  formId: string
  saving: boolean
  setSaving: (saving: boolean) => void
  onSaved: () => Promise<void>
  people: ReactNode
  children: ReactNode
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  const [description, setDescription] = useState('')
  // The task's stage, as an index into the project's stages.
  const [stage, setStage] = useState(0)
  const stages = stagesOf(state.project?.stages)
  const [due, setDue] = useState('')
  const [starts, setStarts] = useState('')
  const [team, setTeam] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [error, setError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const updatedAt = task?.updated_at
  useEffect(() => {
    if (!task) return
    setDescription(task.description)
    setStage(stageIndex(task.status, task.stage, stagesOf(state.project?.stages).length))
    setDue(toLocalInput(task.due_at))
    setStarts(toLocalInput(task.starts_at))
    setTeam(task.team_id ?? '')
    setPriority(task.priority ?? 'normal')
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!task || !state.project) return null

  const current = stageIndex(task.status, task.stage, stages.length)
  const gatedStages = stages.some((_, i) => i !== current && state.qaBlocks(current, i))
  // Priority is for work projects; a task that waits for an open task can't take the last stage.
  const work = !state.project.class_board_id
  const waiting = blockersOf(state.dependencies ?? [], state.tasks, task.id).length > 0
  const mobileDetails = (
    <button
      type="button"
      aria-expanded={detailsOpen}
      aria-controls={`task-properties-${task.id}`}
      onClick={() => setDetailsOpen((open) => !open)}
      className="flex w-full items-center justify-between gap-3 text-left lg:hidden"
    >
      <span className="font-semibold text-ink">Details</span>
      <span className="ml-auto truncate text-[12px] text-muted">{stageName(stages, task)}</span>
      <Icon name={detailsOpen ? 'chevronDown' : 'chevronRight'} size={16} className="shrink-0 text-faint" />
    </button>
  )

  if (!canEdit && !canEditSchedule) {
    const teamName = state.teams.find((t) => t.id === task.team_id)?.name
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="order-2 min-w-0 space-y-6 lg:order-1">
          <TaskDescription value={task.description} disabled />
          {children}
        </div>
        <aside className="order-1 min-w-0 lg:order-2">
          <div className="rounded-xl border border-line surface-sunken p-4">
            {mobileDetails}
            <div id={`task-properties-${task.id}`} className={detailsOpen ? 'block' : 'hidden lg:block'}>
              <h3 className="hidden lg:block">Details</h3>
              <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-1">
              <div><dt className="text-[12px] text-faint">Stage</dt><dd className="text-ink">{stageName(stages, task)}</dd></div>
              {work && <div><dt className="text-[12px] text-faint">Priority</dt><dd className="text-ink">{PRIORITIES.find((p) => p.value === (task.priority ?? 'normal'))?.label}</dd></div>}
              <div><dt className="text-[12px] text-faint">Starts</dt><dd className="text-ink">{task.starts_at ? formatDue(task.starts_at) : 'Not set'}</dd></div>
              <div>
                <dt className="text-[12px] text-faint">Due</dt>
                <dd className={task.due_at && isOverdue(task.due_at, task.status) ? 'text-danger-600 dark:text-danger-400' : 'text-ink'}>
                  {task.due_at ? formatDue(task.due_at) : 'Not set'}
                </dd>
              </div>
              <div><dt className="text-[12px] text-faint">Team</dt><dd className="text-ink">{teamName ?? 'Whole project'}</dd></div>
              <div><dt className="text-[12px] text-faint">Time logged</dt><dd className="text-ink">{formatMinutes(task.logged_minutes ?? 0)}</dd></div>
              </dl>
              {!state.readOnly && (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                {state.project.class_board_id ? 'Take this task or ask to manage tasks to change it.' : 'Ask a planner or your team lead to assign this work.'}
                <RequestAccessButton state={state} permission="manage_tasks" />
              </p>
              )}
              <div className="mt-5 border-t border-line pt-4">{people}</div>
            </div>
          </div>
        </aside>
      </div>
    )
  }

  async function save() {
    if (!task || saving) return
    setError(null)
    if (canEdit && !title.trim()) return setError('A task needs a title.')
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (canEditSchedule && startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
    setSaving(true)
    try {
      await updateTask(task.id, {
        ...(canEdit ? { title: title.trim(), status: statusForStage(stage, stages.length) as GeneralTaskStatus, stage, team_id: team || null } : {}),
        ...(canEdit && work && priority !== (task.priority ?? 'normal') ? { priority } : {}),
        ...(canEditSchedule ? { description, due_at: dueAt, starts_at: startsAt } : {}),
      })
      show('Task saved')
      await Promise.all([state.reload(), onSaved()])
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the task.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="order-2 min-w-0 space-y-6 lg:order-1">
        {error && <Alert tone="error">{error}</Alert>}
        <form id={formId} onSubmit={(e) => { e.preventDefault(); void save() }}>
          <TaskDescription value={description} disabled={!canEditSchedule} onChange={setDescription} />
        </form>
        {children}
      </div>
      <aside className="order-1 min-w-0 lg:order-2">
        <div className="rounded-xl border border-line surface-sunken p-4">
          {mobileDetails}
          <div id={`task-properties-${task.id}`} className={detailsOpen ? 'block' : 'hidden lg:block'}>
            <h3 className="hidden lg:block">Details</h3>
            <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
              <Field label="Stage" hint={gatedStages ? <span className="text-[12px] text-faint">{QA_PASSES}</span> : undefined}>
                {(id) => (
                  <Select
                    id={id}
                    disabled={!canEdit}
                    value={String(stage)}
                    onChange={(e) => setStage(Number(e.target.value))}
                    options={stages
                      .map((name, i) => ({ value: String(i), label: name, disabled: waiting && i === stages.length - 1 && i !== current }))
                      // The stage the task is on stays; the ones the QA gate refuses are not offered.
                      .filter((_, i) => i === current || !state.qaBlocks(current, i))}
                  />
                )}
              </Field>
              {work && (
                <Field label="Priority">
                  {(id) => (
                    <Select
                      id={id}
                      disabled={!canEdit}
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as TaskPriority)}
                      options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
                    />
                  )}
                </Field>
              )}
            </div>
            <Field label="Starts" optional>
              {(id) => (
                <Input id={id} type="datetime-local" value={starts} disabled={!canEditSchedule} onChange={(e) => setStarts(e.target.value)} />
              )}
            </Field>
            <Field label="Due" optional>
              {(id) => <Input id={id} type="datetime-local" value={due} disabled={!canEditSchedule} onChange={(e) => setDue(e.target.value)} />}
            </Field>
            <Field label="Team" optional>
              {(id) => (
                <>
                  <Select
                    id={id}
                    value={team}
                    disabled={!canEdit || (!state.project?.class_board_id && (task.routing_state ?? 'released') === 'released')}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="Whole project"
                    options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                  />
                  {!state.project?.class_board_id && (task.routing_state ?? 'released') === 'released' &&
                    <p className="mt-2 text-[12px] leading-snug text-faint">Use Reroute released work in Tasks to change teams.</p>}
                </>
              )}
            </Field>
            </div>
            <p className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[13px]">
            <span className="text-muted">Time logged</span>
            <span className="font-mono text-ink">{formatMinutes(task.logged_minutes ?? 0)}</span>
            </p>
            <div className="mt-5 border-t border-line pt-4">{people}</div>
          </div>
        </div>
      </aside>
    </div>
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
        className="!resize-none"
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
      <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
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
      {error && <p className="text-[12px] text-danger-600 sm:col-span-3 dark:text-danger-400">{error}</p>}
    </form>
  )
}
