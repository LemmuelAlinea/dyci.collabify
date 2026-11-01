// src/components/general/TaskDependencies.tsx
import { useState } from 'react'
import { addDependency, removeDependency } from '../../lib/api/general'
import { DEFAULT_TASK_RULES, blockersOf } from '../../lib/general/taskRules'
import type { GeneralTask } from '../../lib/general/types'
import { stageName } from '../../lib/stages'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import type { TaskAct } from './TaskSubtasks'
import type { GeneralProjectState } from './useGeneralProject'

const PICKER_LIMIT = 8

/**
 * Whether the viewer may change what this task waits for, as
 * general_task_links_editable allows: the project manager or a coordinator,
 * the team's active lead once released, or a holder.
 */
function mayLink(state: GeneralProjectState, task: GeneralTask): boolean {
  const me = state.viewerId
  const role = state.myRole
  if (!me || state.readOnly || state.project?.class_board_id || !role || role === 'stakeholder' || task.archived_at) return false
  if (role === 'pm' || role === 'coordinator') return true
  if (task.assignee_ids.includes(me)) return true
  return (
    (task.routing_state ?? 'released') === 'released' &&
    state.teams.some((t) => t.id === task.team_id && t.leader_id === me && !t.archived_at) &&
    state.teamMembers.some((m) => m.team_id === task.team_id && m.user_id === me)
  )
}

/** Every task that already waits, directly or through others, for this one; linking to it would close a loop. */
function waitingOnTask(state: GeneralProjectState, id: string): Set<string> {
  const found = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const next = queue.pop()
    for (const d of state.dependencies ?? []) {
      if (d.depends_on_id === next && !found.has(d.task_id)) {
        found.add(d.task_id)
        queue.push(d.task_id)
      }
    }
  }
  return found
}

export function TaskDependencies({
  state,
  task,
  busy,
  act,
}: {
  state: GeneralProjectState
  task: GeneralTask
  busy: boolean
  act: TaskAct
}) {
  const [query, setQuery] = useState('')
  if (!state.project || state.project.class_board_id) return null

  const rules = state.project.taskRules ?? DEFAULT_TASK_RULES
  const byId = new Map(state.tasks.map((t) => [t.id, t]))
  const blockers = (state.dependencies ?? [])
    .filter((d) => d.task_id === task.id)
    .map((d) => byId.get(d.depends_on_id))
    .filter((t): t is GeneralTask => Boolean(t))
  const open = blockersOf(state.dependencies ?? [], state.tasks, task.id).length
  const canLink = mayLink(state, task)
  const canAdd = canLink && rules.allowDependencies
  if (!blockers.length && !canAdd) return null

  const picking = canAdd && task.status !== 'done'
  const excluded = new Set<string>([task.id, ...blockers.map((b) => b.id), ...waitingOnTask(state, task.id)])
  if (task.parent_id) excluded.add(task.parent_id)
  const needle = query.trim().toLowerCase()
  const matches = picking
    ? state.tasks
        .filter((t) => !excluded.has(t.id) && t.parent_id !== task.id && !t.archived_at)
        .filter((t) => !needle || t.title.toLowerCase().includes(needle))
    : []
  const candidates = matches.slice(0, PICKER_LIMIT)

  return (
    <section>
      <h3 className="text-[14px]">Waiting for</h3>
      {open > 0 && task.status !== 'done' && (
        <p className="mt-2 text-[13px] text-warning-700 dark:text-warning-300">
          Waiting for {open} task{open === 1 ? '' : 's'}. It can't be marked done until they are.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {blockers.map((b) => (
          <li key={b.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-ink">{b.title}</span>
            <span className="shrink-0 text-[12px] text-muted">{stageName(state.project?.stages, b)}</span>
            {canLink && (
              <button
                type="button"
                aria-label={`Stop waiting for ${b.title}`}
                disabled={busy}
                onClick={() => void act(() => removeDependency(task.id, b.id), 'Link removed', 'Could not remove that link.')}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint hover:text-ink"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </li>
        ))}
        {!blockers.length && <li className="text-[13px] text-faint">Not waiting for anything.</li>}
      </ul>
      {canAdd && task.status === 'done' && (
        <p className="mt-2 text-[13px] text-muted">Reopen the task before making it wait.</p>
      )}
      {picking && (
        <div className="mt-2 space-y-1.5">
          <Input
            aria-label="Search tasks to wait for"
            placeholder="Search tasks to wait for"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="!h-9 !text-[13px]"
          />
          <ul className="space-y-1">
            {candidates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  data-pick
                  disabled={busy}
                  onClick={() =>
                    void act(
                      async () => {
                        await addDependency(task.id, t.id)
                        setQuery('')
                      },
                      'Now waiting',
                      'Could not add that link.',
                    )
                  }
                  className="w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)]"
                >
                  {t.title}
                </button>
              </li>
            ))}
            {!candidates.length && <li className="px-3 text-[13px] text-faint">No tasks to add.</li>}
          </ul>
          {matches.length > PICKER_LIMIT && <p className="text-[12px] text-muted">Showing 8 of {matches.length} tasks. Type to narrow.</p>}
        </div>
      )}
    </section>
  )
}
