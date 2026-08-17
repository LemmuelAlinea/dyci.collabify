import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Icon'
import { listTaskEvents } from '../../lib/api/tasks'
import type { ProjectTask, TaskEvent, TaskEventKind } from '../../lib/types'

const WORDING: Record<TaskEventKind, string> = {
  created: 'created it',
  edited: 'edited it',
  claimed: 'claimed it',
  unclaimed: 'handed it back',
  assigned: 'gave it to someone',
  started: 'started it',
  finished: 'marked it done',
  reopened: 'reopened it',
}

/** Nobody approves a task, so the trail is what makes the number reviewable. */
export function TaskTrail({ task, onClose }: { task: ProjectTask | null; onClose: () => void }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null)

  useEffect(() => {
    if (!task) return
    setEvents(null)
    void listTaskEvents(task.id)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [task])

  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      title={task?.title ?? ''}
      description="Everything that happened to this task, and who did it."
      size="sm"
    >
      {events === null ? (
        <div className="flex items-center gap-2.5 py-6 text-[13.5px] text-muted">
          <Spinner size={15} />
          Loading…
        </div>
      ) : events.length === 0 ? (
        <p className="py-4 text-[13.5px] text-muted">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3">
              <p className="text-[13.5px] text-ink">
                <span className="font-medium">
                  {e.actor ? `${e.actor.first_name} ${e.actor.last_name}` : 'Someone'}
                </span>{' '}
                <span className="text-muted">{WORDING[e.kind]}</span>
              </p>
              <p className="shrink-0 font-mono text-[11.5px] text-faint">
                {new Date(e.at).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
