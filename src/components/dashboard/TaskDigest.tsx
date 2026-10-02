import { Link } from 'react-router-dom'
import { TileEmpty } from './Bento'
import { dueSoonLabel, taskStatusLabel } from '../../lib/types'
import { paths } from '../../lib/paths'
import type { MyTask } from '../../lib/api/tasks'

/** What the student has taken on and not finished, soonest first. Flat rows, for a bento tile. */
export function TaskDigest({ tasks, limit = 5 }: { tasks: MyTask[]; limit?: number }) {
  if (tasks.length === 0) {
    return <TileEmpty>Nothing on your plate. Open a project and claim something your group needs.</TileEmpty>
  }

  const shown = [...tasks]
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, limit)

  return (
    <ul className="-mx-2 divide-y divide-[var(--line)]">
      {shown.map((t) => {
        const label = dueSoonLabel(t.due_at)
        const late = label === 'Overdue'
        return (
          <li key={t.id}>
            <Link
              to={paths.classProject(t.project_id)}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{t.title}</span>
                <span className="block truncate text-[12px] text-muted">
                  {t.project_title} · {t.class_initial}
                  {t.group_name ? ` · ${t.group_name}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${
                    t.status === 'in_progress'
                      ? 'bg-warning-400/18 text-warning-700 dark:text-warning-300'
                      : 'surface-sunken text-muted'
                  }`}
                >
                  {taskStatusLabel(t.status)}
                </span>
                {label && (
                  <span
                    className={`font-mono text-[11px] ${
                      late ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
                    }`}
                  >
                    {label}
                  </span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
