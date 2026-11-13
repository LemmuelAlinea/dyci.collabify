import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { ProjectGroupsTab } from '../groups/ProjectGroupsTab'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { boardLabel } from '../../lib/classProjectNav'
import { paths } from '../../lib/paths'
import { stagesOf } from '../../lib/stages'
import type { ClassSummary, ProjectSummary } from '../../lib/types'
import { BoardCards } from './BoardCards'

/**
 * The professor's first screen on a class project: one card per group (or
 * student) to open. Hand-ins and reassignments are answered on /waiting.
 */
export function ProjectGroupsView({
  project,
  t,
  cls,
  viewerId,
}: {
  project: ProjectSummary
  t: ProjectTasks
  cls: ClassSummary | null
  viewerId?: string
}) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const solo = project.audience === 'individual'
  const label = boardLabel(solo)
  const boardPath = (id: string) => paths.classProjectBoard(project.id, id)

  // A board's page for a board that is gone sent us here. Say so once: the
  // notice leaves the history entry, so a reload or back does not repeat it.
  const location = useLocation()
  const [missingBoard, setMissingBoard] = useState(
    () => (location.state as { notice?: string } | null)?.notice === 'missing-board',
  )
  useEffect(() => {
    if ((location.state as { notice?: string } | null)?.notice !== 'missing-board') return
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location, navigate])

  // Who is in which group lives in the address, so a link can open it.
  const managing = !solo && params.get('manage') === '1'
  const toggleManage = () => {
    const next = new URLSearchParams(params)
    if (managing) next.delete('manage')
    else next.set('manage', '1')
    setParams(next, { replace: true })
  }

  if (t.boards === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading {label.many}…
      </div>
    )
  }

  const boards = t.boards

  return (
    <div className="space-y-6">
      {missingBoard && (
        <Alert tone="info" onClose={() => setMissingBoard(false)}>
          That {label.one} is no longer on this project.
        </Alert>
      )}
      {t.error && <Alert tone="error">{t.error}</Alert>}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3>{label.title}</h3>
          {!solo && boards.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleManage} aria-expanded={managing}>
              <Icon name="users" size={14} />
              Manage groups
            </Button>
          )}
        </div>

        {managing && (
          <div className="rounded-panel border border-line p-4 sm:p-5">
            <ProjectGroupsTab project={project} cls={cls} viewerId={viewerId} />
          </div>
        )}

        {boards.length === 0 ? (
          solo ? (
            <EmptyState
              icon="users"
              title="No students yet"
              body="Students show here once they join the class."
            />
          ) : (
            <EmptyState
              icon="users"
              art="groups"
              title="No groups on this project yet"
              body="Make groups for this project, then they show here."
              action={
                <Button variant="outline" onClick={toggleManage} aria-expanded={managing}>
                  <Icon name="users" size={15} />
                  Manage groups
                </Button>
              }
            />
          )
        ) : (
          <BoardCards
            boards={boards}
            rows={t.rows}
            stages={stagesOf(project.stages)}
            solo={solo}
            onOpen={(b) => navigate(boardPath(b.id))}
          />
        )}
      </section>
    </div>
  )
}
