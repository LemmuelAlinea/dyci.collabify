import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { JoinProjectDialog } from '../../components/general/JoinProjectDialog'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
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

/**
 * Every project whose space the reader is not in filters as one group. A space
 * id is a uuid, so this cannot collide with a real one.
 */
const UNNAMED_SPACE = 'unnamed'

export default function GeneralProjects() {
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')
  const [space, setSpace] = useState('')
  const [joinOpen, setJoinOpen] = useState(false)

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

  // Built from the projects themselves rather than from the reader's spaces:
  // this page also lists projects they joined by code, whose space is not
  // theirs to read and so is not in that list.
  const spaceOptions = useMemo(() => {
    const named = new Map<string, string>()
    let unnamed = false
    for (const p of live) {
      if (p.space_name) named.set(p.space_id, p.space_name)
      else unnamed = true
    }
    const options = [...named]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (unnamed) options.push({ value: UNNAMED_SPACE, label: 'A space you are not in' })
    return options
  }, [live])

  const spaceLabel = spaceOptions.find((o) => o.value === space)?.label ?? ''

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return live
      .filter((p) => (status ? p.status === status : true))
      .filter((p) =>
        space ? (space === UNNAMED_SPACE ? !p.space_name : p.space_id === space) : true,
      )
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [live, query, space, status])

  // A space that no longer has a project under the other filters would leave a
  // chosen value selected but unlistable, so it is cleared rather than stuck.
  useEffect(() => {
    if (space && !spaceOptions.some((o) => o.value === space)) setSpace('')
  }, [space, spaceOptions])

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Your General"
        accent="projects."
        description="Every General workplace project you joined, across all spaces, in one place."
        stats={[]}
        statsVariant="compact-row"
        action={
          <Button variant="onNavy" size="sm" onClick={() => setJoinOpen(true)}>
            <Icon name="lock" size={15} />
            Join with code
          </Button>
        }
      />

      {/* Also on the space dashboard, but a project code does not need a space
          and somebody who has none can only reach this page. */}
      <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={load} />

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
              active={[query.trim(), status, space].filter(Boolean).length}
              summary={[
                query.trim() && `“${query.trim()}”`,
                spaceLabel,
                status && projectStatusLabel(status),
              ]
                .filter(Boolean)
                .join(' · ')}
              onClear={() => {
                setQuery('')
                setStatus('')
                setSpace('')
              }}
            >
              <FilterField label="Search">
                <FilterSearch value={query} onChange={setQuery} placeholder="Name or description" />
              </FilterField>
              {/* Only worth a row once the projects actually span more than one
                  space; below that it filters nothing. */}
              {spaceOptions.length > 1 && (
                <FilterField label="Space">
                  <Select
                    value={space}
                    onChange={(e) => setSpace(e.target.value)}
                    placeholder="Any space"
                    options={spaceOptions}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
              )}
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
  const shape = kind && kind.id !== 'blank' ? kind : null
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
      {/* Where it lives, then what shape it is. This page spans every space, so
          the space is the fact that tells two same-named projects apart. */}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <Icon name="folder" size={13} className="shrink-0" />
          {/* Null when the reader joined this project by code and never joined
              its space, so the space row that names it is not theirs to read.
              Said plainly beats a blank where every other card has a space. */}
          <span className="truncate">{p.space_name ?? 'A space you are not in'}</span>
        </span>
        {shape && (
          <>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1.5">
              <Icon name={shape.icon} size={13} className="shrink-0" />
              {shape.name}
            </span>
          </>
        )}
      </p>
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
