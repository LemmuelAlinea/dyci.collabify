import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { dueLabel, dueLabelShort } from '../projects/ProjectCard'
import { PROJECT_TYPES, projectTypeLabel, weekSpanLabel } from '../../lib/types'
import type { BoardSummary, ProjectSummary } from '../../lib/types'

/** Projects in flight, each with how far the viewer's board has got. */
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

  if (live.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        No projects are open right now.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-3">
      {live.map((p) => {
        const board = boards.find((b) => b.project_id === p.id)
        const pct = board ? Number(board.done_pct) : 0
        const meta = PROJECT_TYPES.find((t) => t.value === p.type)
        return (
          <Link
            key={p.id}
            to={`${linkBase}/${p.id}`}
            className="surface flex flex-col rounded-card border border-line p-3 shadow-card transition-colors duration-250 hover:border-line-strong sm:p-4"
          >
            <div className="flex items-start gap-2 sm:gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg surface-sunken text-muted sm:h-8 sm:w-8">
                <Icon name={meta?.icon ?? 'folder'} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink sm:text-[14px]">
                  {p.title}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {p.class_initial} · {projectTypeLabel(p)} · {weekSpanLabel(p)}
                </span>
              </span>
            </div>

            {board && board.task_count > 0 ? (
              <>
                <div className="mt-3.5 h-1.5 overflow-hidden rounded-full surface-sunken">
                  <span
                    className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
                  <span>
                    {board.done_count} of {board.task_count} tasks
                  </span>
                  <span className="font-mono text-faint">{pct}%</span>
                </p>
              </>
            ) : (
              <p className="mt-3.5 text-[12px] text-amber-700 dark:text-amber-300">
                No tasks yet — break it down to get started.
              </p>
            )}

            {/* Two across on a phone, the full "Due tomorrow · Sep 1, 1:16 AM"
                wraps to a second line on every card. The relative half is the
                part anybody reads at a glance; the date returns with the room
                for it. */}
            <p className="mt-2 flex items-center gap-2 text-[12px] text-faint">
              <Icon name="clock" size={12} className="shrink-0" />
              <span className="truncate sm:hidden">{dueLabelShort(p.due_at)}</span>
              <span className="hidden truncate sm:inline">{dueLabel(p.due_at)}</span>
            </p>
          </Link>
        )
      })}
    </div>
  )
}
