import { useEffect, useMemo, useState } from 'react'
import { WorkProjectCard } from '../../components/general/WorkProjectCard'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Spinner } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { isFaculty } from '../../lib/access'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralStatus } from '../../lib/general/types'
import { useSpaceOutlet } from './spaceOutlet'

/** A space's Projects tab: every live project in it, searchable by name and status. */
export default function SpaceProjects() {
  const { profile } = useAuth()
  const { currentSpace: space, projects, error, reload } = useGeneralNavigation()
  const { all, canStart, openNewProject } = useSpaceOutlet()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')

  useEffect(() => {
    document.title = space ? `Projects · ${space.name} · Collabify` : 'Projects · Collabify'
  }, [space])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [all, query, status])

  if (projects === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading projects…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert tone="error" onRetry={() => void reload()}>
          {error}
        </Alert>
      )}

      {all.length === 0 ? (
        <EmptyState
          icon="kanban"
          title="No projects yet"
          body={
            isFaculty(profile)
              ? 'Create one for anything this space is running, or join one with a code somebody shared with you.'
              : 'A faculty member can add you to a project in this space.'
          }
          action={
            canStart ? (
              <Button onClick={openNewProject} className="!rounded-xl">
                New project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
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
              body="No project fits these filters. Clear them to see every project in this space."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((p, index) => (
                <WorkProjectCard key={p.id} project={p} index={index} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
