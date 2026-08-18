import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { boardProgressFor } from '../../lib/api/tasks'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/Tabs'
import { ProjectCard } from './ProjectCard'
import { PROJECT_TYPES, projectTypeLabel, weekSpanLabel } from '../../lib/types'
import type { BoardSummary, ClassSummary, ProjectSummary } from '../../lib/types'

type StatusFilter = 'live' | 'scheduled' | 'closed' | 'archived' | ''

const STATUS_OPTIONS = [
  { value: 'live', label: 'Open now' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'closed', label: 'Past deadline' },
  { value: 'archived', label: 'Archived' },
]

function statusOf(p: ProjectSummary): Exclude<StatusFilter, ''> {
  if (p.archived_at) return 'archived'
  if (p.scheduled) return 'scheduled'
  // Closed by hand, or simply past its deadline — either way it is not the
  // work a professor is still waiting on.
  if (p.locked_at) return 'closed'
  if (p.due_at && new Date(p.due_at).getTime() < Date.now()) return 'closed'
  return 'live'
}

/** Deadline first, then the week it is based on — the order a professor plans in. */
function byUrgency(a: ProjectSummary, b: ProjectSummary) {
  if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
  if (a.due_at) return -1
  if (b.due_at) return 1
  return a.start_week - b.start_week
}

export function ProjectsBoard({
  projects,
  classes,
  linkBase,
  showClass = true,
  emptyTitle,
  emptyBody,
  emptyAction,
}: {
  projects: ProjectSummary[]
  classes: ClassSummary[]
  linkBase: string
  showClass?: boolean
  emptyTitle: string
  emptyBody: string
  emptyAction?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [classId, setClassId] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [progress, setProgress] = useState(new Map<string, BoardSummary>())

  // A card shows how far its board has got. RLS hands a student their own board
  // and nobody else's, so one query covers the whole list.
  const projectIds = projects.map((p) => p.id).join(',')
  useEffect(() => {
    if (!projectIds) return
    void boardProgressFor(projectIds.split(','))
      .then(setProgress)
      .catch(() => setProgress(new Map()))
  }, [projectIds])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects
      .filter((p) => (classId ? p.class_id === classId : true))
      .filter((p) => (type ? p.type === type : true))
      .filter((p) => (status ? statusOf(p) === status : p.archived_at === null))
      .filter((p) =>
        q
          ? [
              p.title,
              p.class_name,
              p.class_initial,
              projectTypeLabel(p),
              weekSpanLabel(p),
              p.week_assessments ?? '',
            ]
              .join(' ')
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort(byUrgency)
  }, [projects, query, classId, type, status])

  const filtering = Boolean(query || classId || type || status)

  if (projects.length === 0) {
    return (
      <EmptyState icon="kanban" title={emptyTitle} body={emptyBody} action={emptyAction} />
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pr-4 pl-11 text-[14.5px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12 focus:outline-none"
          />
        </div>

        {classes.length > 1 && (
          <Select
            aria-label="Filter by class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            placeholder="All classes"
            options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
            className="!h-11"
          />
        )}

        <Select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="All types"
          options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          className="!h-11"
        />

        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          placeholder="All open"
          options={STATUS_OPTIONS}
          className="!h-11"
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="search"
          title="Nothing matches"
          body={
            filtering
              ? 'Try a different search, or clear the filters.'
              : 'There is nothing to show here yet.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              to={`${linkBase}/${p.id}`}
              showClass={showClass}
              progress={progress.get(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
