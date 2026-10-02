import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { TileEmpty } from './Bento'
import { projectAverage } from '../../lib/api/dashboard'
import { paths } from '../../lib/paths'
import { weekSpanLabel } from '../../lib/types'
import type { BoardSummary, ProjectSummary } from '../../lib/types'

/** Every live project with the average across its groups — who is on pace. */
export function ClassProgress({
  projects,
  boards,
}: {
  projects: ProjectSummary[]
  boards: BoardSummary[]
}) {
  const live = projects
    .filter((p) => !p.archived_at && !p.scheduled)
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))

  if (live.length === 0) return <TileEmpty>Nothing is open across your classes right now.</TileEmpty>

  // Flat blocks that go two or three across as the tile widens.
  return (
    <ul className="-mx-2 grid gap-x-4 gap-y-1 @2xl:grid-cols-2 @5xl:grid-cols-3">
      {live.map((p) => {
        const { pct, groups, started } = projectAverage(boards, p.id)
        return (
          <li key={p.id}>
            <Link
              to={paths.classProject(p.id)}
              className="block rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-[14px] font-medium text-ink sm:text-[14px]">
                  {p.title}
                </p>
                <p className="font-mono text-[12px] text-faint">{pct}%</p>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full surface-sunken">
                <span
                  className="block h-full rounded-full bg-progress transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                <span>
                  {p.class_initial} · {weekSpanLabel(p)}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="users" size={12} />
                  {started} of {groups} {groups === 1 ? 'group' : 'groups'} started
                </span>
              </p>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
