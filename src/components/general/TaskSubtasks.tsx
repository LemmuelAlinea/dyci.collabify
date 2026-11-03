// src/components/general/TaskSubtasks.tsx
import { useState } from 'react'
import { createSubtask } from '../../lib/api/general'
import { DEFAULT_TASK_RULES, subtaskProgress, subtasksOf } from '../../lib/general/taskRules'
import type { GeneralTask } from '../../lib/general/types'
import { stageName } from '../../lib/stages'
import { LIMIT } from '../../lib/limits'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { GeneralProjectState } from './useGeneralProject'

export type TaskAct = (action: () => Promise<void>, done: string, failed: string) => Promise<void>

/**
 * Whether the viewer may add a subtask under this task, as
 * create_general_subtask allows: the project manager or a coordinator, or the
 * team's lead or a holder once the task is released. Never QA, never on a
 * subtask, never on a project that is read-only. A done task is handled apart.
 */
function mayAddSubtask(state: GeneralProjectState, task: GeneralTask): boolean {
  const me = state.viewerId
  const role = state.myRole
  if (!me || state.readOnly || state.project?.class_board_id || task.parent_id) return false
  if (role === 'pm' || role === 'coordinator') return true
  if (!role || role === 'qa' || role === 'stakeholder') return false
  if ((task.routing_state ?? 'released') !== 'released') return false
  const leads =
    state.teams.some((t) => t.id === task.team_id && t.leader_id === me) &&
    state.teamMembers.some((m) => m.team_id === task.team_id && m.user_id === me)
  return leads || task.assignee_ids.includes(me)
}

export function TaskSubtasks({
  state,
  task,
  busy,
  act,
  onOpenTask,
}: {
  state: GeneralProjectState
  task: GeneralTask
  busy: boolean
  act: TaskAct
  onOpenTask: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(true)
  if (!state.project || state.project.class_board_id) return null

  if (task.parent_id) {
    const parent = state.tasks.find((t) => t.id === task.parent_id)
    return (
      <section className="space-y-1 text-[13px]">
        <p className="text-ink">
          Part of{' '}
          {parent ? (
            <button type="button" onClick={() => onOpenTask(parent.id)} className="font-medium hover:underline">
              {parent.title}
            </button>
          ) : (
            'another task'
          )}
        </p>
        <p className="text-muted">Moves with its parent task.</p>
      </section>
    )
  }

  const rules = state.project.taskRules ?? DEFAULT_TASK_RULES
  const subtasks = subtasksOf(state.tasks, task.id)
  const { done, total } = subtaskProgress(state.tasks, task.id)
  const allowed = rules.allowSubtasks && mayAddSubtask(state, task)
  if (!subtasks.length && !allowed) return null

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
        <h3 className="flex-1 text-[14px]">Subtasks</h3>
        {total > 0 && <span className="font-mono text-[12px] text-faint">{done}/{total} done</span>}
      </button>
      {open && (
        <>
          <ul className="mt-2 space-y-1.5">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <button type="button" onClick={() => onOpenTask(s.id)} className="min-w-0 flex-1 truncate text-left text-ink hover:underline">
                  {s.title}
                </button>
                <span className="shrink-0 text-[12px] text-muted">{stageName(state.project?.stages, s)}</span>
                <span className="max-w-[10rem] shrink-0 truncate text-[12px] text-faint">
                  {s.assignee_ids.length ? s.assignee_ids.map(state.nameOf).join(', ') : 'Nobody holds this yet.'}
                </span>
              </li>
            ))}
          </ul>
          {allowed &&
            (task.status === 'done' ? (
              <p className="mt-2 text-[13px] text-muted">Reopen the task before adding a subtask.</p>
            ) : (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const text = title.trim()
                  if (!text) return
                  void act(
                    async () => {
                      await createSubtask(task.id, text)
                      setTitle('')
                    },
                    'Subtask added',
                    'Could not add that subtask.',
                  )
                }}
              >
                <Input
                  aria-label="Add a subtask"
                  placeholder="Add a subtask"
                  maxLength={LIMIT.taskTitle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="!h-9 !text-[13px]"
                />
                <Button type="submit" size="sm" variant="outline" className="!h-9" disabled={busy || !title.trim()}>
                  Add
                </Button>
              </form>
            ))}
        </>
      )}
    </section>
  )
}
