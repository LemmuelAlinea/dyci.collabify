// src/components/general/OverviewTab.tsx
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { requestForProject } from '../../lib/api/projectRequests'
import type { ProjectRequest } from '../../lib/api/projectRequests'
import { paths } from '../../lib/paths'
import { DetailsView, FieldsView, StagesView, StoredFieldValue } from './ProjectInfo'
import type { GeneralProjectState } from './useGeneralProject'

export function OverviewTab({ state }: { state: GeneralProjectState }) {
  const [showInfo, setShowInfo] = useState(false)
  const p = state.project
  const projectId = p?.id
  const classBoardId = p?.class_board_id
  const viewerId = state.viewerId
  const [source, setSource] = useState<{ projectId: string; viewerId: string | undefined; request: ProjectRequest | null } | null>(null)
  useEffect(() => {
    if (!projectId || classBoardId) return
    let active = true
    void requestForProject(projectId)
      .then((request) => { if (active) setSource({ projectId, viewerId, request }) })
      .catch(() => { if (active) setSource({ projectId, viewerId, request: null }) })
    return () => { active = false }
  }, [projectId, classBoardId, viewerId])
  if (!p) return null
  const sourceRequest = !classBoardId && source?.projectId === p.id && source.viewerId === viewerId ? source.request : null

  return (
    <>
      <section className="card h-full p-4 shadow-card sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2>Project info</h2>
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            View all
          </button>
        </header>
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="col-span-2">
            <dt className="text-[12px] text-faint">About</dt>
            <dd className="mt-0.5 line-clamp-2 text-ink">{p.description || 'No description yet.'}</dd>
          </div>
          {sourceRequest && <div className="col-span-2">
            <dt className="text-[12px] text-faint">Origin</dt>
            <dd className="mt-0.5"><Link className="text-navy-600 hover:underline dark:text-navy-200" to={`${paths.spaceProjects(sourceRequest.space_id)}?request=${encodeURIComponent(sourceRequest.id)}`}>Source request</Link></dd>
          </div>}
          {state.fields.slice(0, 2).map((field) => {
            const stored = state.values.find((value) => value.field_id === field.id)
            return (
              <div key={field.id} className="min-w-0">
                <dt className="truncate text-[12px] text-faint">{field.name}</dt>
                <dd className="mt-0.5 truncate text-ink">
                  <StoredFieldValue field={field} value={stored?.value} nameOf={state.nameOf} />
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
      <Modal open={showInfo} onClose={() => setShowInfo(false)} title="Project info" placement="right">
        <div className="space-y-6">
          <InfoSection title="Details" editLabel="Edit in Settings" section="general" state={state} onGo={() => setShowInfo(false)} divided>
            <DetailsView state={state} />
          </InfoSection>
          <InfoSection title="Stages" editLabel="Edit stages in Settings" section="tasks" state={state} onGo={() => setShowInfo(false)} divided>
            <StagesView state={state} />
          </InfoSection>
          <InfoSection title="Fields" state={state}>
            <FieldsView state={state} />
          </InfoSection>
        </div>
      </Modal>
    </>
  )
}

/** One read-only part of Project info. Editing happens in Settings, so an editor gets a link there. */
function InfoSection({
  title,
  editLabel,
  section,
  state,
  onGo,
  divided,
  children,
}: {
  title: string
  editLabel?: string
  section?: 'general' | 'tasks'
  state: GeneralProjectState
  onGo?: () => void
  divided?: boolean
  children: ReactNode
}) {
  const canEdit = state.can('edit_project') && !state.readOnly
  return (
    <section className={divided ? 'border-b border-line pb-6' : undefined}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2>{title}</h2>
        {canEdit && editLabel && section && (
          <Link
            to={{ search: `?tab=settings&section=${section}` }}
            onClick={onGo}
            className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            {editLabel}
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}
