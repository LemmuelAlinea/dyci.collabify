import { Link } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import type { GroupMember, GroupSummary } from '../../lib/types'
import type { GroupWorkSummary } from '../../lib/api/groupWork'

const MAX_FACES = 5

export function CapacityPill({ count, limit }: { count: number; limit: number }) {
  const full = count >= limit
  return (
    <span
      className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[12px] ${
        full
          ? 'bg-navy-50 text-navy-700 dark:bg-navy-500/18 dark:text-navy-100'
          : 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
      }`}
    >
      {count}/{limit}
    </span>
  )
}

export function GroupCard({
  group,
  members,
  className,
  to,
  highlight,
  work,
}: {
  group: GroupSummary
  members: GroupMember[]
  /** The class initial or name, shown in the meta line. */
  className: string
  to: string
  /** Marks the viewer's own group. */
  highlight?: boolean
  /** The projects and tasks this group holds, when the board has loaded them. */
  work?: GroupWorkSummary
}) {
  const faces = members.slice(0, MAX_FACES)
  const overflow = members.length - faces.length
  const pct = Math.min(100, Math.round((group.member_count / group.member_limit) * 100))

  return (
    <Link
      to={to}
      className={`group flex min-h-[238px] rounded-card border bg-[var(--surface)] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong ${
        highlight ? 'border-navy-400 dark:border-navy-300' : 'border-line'
      }`}
    >
      <div className="flex w-full flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-950 text-amber-300">
            <Icon name="users" size={18} />
          </span>
          <div className="min-w-0">
          <h3 className="line-clamp-2 text-[17px] leading-snug transition-colors group-hover:text-navy-600 dark:group-hover:text-amber-300">
            {group.name}
          </h3>
          <p className="mt-1 truncate text-[12px] text-muted">
            {className}
            <span> · {group.set_name}</span>
          </p>
          </div>
        </div>
        <CapacityPill count={group.member_count} limit={group.member_limit} />
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-faint">Members</p>
        {members.length === 0 ? (
          <span className="text-[13px] text-faint">No members yet</span>
        ) : (
          <div className="flex">
            {faces.map((m) => (
              <span key={m.student_id} className="-ml-2 first:ml-0 rounded-full ring-2 ring-[var(--surface)]">
                <Avatar profile={m.profile} size={26} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="-ml-2 grid h-[26px] w-[26px] place-items-center rounded-full surface-sunken text-[12px] font-semibold text-muted ring-2 ring-[var(--surface)]">
                +{overflow}
              </span>
            )}
          </div>
        )}
        </div>
        <p className="text-[12px] text-muted">
          <span className="font-mono font-semibold text-ink">{group.member_count}</span> of{' '}
          {group.member_limit} filled
        </p>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full surface-sunken">
        <div
          className="h-full rounded-full bg-navy-500 transition-[width] duration-300 dark:bg-navy-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {work && work.projects > 0 && (
        <div className="mt-auto border-t border-line pt-4">
          <p className="flex items-center justify-between gap-3 text-[12px] text-muted">
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="kanban" size={13} className="shrink-0 text-faint" />
              {work.projects} {work.projects === 1 ? 'project' : 'projects'}
              {work.tasks > 0 && (
                <span className="truncate text-faint">
                  · {work.done}/{work.tasks} tasks
                </span>
              )}
            </span>
            {work.tasks > 0 && (
              <span className="shrink-0 font-mono text-faint">{work.pct}%</span>
            )}
          </p>
          {work.tasks > 0 && (
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full surface-sunken">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${work.pct}%` }}
              />
            </span>
          )}
        </div>
      )}

      {highlight && (
        <p className="mt-3 flex items-center gap-2 text-[12px] font-medium text-navy-600 dark:text-navy-200">
          <Icon name="check" size={14} strokeWidth={2.6} className="shrink-0" />
          Your group
        </p>
      )}
      </div>
    </Link>
  )
}
