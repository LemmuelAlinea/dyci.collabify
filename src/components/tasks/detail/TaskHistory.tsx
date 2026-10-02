import type { TaskEvent, TaskEventKind } from '../../../lib/types'

const WORDING: Record<TaskEventKind, string> = {
  created: 'created it',
  edited: 'edited it',
  claimed: 'claimed it',
  unclaimed: 'handed it back',
  assigned: 'gave it to someone',
  started: 'started it',
  finished: 'marked it done',
  reopened: 'reopened it',
  commented: 'commented',
  logged: 'logged time',
  file_added: 'attached a file',
  file_removed: 'removed a file',
}

function stamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** What happened to the task, one line each, as the work task dialog shows it. */
export function TaskHistory({ events }: { events: TaskEvent[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="text-[12px] text-muted">
          {e.actor ? `${e.actor.first_name} ${e.actor.last_name}` : 'Somebody'} {WORDING[e.kind]}
          {e.detail && ` · ${e.detail}`}
          <span className="ml-1.5 text-faint">{stamp(e.at)}</span>
        </li>
      ))}
      {events.length === 0 && <li className="text-[12px] text-faint">Nothing yet.</li>}
    </ul>
  )
}
