import { Avatar } from '../app/Avatar'
import { fullName } from '../../lib/types'
import type { MemberProgress as Row } from '../../lib/types'

/**
 * Two numbers, deliberately side by side. The big one is the student's own 100
 * — their individual grade — and the small one is the slice of the group's 100
 * they are carrying. A member can be at 100% personally and still hold a fifth
 * of the project.
 */
export function MemberProgress({
  rows,
  viewerId,
  title = 'Everyone in the group',
  dense = false,
}: {
  rows: Row[]
  viewerId?: string
  title?: string
  /** For the narrow column beside the progress bar. */
  dense?: boolean
}) {
  if (rows.length === 0) return null

  const cap = rows[0].cap_pct

  return (
    <section className="card p-4 sm:p-5 shadow-card">
      <h3 className="">{title}</h3>
      <p className="mt-1 text-[13px] text-muted">
        {dense ? (
          <>
            Their own progress, then their share of the group.
            {cap < 100 && <> Each member carries up to {cap}%.</>}
          </>
        ) : (
          <>
            Their own progress on the left, their share of the group on the right.
            {cap < 100 && (
              <> Each member carries up to {cap}% of the project, so the work splits evenly.</>
            )}
          </>
        )}
      </p>

      <ul className="mt-4 divide-y divide-[var(--line)]">
        {rows.map((r) => {
          const personal = r.personal_pct
          const you = r.student_id === viewerId
          return (
            <li
              key={r.student_id}
              className={`flex items-center gap-3 first:pt-0 ${dense ? 'py-2' : 'py-3'}`}
            >
              {r.profile && <Avatar profile={r.profile} size={dense ? 26 : 34} />}

              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                    {r.profile ? fullName(r.profile) : 'Member'}
                    {you && <span className="ml-1.5 text-[12px] text-faint">you</span>}
                  </span>
                  {dense && (
                    <span className="shrink-0 font-mono text-[13px] text-ink">
                      {personal === null ? '—' : `${personal}%`}
                    </span>
                  )}
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-300 ${
                      personal === null ? 'bg-transparent' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${personal ?? 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[12px] text-faint">
                  {r.task_count === 0
                    ? 'Nothing claimed yet'
                    : `${r.done_count} of ${r.task_count} of their tasks done`}
                  {dense && r.task_count > 0 && (
                    <span className="font-mono">
                      {' · '}
                      {r.group_pct} of {r.held_pct} of the group
                    </span>
                  )}
                  {!r.can_claim && cap < 100 && ' · share is full'}
                </p>
              </div>

              {!dense && (
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[17px] leading-none text-ink">
                    {personal === null ? '—' : `${personal}%`}
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-faint">
                    {r.group_pct} of {r.held_pct}
                    {cap < 100 && <span className="text-faint"> / {cap}</span>}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
