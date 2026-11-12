import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Icon'
import { Tabs } from '../ui/Tabs'
import type { Tab } from '../ui/Tabs'
import { PeerRoundsPanel } from '../peer/PeerRoundsPanel'
import { GradesTable } from '../scoring/GradesTable'
import { useProjectScores } from '../scoring/useProjectScores'
import { classMilestoneSource } from '../tasks/classWorkSource'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { GroupMilestoneGrid } from '../work/GroupMilestoneGrid'
import { MilestonesView } from '../work/MilestonesView'
import { boardLabel, readProfessorProjectTab } from '../../lib/classProjectNav'
import type { ProfessorProjectTab } from '../../lib/classProjectNav'
import { paths } from '../../lib/paths'
import type { ClassSummary, ProjectSummary } from '../../lib/types'
import { ProjectGroupsView } from './ProjectGroupsView'
import { ProjectTasksView } from './ProjectTasksView'

/** What a tab's own place means; it means nothing on another tab. */
const TAB_PARAMS = ['task', 'layout', 'scope', 'manage', 'work']

/**
 * A class project as its professor reads it: the groups first, then the brief,
 * the tasks set for every group, the milestones and the grades. The tab lives
 * in `?tab=`, left out for Groups.
 */
export function ProfessorProject({
  project,
  t,
  viewerId,
  cls,
  brief,
}: {
  project: ProjectSummary
  t: ProjectTasks
  viewerId?: string
  /** The project's class, when the professor's class list has it. */
  cls: ClassSummary | null
  /** The Brief tab's content, which the student page shows too. */
  brief: ReactNode
}) {
  const [params, setParams] = useSearchParams()
  const tab = readProfessorProjectTab(params)
  const solo = project.audience === 'individual'

  const changeTab = useCallback(
    (next: ProfessorProjectTab) => {
      const changed = new URLSearchParams(params)
      if (next === 'groups') changed.delete('tab')
      else changed.set('tab', next)
      for (const key of TAB_PARAMS) changed.delete(key)
      setParams(changed, { replace: true })
    },
    [params, setParams],
  )

  const tabs: Tab<ProfessorProjectTab>[] = [
    { id: 'groups', label: boardLabel(solo).title, icon: 'users' },
    { id: 'brief', label: 'Brief', icon: 'file' },
    { id: 'tasks', label: 'Tasks', icon: 'check' },
    { id: 'milestones', label: 'Milestones', icon: 'target' },
    { id: 'grades', label: 'Grades', icon: 'chart' },
  ]

  return (
    <>
      <div className="mt-6">
        <Tabs<ProfessorProjectTab>
          tabs={tabs}
          active={tab}
          onChange={(next) => changeTab(next)}
          variant="panel"
        />
      </div>

      <div className="mt-6">
        {tab === 'groups' && (
          <ProjectGroupsView project={project} t={t} cls={cls} viewerId={viewerId} />
        )}
        {tab === 'brief' && brief}
        {tab === 'tasks' && (
          <BoardsReady t={t} solo={solo}>
            <ProjectTasksView project={project} t={t} viewerId={viewerId} />
          </BoardsReady>
        )}
        {tab === 'milestones' && <ProjectMilestones project={project} t={t} />}
        {tab === 'grades' && (
          <BoardsReady t={t} solo={solo}>
            <ProjectGrades project={project} t={t} />
          </BoardsReady>
        )}
      </div>
    </>
  )
}

/** Holds a tab that reads the boards until they load, and says so when there are none. */
function BoardsReady({ t, solo, children }: { t: ProjectTasks; solo: boolean; children: ReactNode }) {
  const label = boardLabel(solo)
  if (t.boards === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading {label.many}…
      </div>
    )
  }
  if (t.boards.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No boards yet"
        body="A board appears for each group once the project reaches them. Check the group set on this project."
      />
    )
  }
  return <>{children}</>
}

/** Setting the project's milestones, then every group against each of them. */
function ProjectMilestones({ project, t }: { project: ProjectSummary; t: ProjectTasks }) {
  const navigate = useNavigate()
  const { one: who } = boardLabel(project.audience === 'individual')
  const source = classMilestoneSource(t, project.id)

  return (
    <div className="space-y-6">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      <section className="space-y-4">
        <MilestonesView source={source} />
      </section>

      <section className="space-y-3 border-t border-line pt-6">
        <div>
          <h3>Milestones by {who}</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            How far each {who} is toward each milestone. Open {who === 'student' ? 'a student' : 'a group'} to see its tasks.
          </p>
        </div>
        <GroupMilestoneGrid
          milestones={t.milestones}
          groups={source.groups}
          who={who}
          onOpenGroup={(id) => navigate(paths.classProjectBoard(project.id, id))}
        />
      </section>
    </div>
  )
}

/** The grades table and its release, then the peer rounds on a group project. */
function ProjectGrades({ project, t }: { project: ProjectSummary; t: ProjectTasks }) {
  const navigate = useNavigate()
  const solo = project.audience === 'individual'
  const { one: who } = boardLabel(solo)
  const boards = t.boards ?? []
  const scores = useProjectScores(project.id, boards.map((b) => b.id))

  return (
    <div className="space-y-6">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      <section className="space-y-3">
        <div>
          <h3>Grades</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Score each {who} against the rubric, confirm each student, then release. Open a{' '}
            {who} to score it.
          </p>
        </div>
        <GradesTable
          projectId={project.id}
          boards={boards}
          solo={solo}
          scores={scores}
          onOpen={(id) => navigate(`${paths.classProjectBoard(project.id, id)}?tab=grade`)}
        />
      </section>

      {!solo && (
        <section className="border-t border-line pt-6">
          <PeerRoundsPanel projectId={project.id} />
        </section>
      )}
    </div>
  )
}
