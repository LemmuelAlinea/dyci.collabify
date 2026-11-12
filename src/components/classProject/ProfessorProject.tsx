import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs } from '../ui/Tabs'
import type { Tab } from '../ui/Tabs'
import { ProjectTasksTab } from '../tasks/ProjectTasksTab'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { boardLabel, readProfessorProjectTab } from '../../lib/classProjectNav'
import type { ProfessorProjectTab } from '../../lib/classProjectNav'
import type { ClassSummary, ProjectSummary } from '../../lib/types'
import type { WorkSection } from '../../lib/work/nav'
import { ProjectGroupsView } from './ProjectGroupsView'

/** What a tab's own place means; it means nothing on another tab. */
const TAB_PARAMS = ['task', 'layout', 'scope', 'manage', 'work']

/*
 * Until Tasks, Milestones and Grades get their own content, each shows the old
 * Work view held to the sections that tab will replace, and a Work link to a
 * section another tab holds moves to that tab.
 */
type Section = ProjectTasks['section']
const TAB_SECTIONS: Record<Exclude<ProfessorProjectTab, 'groups' | 'brief'>, readonly Section[]> = {
  tasks: ['tasks', 'backlog', 'sprints'],
  milestones: ['milestones'],
  grades: ['summary'],
}
const SECTION_TAB: Record<WorkSection, ProfessorProjectTab> = {
  summary: 'grades',
  tasks: 'tasks',
  backlog: 'tasks',
  sprints: 'tasks',
  milestones: 'milestones',
  qa: 'grades',
}

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
    (next: ProfessorProjectTab, work?: WorkSection) => {
      const changed = new URLSearchParams(params)
      if (next === 'groups') changed.delete('tab')
      else changed.set('tab', next)
      for (const key of TAB_PARAMS) changed.delete(key)
      if (work) changed.set('work', work)
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

  const sections = tab === 'groups' || tab === 'brief' ? null : TAB_SECTIONS[tab]
  const work = useMemo(() => {
    if (!sections) return null
    return {
      ...t,
      section: sections.includes(t.section) ? t.section : sections[0],
      setSection: (s: WorkSection) =>
        SECTION_TAB[s] === tab ? t.setSection(s) : changeTab(SECTION_TAB[s], s),
    }
  }, [sections, t, tab, changeTab])

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
        {work && sections && (
          <ProjectTasksTab
            project={project}
            role="professor"
            viewerId={viewerId}
            t={work}
            sections={sections}
          />
        )}
      </div>
    </>
  )
}
