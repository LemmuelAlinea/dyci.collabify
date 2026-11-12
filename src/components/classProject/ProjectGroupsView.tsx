import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { ProjectGroupsTab } from '../groups/ProjectGroupsTab'
import { HandInQueue } from '../tasks/HandInQueue'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import { canTeach } from '../../lib/access'
import { listReassignments } from '../../lib/api/reassignments'
import { boardLabel } from '../../lib/classProjectNav'
import { paths } from '../../lib/paths'
import { stagesOf } from '../../lib/stages'
import { awaitingDecision } from '../../lib/types'
import type { ClassSummary, ProjectSummary } from '../../lib/types'
import { BoardCards } from './BoardCards'

/**
 * The professor's first screen on a class project: what is waiting on them,
 * then one card per group (or student) to open.
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
  const { profile } = useAuth()
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

  // Reassignments are answered on /waiting, which only a teacher opens; a class
  // adviser without the teaching switch reads this page too.
  const teaches = canTeach(profile)
  const [reassignments, setReassignments] = useState(0)
  const loadReassignments = useCallback(async () => {
    if (!teaches) return setReassignments(0)
    try {
      const all = await listReassignments()
      setReassignments(all.filter((r) => r.project_id === project.id && r.status === 'pending').length)
    } catch {
      setReassignments(0)
    }
  }, [teaches, project.id])
  useEffect(() => {
    void loadReassignments()
  }, [loadReassignments])
  useLive(loadReassignments, ['task_reassignments'], { enabled: teaches })

  if (t.boards === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading {label.many}…
      </div>
    )
  }

  const boards = t.boards
  const handIns = boards.filter(awaitingDecision).length

  return (
    <div className="space-y-6">
      {missingBoard && (
        <Alert tone="info" onClose={() => setMissingBoard(false)}>
          That {label.one} is no longer on this project.
        </Alert>
      )}
      {t.error && <Alert tone="error">{t.error}</Alert>}

      {(handIns > 0 || reassignments > 0) && (
        <div className="space-y-3">
          <HandInQueue
            boards={boards}
            solo={solo}
            onOpen={(b) => navigate(boardPath(b.id))}
            onChanged={t.refresh}
          />
          {reassignments > 0 && (
            <Link
              to={`${paths.waiting}?section=reassignments`}
              className="flex items-center gap-3 rounded-xl border border-warning-300 bg-warning-400/6 px-4 py-3 text-[13px] text-ink transition-colors hover:bg-warning-400/12 sm:px-5 dark:border-warning-400/40 dark:bg-warning-400/8"
            >
              <Icon name="refresh" size={16} className="shrink-0 text-warning-600 dark:text-warning-300" />
              <span className="min-w-0 flex-1">
                <span className="font-mono font-medium">{reassignments}</span> reassignment{' '}
                {reassignments === 1 ? 'request' : 'requests'} on this project
              </span>
              <Icon name="arrowRight" size={15} className="shrink-0 text-muted" />
            </Link>
          )}
        </div>
      )}

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
