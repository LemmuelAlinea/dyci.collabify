import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useLive } from '../../hooks/useLive'
import { archiveGeneralProject, listSpaceProjects } from '../../lib/api/general'
import { getSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { presetById } from '../../lib/general/presets'
import type { GeneralProjectSummary, GeneralSpaceSummary } from '../../lib/general/types'

/**
 * The archived projects in one space.
 *
 * This is why the projects list no longer carries an "include archived"
 * checkbox. Finished work is worth keeping and worth reading back, but it is
 * not what somebody is looking at on a Tuesday — a page you visit deliberately
 * serves it better than a filter that changes a list in place.
 *
 * Restoring is an Owner's call, and the button is only there for one.
 */
export default function SpaceArchive() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { show } = useToast()
  const [space, setSpace] = useState<GeneralSpaceSummary | null>(null)
  const [gone, setGone] = useState(false)
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<GeneralProjectSummary | null>(null)

  useEffect(() => {
    document.title = space ? `Archive · ${space.name} · Collabify` : 'Archive · Collabify'
  }, [space])

  const load = useCallback(async () => {
    if (!spaceId) return
    try {
      const [s, p] = await Promise.all([getSpace(spaceId), listSpaceProjects(spaceId)])
      if (!s) return setGone(true)
      setSpace(s)
      setProjects(p)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the archive.'))
      setProjects((prev) => prev ?? [])
    }
  }, [spaceId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_projects', 'general_members'])

  const archived = useMemo(
    () => (projects ?? []).filter((p) => p.archived_at),
    [projects],
  )

  async function restore() {
    if (!restoring) return
    await archiveGeneralProject(restoring.id, false)
    show(`${restoring.name} is back in ${space?.name ?? 'the space'}`)
    await load()
  }

  if (gone) return <Navigate to="/general/spaces" replace />

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{space?.name ?? 'Space'}</p>
          <h1 className="mt-1 font-display">Archive</h1>
          <p className="mt-1 text-[13px] text-muted">
            Projects that have been put away. Everything inside them is still here and still
            readable — an Owner can bring one back at any time.
          </p>
        </div>
        {spaceId && (
          <Link
            to={`/general/spaces/${spaceId}`}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
          >
            <Icon name="board" size={15} />
            Back to projects
          </Link>
        )}
      </header>

      <div className="mt-6 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {projects === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading the archive…
          </div>
        ) : archived.length === 0 ? (
          <EmptyState
            icon="folder"
            title="Nothing archived"
            body="When a project here is finished, archiving it keeps the whole record and takes it off the projects list."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line">
            {archived.map((p) => {
              const kind = presetById(p.preset)
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--surface)] px-4 py-3.5 sm:px-5"
                >
                  <div className="min-w-[14rem] flex-1">
                    <Link
                      to={`/general/projects/${p.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                      {kind && kind.id !== 'blank' && (
                        <span className="flex items-center gap-1">
                          <Icon name={kind.icon} size={12} />
                          {kind.name}
                        </span>
                      )}
                      <span>{dateRange(p.starts_on, p.ends_on)}</span>
                      <span className="text-faint">·</span>
                      <span>
                        {p.done_count}/{p.task_count} tasks done
                      </span>
                    </p>
                  </div>
                  {p.my_level === 'owner' && (
                    <Button size="sm" variant="outline" onClick={() => setRestoring(p)}>
                      Restore
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={restore}
        title="Restore this project?"
        body={`${restoring?.name ?? 'The project'} goes back to the projects list and can be edited again.`}
        confirmLabel="Restore"
        tone="primary"
      />
    </div>
  )
}
