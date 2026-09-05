import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { boardProgressFor } from '../../lib/api/tasks'
import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/EmptyState'
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
  /**
   * Whose progress the cards report. A student has one board per project and
   * the card speaks to them about it; a professor has every group's, and the
   * card has to summarise rather than pick one.
   */
  audience,
}: {
  projects: ProjectSummary[]
  classes: ClassSummary[]
  linkBase: string
  showClass?: boolean
  emptyTitle: string
  emptyBody: string
  emptyAction?: ReactNode
  /**
   * Whose progress these cards report. Required, with no default on purpose:
   * defaulting to `mine` is how a professor's class tab came to tell them their
   * own work had been "accepted by your professor" — twice, in two different
   * places, because the second call site never had to think about it.
   */
  audience: 'mine' | 'class'
}) {
  const [query, setQuery] = useState('')
  const [classId, setClassId] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [progress, setProgress] = useState(new Map<string, BoardSummary[]>())

  // A card shows how far its board has got. RLS hands a student their own board
  // and nobody else's, so one query covers the whole list.
  const projectIds = projects.map((p) => p.id).join(',')
  useEffect(() => {
    if (!projectIds) return
    void boardProgressFor(projectIds.split(','))
      .then(setProgress)
      .catch(() => setProgress(new Map()))
  }, [projectIds])

  // Counted from the projects already loaded rather than asked for: this page
  // holds every project the professor has, so the siblings are all here.
  const seriesSize = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of projects) {
      if (p.series_id) n.set(p.series_id, (n.get(p.series_id) ?? 0) + 1)
    }
    return n
  }, [projects])


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
      <EmptyState
        icon="kanban"
        art="projects"
        title={emptyTitle}
        body={emptyBody}
        action={emptyAction}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <FilterPopover
          active={
            [query, classId, type, status].filter(Boolean).length
          }
          summary={[
            query && `“${query}”`,
            classId && classes.find((c) => c.id === classId)?.initial,
            type && PROJECT_TYPES.find((t) => t.value === type)?.label,
            status && STATUS_OPTIONS.find((o) => o.value === status)?.label,
          ]
            .filter(Boolean)
            .join(' · ')}
          onClear={() => {
            setQuery('')
            setClassId('')
            setType('')
            setStatus('')
          }}
          label="Filter projects"
        >
          <FilterField label="Search">
            <FilterSearch value={query} onChange={setQuery} placeholder="Search projects" />
          </FilterField>

          {classes.length > 1 && (
            <FilterField label="Class">
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                placeholder="All classes"
                options={classes.map((c) => ({ value: c.id, label: `${c.initial} · ${c.name}` }))}
                className="!h-10 !text-[13.5px]"
              />
            </FilterField>
          )}

          <FilterField label="Kind of work">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="All types"
              options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              className="!h-10 !text-[13.5px]"
            />
          </FilterField>

          <FilterField label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              placeholder="All open"
              options={STATUS_OPTIONS}
              className="!h-10 !text-[13.5px]"
            />
          </FilterField>
        </FilterPopover>

        <p className="ml-auto shrink-0 font-mono text-[12px] text-faint">
          {shown.length === projects.length
            ? `${projects.length} projects`
            : `${shown.length} of ${projects.length}`}
        </p>
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
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4 min-[2100px]:grid-cols-5 max-sm:[&>*:only-child]:col-span-2">
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              to={`${linkBase}/${p.id}`}
              showClass={showClass}
              boards={progress.get(p.id) ?? []}
              audience={audience}
              sections={p.series_id ? (seriesSize.get(p.series_id) ?? 1) : 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
