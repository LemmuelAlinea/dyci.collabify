import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Alert } from '../../components/ui/Alert'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Field'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { archiveGeneralProject, deleteGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { presetById } from '../../lib/general/presets'
import type { GeneralProjectSummary } from '../../lib/general/types'

/**
 * The archived projects in one space that this person may see.
 *
 * This is why the projects list no longer carries an "include archived"
 * checkbox. Finished work is worth keeping and worth reading back, but it is
 * not what somebody is looking at on a Tuesday — a page you visit deliberately
 * serves it better than a filter that changes a list in place.
 *
 * Nothing is filtered here. The database only returns an archived project to
 * whoever archived it and to that project's Owners and Managers, so the list,
 * its count and the project page all agree.
 *
 * Restoring and deleting are an Owner's call, and the menu is only there for one.
 * Deleting asks for the project's name, because it cannot be undone.
 */
export default function SpaceArchive() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { show } = useToast()
  const { spaces, currentSpace: space, projects, error, reload } = useGeneralNavigation()
  const [restoring, setRestoring] = useState<GeneralProjectSummary | null>(null)
  const [deleting, setDeleting] = useState<GeneralProjectSummary | null>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    document.title = space ? `Archive · ${space.name} · Collabify` : 'Archive · Collabify'
  }, [space])

  const archived = useMemo(
    () => (projects ?? []).filter((p) => p.archived_at),
    [projects],
  )

  async function restore() {
    if (!restoring) return
    await archiveGeneralProject(restoring.id, false)
    show(`${restoring.name} is back in ${space?.name ?? 'the space'}`)
    await reload()
  }

  async function remove() {
    if (!deleting) return
    try {
      await deleteGeneralProject(deleting.id)
    } catch (err) {
      await reload()
      throw new Error(authErrorMessage(err, 'Could not delete that project.'), { cause: err })
    }
    show(`${deleting.name} deleted`)
    await reload()
  }

  if (spaceId && spaces !== null && !space) {
    return <Navigate to="/general/spaces" replace />
  }

  return (
    <div className="w-full">
      <DirectoryHero
        title="Archived projects,"
        accent="within reach."
        description="Projects you archived, or lead, stay readable here. An Owner can bring one back or delete it for good."
        stats={[]}
        action={spaceId ? (
          <Link
            to={`/general/spaces/${spaceId}`}
            className="flex items-center gap-1.5 rounded-lg border border-amber-50/20 bg-amber-50/10 px-3 py-1.5 text-[13px] font-medium text-amber-50 hover:bg-amber-50/16"
          >
            <Icon name="board" size={15} />
            Back to projects
          </Link>
        ) : undefined}
      />

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
                    <ActionMenu
                      label={`Actions for ${p.name}`}
                      items={[
                        { label: 'Restore', icon: 'refresh', onSelect: () => setRestoring(p) },
                        {
                          label: 'Delete project',
                          icon: 'trash',
                          tone: 'danger',
                          separated: true,
                          onSelect: () => {
                            setTyped('')
                            setDeleting(p)
                          },
                        },
                      ]}
                    />
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

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this project for good?"
        body={
          <div className="space-y-3">
            <p>
              This deletes {deleting?.name ?? 'the project'} and everything in it: its tasks, files,
              history, drafts, review requests, members and project chat. It cannot be undone.
            </p>
            <label htmlFor="delete-project-name" className="block text-[13px] text-ink">
              Type <span className="font-mono font-medium">{deleting?.name}</span> to confirm
            </label>
            <Input
              id="delete-project-name"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        }
        confirmLabel="Delete project"
        blocked={typed.trim() !== (deleting?.name ?? '').trim()}
      />
    </div>
  )
}
