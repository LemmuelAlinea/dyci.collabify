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
      className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[11.5px] ${
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
      className={`group surface flex flex-col rounded-card border p-4 sm:p-5 shadow-card transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:shadow-lift ${
        highlight ? 'border-amber-300 dark:border-amber-400/50' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] leading-snug">{group.name}</h3>
          <p className="mt-1 truncate text-[12px] text-muted">
            {className} · {group.set_name}
          </p>
        </div>
        <CapacityPill count={group.member_count} limit={group.member_limit} />
      </div>

      <div className="mt-4 flex min-h-[30px] items-center">
        {members.length === 0 ? (
          <span className="text-[12.5px] text-faint">No members yet</span>
        ) : (
          <div className="flex">
            {faces.map((m) => (
              <span key={m.student_id} className="-ml-2 first:ml-0 rounded-full ring-2 ring-[var(--surface)]">
                <Avatar profile={m.profile} size={30} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="-ml-2 grid h-[30px] w-[30px] place-items-center rounded-full surface-sunken text-[11px] font-semibold text-muted ring-2 ring-[var(--surface)]">
                +{overflow}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full surface-sunken">
        <div
          className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {work && work.projects > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <Icon name="kanban" size={13} className="text-faint" />
              {work.projects} {work.projects === 1 ? 'project' : 'projects'}
              {work.tasks > 0 && (
                <span className="text-faint">
                  · {work.done}/{work.tasks} tasks
                </span>
              )}
            </span>
            {work.tasks > 0 && <span className="font-mono text-faint">{work.pct}%</span>}
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
        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-300">
          <Icon name="check" size={14} strokeWidth={2.6} />
          Your group
        </p>
      )}
    </Link>
  )
}
