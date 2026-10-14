import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { LeaderBadge } from './LeaderBadge'
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
          : 'bg-warning-400/18 text-warning-700 dark:text-warning-300'
      }`}
    >
      {count}/{limit}
    </span>
  )
}

export type GroupTableRow = {
  group: GroupSummary
  members: GroupMember[]
  to: string
  /** Marks the viewer's own group. */
  mine: boolean
  /** The projects and tasks this group holds, once the board has loaded them. */
  work?: GroupWorkSummary
}

/**
 * One set's groups as a table: who is in each, who leads, how full it is and
 * how far its work has got. A row opens the group.
 *
 * Desktop shows every column. Narrower screens drop Work, then Leader (it moves
 * under the name), then the faces, so a phone never scrolls sideways.
 */
export function GroupTable({ rows, caption }: { rows: GroupTableRow[]; caption: string }) {
  const navigate = useNavigate()

  return (
    <div className="surface overflow-hidden rounded-card border border-line">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="px-4 py-2.5 font-medium">Group</th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">Members</th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell">Leader</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Filled</th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">Work</th>
            <th scope="col" className="w-10 px-2 py-2.5">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ group, members, to, mine, work }) => {
            const leader = members.find((m) => m.student_id === group.leader_id) ?? null
            // The leader's face goes first, so it is never the one hidden behind "+N".
            const ordered = leader ? [leader, ...members.filter((m) => m !== leader)] : members
            const faces = ordered.slice(0, MAX_FACES)
            const overflow = members.length - faces.length
            const pct = Math.min(100, Math.round((group.member_count / group.member_limit) * 100))
            const leaderName = leader ? `${leader.profile.first_name} ${leader.profile.last_name}` : null

            return (
              <tr
                key={group.id}
                onClick={(e) => {
                  // The name is a real link; let it, and any selection, be.
                  if ((e.target as HTMLElement).closest('a') || window.getSelection()?.toString()) return
                  navigate(to)
                }}
                className={`group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)] ${
                  mine ? 'bg-navy-50/60 dark:bg-navy-500/10' : ''
                }`}
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-icon-tile text-icon-glyph">
                      <Icon name="users" size={16} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={to}
                        className="block truncate text-[14px] font-medium text-ink transition-colors group-hover:text-navy-600 dark:group-hover:text-amber-300"
                      >
                        {group.name}
                      </Link>
                      {mine && (
                        <span className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-navy-600 dark:text-navy-200">
                          <Icon name="check" size={12} strokeWidth={2.6} className="shrink-0" />
                          Your group
                        </span>
                      )}
                      {/* Leader has its own column from md up. */}
                      <span className="mt-0.5 block truncate text-[12px] text-muted md:hidden">
                        {leaderName ? `Leader · ${leaderName}` : members.length ? 'No leader yet' : 'No members yet'}
                      </span>
                    </div>
                  </div>
                </th>

                <td className="hidden px-3 py-3 sm:table-cell">
                  {members.length === 0 ? (
                    <span className="text-faint">None yet</span>
                  ) : (
                    <div className="flex">
                      {faces.map((m) => (
                        <span key={m.student_id} className="-ml-2 rounded-full ring-2 ring-[var(--surface)] first:ml-0">
                          <Avatar profile={m.profile} size={24} />
                        </span>
                      ))}
                      {overflow > 0 && (
                        <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full surface-sunken text-[11px] font-semibold text-muted ring-2 ring-[var(--surface)]">
                          +{overflow}
                        </span>
                      )}
                    </div>
                  )}
                </td>

                <td className="hidden px-3 py-3 md:table-cell">
                  {leaderName ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <LeaderBadge className="shrink-0" />
                      <span className="truncate text-muted">{leaderName}</span>
                    </span>
                  ) : (
                    <span className="text-faint">No leader yet</span>
                  )}
                </td>

                <td className="px-3 py-3">
                  <div className="flex w-[88px] flex-col gap-1.5">
                    <CapacityPill count={group.member_count} limit={group.member_limit} />
                    <span className="block h-1 overflow-hidden rounded-full surface-sunken">
                      <span
                        className="block h-full rounded-full bg-navy-500 transition-[width] duration-300 dark:bg-navy-300"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </div>
                </td>

                <td className="hidden px-3 py-3 lg:table-cell">
                  {work && work.projects > 0 ? (
                    <div className="w-[190px]">
                      <p className="flex items-center justify-between gap-3 text-[12px] text-muted">
                        <span className="truncate">
                          {work.projects} {work.projects === 1 ? 'project' : 'projects'}
                          {work.tasks > 0 && <span className="text-faint"> · {work.done}/{work.tasks} tasks</span>}
                        </span>
                        {work.tasks > 0 && <span className="shrink-0 font-mono text-faint">{work.pct}%</span>}
                      </p>
                      {work.tasks > 0 && (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full surface-sunken">
                          <span
                            className="block h-full rounded-full bg-progress transition-[width] duration-300"
                            style={{ width: `${work.pct}%` }}
                          />
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-faint">No projects yet</span>
                  )}
                </td>

                <td className="px-2 py-3 text-right">
                  <Icon name="chevronRight" size={16} className="text-faint transition-colors group-hover:text-ink" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
