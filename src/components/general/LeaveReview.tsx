import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { assignTask, setTaskHolders, unassignTask, updateTask } from '../../lib/api/general'
import { projectLeaves, startCover, type LeaveTask, type ProjectLeave } from '../../lib/api/workload'
import { authErrorMessage } from '../../lib/authError'
import { holderCandidates } from '../../lib/general/permissions'
import { formatDayLabel, formatDayRange, formatHours } from '../../lib/work/hours'
import { moveDueDate } from '../../lib/work/leave'
import { useHolderHours } from '../../lib/work/useHolderHours'
import type { GeneralProjectState } from './useGeneralProject'

const flagged = (l: ProjectLeave) => l.tasks.filter((t) => t.status !== 'fine').length

function StatusChip({ task }: { task: LeaveTask }) {
  const chip = 'rounded-md px-1.5 py-0.5 text-[12px]'
  const warn = `${chip} bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300`
  return (
    <span className="flex flex-wrap gap-1">
      {task.status === 'due_during' && <span className={warn}>Due during leave</span>}
      {task.status === 'blocks' && <span className={warn}>Blocks {task.blocks[0] ?? 'other work'}</span>}
      {task.status === 'wont_fit' && (
        <span className={`${chip} bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300`}>
          Won&apos;t fit · {formatHours(task.short_minutes)} short
        </span>
      )}
      {task.status === 'fine' && <span className={`${chip} text-muted`}>Fine</span>}
      {task.no_estimate && <span className={`${chip} bg-pending-soft text-pending-ink`}>No estimate</span>}
    </span>
  )
}

/**
 * Leave on a project, for its project manager and coordinators: a banner per
 * leave with tasks to look at, and the review (also opened by `?leave=open`)
 * where each task can get a new due date, a new holder or a cover.
 */
