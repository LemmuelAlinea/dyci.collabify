import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { dueSoonLabel, taskStatusLabel } from '../../lib/types'
import type { MyTask } from '../../lib/api/tasks'

/** What the student has taken on and not finished, soonest first. */
export function TaskDigest({ tasks, limit = 5 }: { tasks: MyTask[]; limit?: number }) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        Nothing on your plate. Open a project and claim something your group needs.
      </p>
    )
  }

  const shown = [...tasks]
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, limit)

  return (
    <ul className="space-y-2">
      {shown.map((t) => {
        const label = dueSoonLabel(t.due_at)
        const late = label === 'Overdue'
        return (
          <li key={t.id}>
            <Link
              to={`/student/projects/${t.project_id}`}
              className="surface flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-line px-3 py-2.5 shadow-card transition-colors hover:border-line-strong sm:gap-x-3 sm:gap-y-1.5 sm:px-4 sm:py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink sm:text-[14px]">
                  {t.title}
                </span>
                <span className="block truncate text-[12px] text-muted">
                  {t.project_title} · {t.class_initial}
                  {t.group_name ? ` · ${t.group_name}` : ''}
                </span>
              </span>

              <span
                className={`shrink-0 rounded-lg px-2 py-0.5 font-mono text-[12px] ${
                  t.status === 'in_progress'
                    ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                    : 'surface-sunken text-muted'
                }`}
              >
                {taskStatusLabel(t.status)}
              </span>

              {label && (
                <span
                  className={`flex shrink-0 items-center gap-1 font-mono text-[12px] ${
                    late ? 'text-red-600 dark:text-red-400' : 'text-faint'
                  }`}
                >
                  <Icon name="clock" size={12} />
                  {label}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
