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
      className={`group @container surface flex rounded-card border shadow-card transition-colors duration-250 hover:border-line-strong ${
        highlight ? 'border-amber-300 dark:border-amber-400/50' : 'border-line hover:border-line-strong'
      }`}
    >
      {/* The padding lives on this inner box, not on the card itself: an
          element cannot answer its own container query, so the card declares
          the container and everything inside it measures against that. */}
      <div className="flex w-full flex-col p-3.5 @min-[240px]:p-5">
      <div className="flex items-start justify-between gap-2 @min-[240px]:gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 leading-snug @min-[240px]:truncate @min-[240px]:">
            {group.name}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-muted @min-[240px]:mt-1 @min-[240px]:text-[12px]">
            {className}
            {/* The set name repeats down a whole column of these; it is the
                first thing to go when the card is half a screen wide. */}
            <span className="hidden @min-[240px]:inline"> · {group.set_name}</span>
          </p>
        </div>
        <CapacityPill count={group.member_count} limit={group.member_limit} />
      </div>

      <div className="mt-2.5 flex min-h-[26px] items-center @min-[240px]:mt-4 @min-[240px]:min-h-[30px]">
        {members.length === 0 ? (
          <span className="text-[12px] text-faint">No members yet</span>
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

      <div className="mt-2.5 h-1 overflow-hidden rounded-full surface-sunken @min-[240px]:mt-4">
        <div
          className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {work && work.projects > 0 && (
        <div className="mt-2.5 border-t border-line pt-2.5 @min-[240px]:mt-3 @min-[240px]:pt-3">
          {/* One line at any width: on a phone it reads "3 · 14/24", which is
              what the icon and the bar underneath are already labelling. */}
          <p className="flex items-center justify-between gap-2 text-[12px] text-muted @min-[240px]:gap-x-3 @min-[240px]:text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="kanban" size={13} className="shrink-0 text-faint" />
              {work.projects}
              <span className="hidden @min-[240px]:inline">
                {work.projects === 1 ? 'project' : 'projects'}
              </span>
              {work.tasks > 0 && (
                <span className="truncate text-faint">
                  · {work.done}/{work.tasks}
                  <span className="hidden @min-[240px]:inline"> tasks</span>
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
        <p className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-amber-600 @min-[240px]:mt-3 @min-[240px]:text-[12px] dark:text-amber-300">
          <Icon name="check" size={14} strokeWidth={2.6} className="shrink-0" />
          Your group
        </p>
      )}
      </div>
    </Link>
  )
}
