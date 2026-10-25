// src/components/general/WorkTab.tsx
import { useSearchParams } from 'react-router-dom'
import { BacklogView } from '../work/BacklogView'
import { MilestonesView } from '../work/MilestonesView'
import { QaQueue } from '../work/QaQueue'
import { SprintsView } from '../work/SprintsView'
import { WorkNav } from '../work/WorkNav'
import { readScope } from '../../lib/work/scope'
import { taskLayout, withWork, workSection, workSectionsFor, type WorkSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'
import { generalMilestoneSource, generalWorkSource } from './workSource'

/**
 * A work project's Work tab: Summary, Backlog, Sprints, Milestones and
 * Tasks. The open task is one dialog for every section, so a
 * task opened from Summary's late list opens in place.
 */
export function WorkTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const sections = workSectionsFor(Boolean(state.project?.has_qa))
  const asked = workSection(params, 'tasks')
  // A link to the queue of a project that has no QA lands on Tasks.
  const section = sections.includes(asked) ? asked : 'tasks'
  const layout = taskLayout(params)

  const changeSection = (section: WorkSection) => {
    const next = withWork(params, { section })
    next.delete('milestone')
    setParams(next)
  }

  const showTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) {
      next.set('task', id)
      // `task` alone reads as Tasks; keep the section the task was opened from.
      next.set('work', section)
    } else next.delete('task')
    setParams(next, { replace: !id })
  }

  const scope = readScope(params.get('scope'), state.sprints)
  const source = generalWorkSource(state, (id) => showTask(id))

  return (
    <div className="space-y-5">
      <WorkNav sections={sections} active={section} onChange={changeSection} />
      {section === 'summary' ? (
        <WorkSummary
          state={state}
          onOpenTask={showTask}
          onSection={changeSection}
        />
      ) : section === 'backlog' ? (
        <BacklogView source={source} />
      ) : section === 'sprints' ? (
        <SprintsView source={source} onPlan={() => changeSection('backlog')} />
      ) : section === 'qa' ? (
        <QaQueue state={state} onOpenTask={showTask} />
      ) : section === 'milestones' ? (
        <MilestonesView source={generalMilestoneSource(state, showTask)} selectedId={params.get('milestone')} />
      ) : (
        <TasksTab
          state={state}
          layout={layout}
          onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
          scope={scope}
          onScope={(s) => setParams(withWork(params, { scope: s }), { replace: true })}
          onOpenTask={showTask}
        />
      )}
      <TaskDialog state={state} taskId={params.get('task')} onClose={() => showTask(null)} />
    </div>
  )
}
