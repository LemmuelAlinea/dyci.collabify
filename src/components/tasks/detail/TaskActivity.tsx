import { useState } from 'react'
import { Avatar } from '../../app/Avatar'
import { Icon } from '../../ui/Icon'
import { CommentList } from './CommentList'
import { WorkLogList } from './WorkLogList'
import type {
  Role,
  TaskComment,
  TaskDetail,
  TaskEvent,
  TaskEventKind,
  WorkLogEntry,
} from '../../../lib/types'

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

type TabId = 'all' | 'comments' | 'history' | 'worklog'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'comments', label: 'Comments' },
  { id: 'history', label: 'History' },
  { id: 'worklog', label: 'Work log' },
]

function stamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** History without the comment noise — the thread has its own tab. */
function HistoryList({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[13.5px] text-muted">Nothing recorded yet.</p>
  }
  return (
    <ol className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-[13.5px] text-ink">
            <span className="font-medium">
              {e.actor ? `${e.actor.first_name} ${e.actor.last_name}` : 'Somebody'}
            </span>{' '}
            <span className="text-muted">{WORDING[e.kind]}</span>
            {e.detail && <span className="text-faint"> · {e.detail}</span>}
          </p>
          <p className="shrink-0 font-mono text-[11.5px] text-faint">{stamp(e.at)}</p>
        </li>
      ))}
    </ol>
  )
}

/** Everything, newest last for comments and newest first for the record. */
function AllList({ comments, events }: { comments: TaskComment[]; events: TaskEvent[] }) {
  const merged = [
    ...comments.map((c) => ({ at: c.created_at, kind: 'comment' as const, comment: c })),
    ...events
      .filter((e) => e.kind !== 'commented')
      .map((e) => ({ at: e.at, kind: 'event' as const, event: e })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  if (merged.length === 0) {
    return <p className="text-[13.5px] text-muted">Nothing has happened here yet.</p>
  }

  return (
    <ol className="space-y-3">
      {merged.map((row) =>
        row.kind === 'comment' ? (
          <li key={row.comment.id} className="flex gap-2.5">
            {row.comment.author ? (
              <Avatar profile={row.comment.author} size={26} />
            ) : (
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full surface-sunken text-faint">
                <Icon name="user" size={13} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-muted">
                <span className="font-medium text-ink">
                  {row.comment.author
                    ? `${row.comment.author.first_name} ${row.comment.author.last_name}`
                    : 'Somebody'}
                </span>{' '}
                commented · <span className="font-mono text-faint">{stamp(row.at)}</span>
              </p>
              <p className="mt-0.5 line-clamp-3 text-[13.5px] leading-relaxed text-ink">
                {row.comment.body}
              </p>
            </div>
          </li>
        ) : (
          <li key={row.event.id} className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-[13.5px] text-muted">
              <span className="font-medium text-ink">
                {row.event.actor
                  ? `${row.event.actor.first_name} ${row.event.actor.last_name}`
                  : 'Somebody'}
              </span>{' '}
              {WORDING[row.event.kind]}
              {row.event.detail && <span className="text-faint"> · {row.event.detail}</span>}
            </p>
            <p className="shrink-0 font-mono text-[11.5px] text-faint">{stamp(row.at)}</p>
          </li>
        ),
      )}
    </ol>
  )
}

export function TaskActivity({
  task,
  comments,
  events,
  worklog,
  viewerId,
  role,
  canPost,
  isAssignee,
  onChanged,
}: {
  task: TaskDetail
  comments: TaskComment[]
  events: TaskEvent[]
  worklog: WorkLogEntry[]
  viewerId: string | undefined
  role: Role
  canPost: boolean
  isAssignee: boolean
  onChanged: () => Promise<void> | void
}) {
  const [tab, setTab] = useState<TabId>('comments')

  return (
    <section className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-[15px] font-semibold text-ink">Activity</h3>
        <div className="flex gap-1 rounded-lg surface-sunken p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${
                tab === t.id
                  ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
              {t.id === 'comments' && comments.length > 0 && (
                <span className="ml-1 font-mono text-[11px] text-faint">
                  {comments.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'comments' && (
        <CommentList
          taskId={task.id}
          comments={comments}
          viewerId={viewerId}
          role={role}
          canPost={canPost}
          onChanged={onChanged}
        />
      )}
      {tab === 'history' && <HistoryList events={events} />}
      {tab === 'all' && <AllList comments={comments} events={events} />}
      {tab === 'worklog' && (
        <WorkLogList
          task={task}
          entries={worklog}
          viewerId={viewerId}
          isAssignee={isAssignee}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}
