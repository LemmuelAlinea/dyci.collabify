import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { TileEmpty } from './Bento'
import { dueLabelShort } from '../projects/dueLabel'
import { PROJECT_TYPES, projectTypeLabel, weekSpanLabel } from '../../lib/types'
import type { BoardSummary, ProjectSummary } from '../../lib/types'

/**
 * Projects in flight, each with how far the viewer's board has got. Plain
 * blocks two across inside a bento tile, separated by space rather than more
 * borders.
 */
export function ProjectStrip({
  projects,
  boards,
  linkBase,
  limit = 4,
}: {
  projects: ProjectSummary[]
  boards: BoardSummary[]
  linkBase: string
  limit?: number
}) {
  const live = projects
    .filter((p) => !p.archived_at && !p.scheduled)
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, limit)

  if (live.length === 0) return <TileEmpty>No projects are open right now.</TileEmpty>

  return (
    <ul className="-mx-2 grid gap-1 @lg:grid-cols-2">
      {live.map((p) => {
        const board = boards.find((b) => b.project_id === p.id)
        const pct = board ? Number(board.done_pct) : 0
        const meta = PROJECT_TYPES.find((t) => t.value === p.type)
        return (
          <li key={p.id} className="min-w-0">
            <Link
              to={`${linkBase}/${p.id}`}
              className="flex h-full flex-col rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
            >
              <span className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
                  <Icon name={meta?.icon ?? 'folder'} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {p.class_initial} · {projectTypeLabel(p)} · {weekSpanLabel(p)}
                  </span>
                </span>
              </span>

              {board && board.task_count > 0 ? (
                <>
                  <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full surface-sunken">
                    <span
                      className="block h-full rounded-full bg-progress transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-muted">
                    <span className="truncate">
                      {board.done_count} of {board.task_count} tasks · {dueLabelShort(p.due_at)}
                    </span>
                    <span className="shrink-0 font-mono text-faint">{pct}%</span>
                  </span>
                </>
              ) : (
                <span className="mt-2.5 text-[12px] text-warning-700 dark:text-warning-300">
                  No tasks yet. Break it down to get started.
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
