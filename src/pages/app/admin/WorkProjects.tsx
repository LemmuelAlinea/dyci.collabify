import { useCallback, useEffect, useMemo, useState } from 'react'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { AssignPmDialog } from '../../../components/general/NoPmNotice'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { FilterSearch } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useLive } from '../../../hooks/useLive'
import { listAdminWorkProjects } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import type { AdminWorkProject } from '../../../lib/general/types'

/**
 * Every work project and who runs it.
 *
 * The admin turns Project manager off only once someone's projects are handed
 * over or have lost their manager, so this is where a project left without one
 * gets a new one. Those come first. An admin reads no project from here: the
 * list is names, spaces and managers, nothing inside.
 */
export default function WorkProjects() {
  const [rows, setRows] = useState<AdminWorkProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [assigning, setAssigning] = useState<AdminWorkProject | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRows(await listAdminWorkProjects())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the work projects. Try again.'))
      setRows((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    document.title = 'Work projects · Collabify'
    void refresh()
  }, [refresh])

  useLive(refresh, ['general_projects', 'general_members', 'profiles'])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.space_name ?? '').toLowerCase().includes(q) ||
          (r.pm_name ?? '').toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(a.has_pm) - Number(b.has_pm) ||
          Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) ||
          a.name.localeCompare(b.name),
      )
  }, [rows, query])

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the work projects…
      </div>
    )
  }

  const orphaned = rows.filter((r) => !r.has_pm).length

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Work projects,"
        accent="and who runs them."
        description="Every work project, its space and its project manager. Assign one where a project has none."
      />

      {error && (
        <Alert tone="error" onRetry={refresh}>
          {error}
        </Alert>
      )}

      <section className="surface overflow-hidden rounded-panel border border-line">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
          <div>
            <p className="text-[12px] font-medium text-faint">
              {orphaned === 0
                ? 'Every project has a manager'
                : `${orphaned} without a project manager`}
            </p>
            <h2 className="mt-1">Projects and managers</h2>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
              <FilterSearch value={query} onChange={setQuery} placeholder="Project, space or manager" />
            </div>
            <p className="font-mono text-[12px] text-faint">
              {shown.length === rows.length ? `${rows.length} projects` : `${shown.length} of ${rows.length}`}
            </p>
          </div>
        </header>

        <div className="p-4 sm:p-5">
          {rows.length === 0 ? (
            <EmptyState icon="kanban" title="No work projects yet" body="They appear here once someone creates one." />
          ) : shown.length === 0 ? (
            <EmptyState icon="kanban" title="Nothing matches" body="Try a different project, space or name." />
          ) : (
            <>
              <div className="mb-2 hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6rem] gap-4 px-3.5 text-[12px] font-medium text-faint md:grid">
                <span>Project</span>
                <span>Space</span>
                <span>Project manager</span>
                <span className="sr-only">Action</span>
              </div>
              <ul className="space-y-2">
                {shown.map((r) => (
                  <li
                    key={r.id}
                    className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-xl border border-line px-3.5 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6rem]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon name="kanban" size={15} className="shrink-0 text-muted" />
                      <span className="truncate text-[14px] text-ink">{r.name}</span>
                      {r.archived_at && <Badge>Archived</Badge>}
                    </span>
                    <span className="col-start-1 truncate text-[13px] text-muted md:col-start-auto">
                      <span className="md:hidden">Space: </span>
                      {r.space_name ?? 'No space'}
                    </span>
                    <span className="col-start-1 min-w-0 md:col-start-auto">
                      {r.has_pm ? (
                        <span className="block truncate text-[13px] text-ink">{r.pm_name}</span>
                      ) : (
                        <Badge tone="warning">No project manager</Badge>
                      )}
                    </span>
                    <span className="col-start-2 row-span-3 row-start-1 justify-self-end md:col-start-auto md:row-span-1 md:row-start-auto">
                      {!r.has_pm && (
                        <Button size="sm" variant="outline" onClick={() => setAssigning(r)}>
                          Assign
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <AssignPmDialog
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        projectId={assigning?.id ?? ''}
        projectName={assigning?.name ?? 'this project'}
        onDone={refresh}
      />
    </div>
  )
}