export function ProjectLeaves({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [params, setParams] = useSearchParams()
  const project = state.project
  const planner = Boolean(project && !project.class_board_id && !state.readOnly
    && (state.myRole === 'pm' || state.myRole === 'coordinator'))
  const [leaves, setLeaves] = useState<ProjectLeave[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [person, setPerson] = useState<Map<string, string>>(new Map())
  const [day, setDay] = useState<Map<string, string>>(new Map())
  const [rowError, setRowError] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!planner || !project) return
    try {
      setLeaves(await projectLeaves(project.id))
    } catch {
      setLeaves([])
    }
  }, [planner, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load()
  }, [load])

  const open = params.get('leave') === 'open'
  const candidates = planner ? holderCandidates(state.members, state.roleOf) : []
  const hours = useHolderHours({
    spaceId: open ? (project as { space_id?: string | null } | null)?.space_id : null,
    userIds: candidates,
    taskId: null,
    viewer: open ? 'planner' : 'none',
  })

  if (!planner || leaves.length === 0) return null

  function close() {
    const next = new URLSearchParams(params)
    next.delete('leave')
    setParams(next, { replace: true })
  }
  function openReview() {
    const next = new URLSearchParams(params)
    next.set('leave', 'open')
    setParams(next)
  }

  async function act(leave: ProjectLeave, task: LeaveTask, kind: 'move' | 'cover' | 'reassign') {
    const key = `${leave.notice_id}:${task.task_id}`
    setRowError((m) => { const n = new Map(m); n.delete(key); return n })
    const who = person.get(key)
    const live = state.tasks.find((t) => t.id === task.task_id)
    if (kind === 'move' && !day.get(key)) {
      setRowError((m) => new Map(m).set(key, 'Pick the new due date.'))
      return
    }
    if (kind !== 'move' && !who) {
      setRowError((m) => new Map(m).set(key, 'Pick someone first.'))
      return
    }
    setBusy(key)
    try {
      if (kind === 'move') {
        await updateTask(task.task_id, { due_at: moveDueDate(live?.due_at ?? null, day.get(key)!) })
        show('Due date moved')
      } else if (kind === 'cover') {
        await startCover(task.task_id, leave.user_id, who!)
        show(`${state.nameOf(who!)} covers until ${formatDayLabel(leave.last_day)}`)
      } else if (project?.taskFlow === 'open') {
        const holders = (live?.assignee_ids ?? []).filter((id) => id !== leave.user_id)
        await setTaskHolders(task.task_id, [...holders, who!])
        show('Reassigned')
      } else {
        await unassignTask(task.task_id, leave.user_id)
        await assignTask(task.task_id, project!.id, who!)
        show('Reassigned')
      }
      await Promise.all([load(), state.reload()])
    } catch (err) {
      setRowError((m) => new Map(m).set(key, authErrorMessage(err, 'That change could not be saved. Try again.')))
    } finally {
      setBusy(null)
    }
  }

  const banners = leaves.filter((l) => flagged(l) > 0)

  return (
    <>
      {banners.map((l) => (
        <div key={l.notice_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-[14px] dark:border-warning-400/40 dark:bg-warning-500/10">
          <p className="flex min-w-0 items-center gap-2 text-ink">
            <Icon name="calendar" size={16} className="shrink-0 text-warning-700 dark:text-warning-300" />
            <span>
              {state.nameOf(l.user_id)} is away {formatDayRange(l.first_day, l.last_day)} · {flagged(l)}{' '}
              {flagged(l) === 1 ? 'task needs' : 'tasks need'} a look
            </span>
          </p>
          <Button size="sm" variant="outline" onClick={openReview}>Review</Button>
        </div>
      ))}
      <Modal open={open} onClose={close} title="Leave on this project" size="lg"
        description="Choose what happens to each task. Nothing changes until you apply it.">
        <div className="space-y-6">
          {leaves.map((l) => (
            <section key={l.notice_id} className="space-y-3">
              <header>
                <h3 className="text-[15px] font-semibold text-ink">
                  {state.nameOf(l.user_id)} is away {l.first_day === l.last_day
                    ? formatDayLabel(l.first_day)
                    : `${formatDayLabel(l.first_day)} – ${formatDayLabel(l.last_day)}`}
                </h3>
                {l.added_by && <p className="text-[12px] text-muted">Added by {state.nameOf(l.added_by)}</p>}
              </header>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {l.tasks.map((t) => {
                  const key = `${l.notice_id}:${t.task_id}`
                  const live = state.tasks.find((x) => x.id === t.task_id)
                  const options = candidates.filter((id) => id !== l.user_id && !(live?.assignee_ids ?? []).includes(id))
                  const done = skipped.has(key)
                  return (
                    <li key={t.task_id} data-leave-task={t.title} className="space-y-2 px-4 py-3 text-[13px]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">{t.title}</span>
                        <StatusChip task={t} />
                      </div>
                      <p className="font-mono text-[12px] text-muted">
                        {t.due_on ? `Due ${formatDayRange(t.due_on, t.due_on)}` : 'No due date'}
                        {!t.no_estimate && ` · ${formatHours(t.remaining_minutes)} left`}
                      </p>
                      {done ? (
                        <p className="text-[12px] text-faint">Skipped</p>
                      ) : t.status !== 'fine' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input type="date" aria-label={`New due date for ${t.title}`} className="w-40"
                            value={day.get(key) ?? ''} onChange={(e) => setDay((m) => new Map(m).set(key, e.target.value))} />
                          <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void act(l, t, 'move')}>Move due date</Button>
                          <select
                            aria-label={`Person for ${t.title}`}
                            value={person.get(key) ?? ''}
                            onChange={(e) => setPerson((m) => new Map(m).set(key, e.target.value))}
                            className="h-9 rounded-lg border border-line-strong bg-[var(--surface)] px-2 text-[13px] text-ink"
                          >
                            <option value="">Choose someone…</option>
                            {options.map((id) => (
                              <option key={id} value={id}>
                                {state.nameOf(id)}{hours.get(id) ? ` · ${hours.get(id)!.text}` : ''}
                              </option>
                            ))}
                          </select>
                          <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void act(l, t, 'cover')}>Cover</Button>
                          <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void act(l, t, 'reassign')}>Reassign</Button>
                          <Button size="sm" variant="ghost" onClick={() => setSkipped((s) => new Set(s).add(key))}>Skip</Button>
                        </div>
                      )}
                      {rowError.get(key) && <p role="alert" className="text-[12px] text-danger-600 dark:text-danger-400">{rowError.get(key)}</p>}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
