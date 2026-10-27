// src/components/general/WorkTab.tsx
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BacklogView } from '../work/BacklogView'
import { MilestonesView } from '../work/MilestonesView'
import { QaQueue } from '../work/QaQueue'
import { SprintsView } from '../work/SprintsView'
import { Tabs } from '../ui/Tabs'
import { readScope } from '../../lib/work/scope'
import { taskLayout, withWork, workSection, type WorkSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'
import { generalMilestoneSource, generalWorkSource } from './workSource'

/** Project work sections share one task dialog, including links from Summary. */
export function WorkTab({ state, area }: { state: GeneralProjectState; area: 'overview' | 'plan' | 'tasks' }) {
  const [params, setParams] = useSearchParams()
  const section = workSection(params, area === 'overview' ? 'summary' : area === 'plan' ? 'milestones' : 'tasks')
  const layout = taskLayout(params)

  useEffect(() => {
    if (area === 'plan' && section === 'backlog') document.getElementById('project-backlog')?.scrollIntoView()
  }, [area, section])

  const changeSection = (section: WorkSection) => {
    const next = withWork(params, { section })
    next.set('tab', section === 'summary' ? 'overview' : section === 'backlog' || section === 'milestones' ? 'plan' : 'tasks')
    next.delete('milestone')
    next.delete('task')
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
      {area === 'overview' ? (
        <WorkSummary
          state={state}
          onOpenTask={showTask}
          onSection={changeSection}
        />
      ) : area === 'plan' ? (
        <div className="space-y-8">
          <section aria-label="Milestones">
            <MilestonesView source={generalMilestoneSource(state, showTask)} selectedId={params.get('milestone')} />
          </section>
          <section id="project-backlog" aria-label="Backlog and upcoming sprints" className="scroll-mt-24 border-t border-line pt-6">
            <BacklogView source={source} />
          </section>
        </div>
      ) : (
        <div className="space-y-6">
          <Tabs<WorkSection>
            tabs={[
              { id: 'tasks', label: 'Tasks', icon: 'check' },
              { id: 'sprints', label: 'Sprint activity', icon: 'target' },
              ...(state.project?.has_qa ? [{ id: 'qa' as const, label: 'QA queue', icon: 'shield' as const }] : []),
            ]}
            active={section === 'sprints' || (section === 'qa' && state.project?.has_qa) ? section : 'tasks'}
            onChange={changeSection}
            variant="panel"
          />
          {section === 'sprints' ? <SprintsView source={source} onPlan={() => changeSection('backlog')} /> :
            section === 'qa' && state.project?.has_qa ? <QaQueue state={state} onOpenTask={showTask} /> :
            <TasksTab
              state={state}
              layout={layout}
              onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
              scope={scope}
              onScope={(s) => setParams(withWork(params, { scope: s }), { replace: true })}
              onOpenTask={showTask}
            />}
        </div>
      )}
      <TaskDialog state={state} taskId={params.get('task')} onClose={() => showTask(null)} />
    </div>
  )
}
