import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { PROJECT_TYPES, projectTypeLabel, weekSpanLabel } from '../../lib/types'
import type { ProjectSummary } from '../../lib/types'

const DAY = 86_400_000

export function dueLabel(iso: string | null) {
  if (!iso) return 'No deadline'
  const due = new Date(iso)
  const days = Math.ceil((due.getTime() - Date.now()) / DAY)
  const stamp = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (days < 0) return `Closed ${stamp}`
  if (days === 0) return `Due today · ${stamp}`
  if (days === 1) return `Due tomorrow · ${stamp}`
  if (days <= 14) return `Due in ${days} days · ${stamp}`
  return `Due ${stamp}`
}

export function StatusPill({ project }: { project: ProjectSummary }) {
  if (project.archived_at) {
    return (
      <span className="shrink-0 rounded-lg surface-sunken px-2 py-1 font-mono text-[11px] text-muted">
        Archived
      </span>
    )
  }
  if (project.scheduled) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-400/18 px-2 py-1 font-mono text-[11px] text-amber-700 dark:text-amber-300">
        <Icon name="clock" size={12} />
        Scheduled
      </span>
    )
  }
  return null
}

export function ProjectCard({
  project,
  to,
  showClass = true,
}: {
  project: ProjectSummary
  to: string
  showClass?: boolean
}) {
  const meta = PROJECT_TYPES.find((t) => t.value === project.type)
  const overdue = project.due_at ? new Date(project.due_at).getTime() < Date.now() : false

  return (
    <Link
      to={to}
      className="group surface flex flex-col rounded-card border border-line p-5 shadow-card transition-[transform,box-shadow,border-color] duration-250 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
            <Icon name={meta?.icon ?? 'folder'} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] text-muted">
              {projectTypeLabel(project)}
            </span>
            <span className="block font-mono text-[11px] text-faint">
              {weekSpanLabel(project)}
            </span>
          </span>
        </span>
        <StatusPill project={project} />
      </div>

      <h3 className="mt-3.5 line-clamp-2 text-[16.5px] leading-snug">{project.title}</h3>

      {showClass && (
        <p className="mt-1 truncate text-[12px] text-muted">
          {project.class_initial} · {project.class_name}
          {project.group_set_name ? ` · ${project.group_set_name}` : ''}
        </p>
      )}

      {project.week_assessments && (
        <p className="mt-3 line-clamp-2 flex gap-1.5 text-[12.5px] leading-snug text-amber-700 dark:text-amber-300">
          <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
          {project.week_assessments}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-[12px] text-muted">
        <span
          className={`flex items-center gap-1.5 ${
            overdue ? 'text-faint' : 'text-muted'
          }`}
        >
          <Icon name="clock" size={13} />
          {dueLabel(project.due_at)}
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name={project.audience === 'group' ? 'users' : 'user'} size={13} />
          {project.audience === 'group' ? 'Group' : 'Individual'}
        </span>
        <span className="font-mono text-faint">{project.total_points} pts</span>
      </div>
    </Link>
  )
}
