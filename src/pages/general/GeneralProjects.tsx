import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Alert } from '../../components/ui/Alert'
import { EmptyState } from '../../components/ui/EmptyState'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { useLive } from '../../hooks/useLive'
import { listMyGeneralProjects } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { presetById } from '../../lib/general/presets'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralProjectSummary, GeneralStatus } from '../../lib/general/types'

export default function GeneralProjects() {
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')

  const load = useCallback(async () => {
    try {
      setProjects(await listMyGeneralProjects())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your projects.'))
      setProjects([])
    }
  }, [])

  useEffect(() => {
    document.title = 'General projects · Collabify'
    void load()
  }, [load])

  useLive(load, ['general_projects', 'general_members', 'general_tasks'])

  const live = useMemo(() => (projects ?? []).filter((p) => p.my_level && !p.archived_at), [projects])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return live
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [live, query, status])

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Your General"
        accent="projects."
        description="Every General workplace project you joined, across all spaces, in one place."
        stats={[]}
        statsVariant="compact-row"
      />

      {error && <Alert tone="error">{error}</Alert>}

      {projects === null ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading projects…
        </div>
      ) : live.length === 0 ? (
        <EmptyState
          icon="kanban"
          title="No projects yet"
          body="Projects appear here after you create one or accept an invitation."
        />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto">All projects</h2>
            <FilterPopover
              align="right"
              label="Filter projects"
              active={[query.trim(), status].filter(Boolean).length}
              summary={[query.trim() && `“${query.trim()}”`, status && projectStatusLabel(status)]
                .filter(Boolean)
                .join(' · ')}
              onClear={() => {
                setQuery('')
                setStatus('')
              }}
            >
              <FilterField label="Search">
                <FilterSearch value={query} onChange={setQuery} placeholder="Name or description" />
              </FilterField>
              <FilterField label="Status">
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as GeneralStatus | '')}
                  placeholder="Any status"
                  options={PROJECT_STATUSES}
                  className="!h-10 !text-[13px]"
                />
              </FilterField>
            </FilterPopover>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon="search"
              title="Nothing matches"
              body="No project fits these filters. Clear them to see everything you are on."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function ProjectCard({ project: p }: { project: GeneralProjectSummary }) {
  const pct = Number(p.progress_pct)
  const kind = presetById(p.preset)
  return (
    <Link
      to={`/general/projects/${p.id}`}
      className="group flex flex-col rounded-card border border-line bg-[var(--surface)] p-4 transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 leading-snug group-hover:underline">{p.name}</h3>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {projectStatusLabel(p.status)}
        </span>
      </div>
      {kind && kind.id !== 'blank' && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">
          <Icon name={kind.icon} size={13} />
          {kind.name}
        </p>
      )}
      {p.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{p.description}</p>}
      <p className="mt-3 text-[12px] text-faint">{dateRange(p.starts_on, p.ends_on)}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted">
            {p.done_count}/{p.task_count} tasks done
          </span>
          <span className="font-mono text-faint">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="users" size={14} />
          {p.member_count} {p.member_count === 1 ? 'member' : 'members'}
        </span>
        <span className="text-faint">·</span>
        <span>You are {levelLabel(p.my_level)}</span>
      </div>
    </Link>
  )
}
