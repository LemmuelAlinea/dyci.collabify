import { useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Icon'
import { listEventsForTasks } from '../../lib/api/taskDetail'
import { formatMinutes, fullName, TASK_STATUSES } from '../../lib/types'
import type { TaskEvent, TaskEventKind, TaskStatus } from '../../lib/types'
import type { ProjectTaskRow } from '../../lib/api/tasks'

const DAY = 86_400_000

const WORDING: Record<TaskEventKind, string> = {
  created: 'created',
  edited: 'edited',
  claimed: 'claimed',
  unclaimed: 'handed back',
  assigned: 'assigned',
  started: 'started',
  finished: 'finished',
  reopened: 'reopened',
  commented: 'commented on',
  logged: 'logged time on',
  file_added: 'attached a file to',
  file_removed: 'removed a file from',
}

const RING: Record<TaskStatus, string> = {
  todo: 'var(--line-strong)',
  in_progress: '#F0B429',
  done: '#10b981',
}

function Tile({
  icon,
  value,
  label,
  sub,
  tone = 'neutral',
}: {
  icon: 'checkCircle' | 'edit' | 'plus' | 'calendar' | 'clock'
  value: number
  label: string
  sub: string
  /** Draws attention to a count that is bad news rather than neutral. */
  tone?: 'neutral' | 'warn'
}) {
  return (
    <div className="surface flex items-center gap-3 rounded-card border border-line px-4 py-3.5 shadow-card">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
          tone === 'warn'
            ? 'bg-red-500/15 text-red-700 dark:text-red-300'
            : 'surface-sunken text-muted'
        }`}
      >
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">
          {value} <span className="font-normal text-muted">{label}</span>
        </span>
        <span className="block text-[12px] text-faint">{sub}</span>
      </span>
    </div>
  )
}

/** A donut drawn with one circle and a dash offset per slice. */
function StatusDonut({ counts, total }: { counts: Record<TaskStatus, number>; total: number }) {
  const R = 54
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-sunken)" strokeWidth="16" />
          {TASK_STATUSES.map((s) => {
            const share = total ? counts[s.value] / total : 0
            const dash = share * C
            const el = (
              <circle
                key={s.value}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={RING[s.value]}
                strokeWidth="16"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            )
            offset += dash
            return el
          })}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[22px] leading-none text-ink">{total}</span>
          <span className="mt-1 text-[12px] text-faint">
            {total === 1 ? 'task' : 'tasks'}
          </span>
        </span>
      </div>

      <ul className="space-y-2">
        {TASK_STATUSES.map((s) => (
          <li key={s.value} className="flex items-center gap-2.5 text-[13px]">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: RING[s.value] }}
            />
            <span className="text-muted">{s.label}</span>
            <span className="font-mono text-faint">{counts[s.value]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What the project looks like from above: how much is moving, where it stands,
 * and what changed lately. Reads the same filtered rows as the board and the
 * list, so the three never disagree.
 */
export function TaskSummary({ rows }: { rows: ProjectTaskRow[] }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null)

  const ids = rows.map((r) => r.id).join(',')
  useEffect(() => {
    if (!ids) return setEvents([])
    setEvents(null)
    void listEventsForTasks(ids.split(','), 30)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [ids])

  const now = Date.now()
  const counts: Record<TaskStatus, number> = {
    todo: rows.filter((t) => t.status === 'todo').length,
    in_progress: rows.filter((t) => t.status === 'in_progress').length,
    done: rows.filter((t) => t.status === 'done').length,
  }

  const finishedWeek = rows.filter(
    (t) => t.done_at && now - new Date(t.done_at).getTime() < 7 * DAY,
  ).length
  const updatedWeek = rows.filter(
    (t) => now - new Date(t.updated_at).getTime() < 7 * DAY,
  ).length
  const createdWeek = rows.filter(
    (t) => now - new Date(t.created_at).getTime() < 7 * DAY,
  ).length
  const dueSoon = rows.filter(
    (t) =>
      t.status !== 'done' &&
      t.due_at &&
      new Date(t.due_at).getTime() - now < 7 * DAY &&
      new Date(t.due_at).getTime() > now,
  ).length

  // Stamped at the moment each task was finished, so an extension granted
  // afterwards does not quietly empty this out.
  const handedInLate = rows.filter((t) => t.status === 'done' && t.late).length

  const unclaimed = rows.filter((t) => t.assignees.length === 0 && t.status !== 'done')
  const logged = rows.reduce((n, t) => n + t.logged_minutes, 0)
  const titles = new Map(rows.map((t) => [t.id, t.title]))

  // Who is carrying what, from the same rows — shared tasks split evenly.
  const load = new Map<string, { name: string; avatar: ProjectTaskRow['assignees'][number]['profile']; held: number; done: number }>()
  for (const t of rows) {
    for (const a of t.assignees) {
      if (!a.profile) continue
      const row = load.get(a.student_id) ?? {
        name: fullName(a.profile),
        avatar: a.profile,
        held: 0,
        done: 0,
      }
      row.held += 1
      if (t.status === 'done') row.done += 1
      load.set(a.student_id, row)
    }
  }

  return (
    <div className="space-y-5">
      {/* The late tile only appears once there is something late, so a class
          that is keeping up sees the same four it always did. */}
      <div
        className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${
          handedInLate > 0 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'
        }`}
      >
        <Tile icon="checkCircle" value={finishedWeek} label="finished" sub="in the last 7 days" />
        <Tile icon="edit" value={updatedWeek} label="updated" sub="in the last 7 days" />
        <Tile icon="plus" value={createdWeek} label="created" sub="in the last 7 days" />
        <Tile icon="calendar" value={dueSoon} label="due soon" sub="in the next 7 days" />
        {handedInLate > 0 && (
          <Tile
            icon="clock"
            tone="warn"
            value={handedInLate}
            label="handed in late"
            sub="after the deadline"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card">
          <h3 className="">Where it stands</h3>
          <p className="mt-1 mb-4 text-[13px] text-muted">
            Every task in view, by status.
            {logged > 0 && ` ${formatMinutes(logged)} logged against them.`}
          </p>
          {rows.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing matches those filters.</p>
          ) : (
            <StatusDonut counts={counts} total={rows.length} />
          )}
          {unclaimed.length > 0 && (
            <p className="mt-4 flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
              <Icon name="alert" size={13} />
              {unclaimed.length} {unclaimed.length === 1 ? 'task has' : 'tasks have'} nobody on
              them
            </p>
          )}
        </section>

        <section className="surface flex max-h-[380px] flex-col rounded-card border border-line p-4 sm:p-5 shadow-card">
          <h3 className="">Recent activity</h3>
          <p className="mt-1 mb-3 text-[13px] text-muted">What has moved lately.</p>
          {events === null ? (
            <p className="flex items-center gap-2 py-4 text-[13px] text-muted">
              <Spinner size={14} />
              Loading…
            </p>
          ) : events.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing has happened here yet.</p>
          ) : (
            // Fixed height, scrolled: a long trail should not push the page down.
            <ol className="-mr-2 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-2">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[13px] text-muted">
                    <span className="font-medium text-ink">
                      {e.actor ? `${e.actor.first_name} ${e.actor.last_name}` : 'Somebody'}
                    </span>{' '}
                    {WORDING[e.kind]}{' '}
                    <span className="text-ink">{titles.get(e.task_id) ?? 'a task'}</span>
                  </p>
                  <p className="shrink-0 font-mono text-[12px] text-faint">
                    {new Date(e.at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {load.size > 0 && (
        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card">
          <h3 className="">Who is carrying what</h3>
          <p className="mt-1 mb-3 text-[13px] text-muted">
            Tasks held, and how many of them are finished.
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {[...load.values()]
              .sort((a, b) => b.held - a.held)
              .map((p) => (
                <li key={p.name} className="flex items-center gap-3 py-2.5 first:pt-0">
                  {p.avatar && <Avatar profile={p.avatar} size={28} />}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{p.name}</span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full surface-sunken">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${p.held ? (p.done / p.held) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[12px] text-faint">
                    {p.done}/{p.held}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  )
}
