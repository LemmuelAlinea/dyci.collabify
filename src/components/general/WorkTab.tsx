// src/components/general/WorkTab.tsx
import { useSearchParams } from 'react-router-dom'
import { BacklogView } from '../work/BacklogView'
import { MilestonesView } from '../work/MilestonesView'
import { QaQueue } from '../work/QaQueue'
import { SprintsView } from '../work/SprintsView'
import { Tabs } from '../ui/Tabs'
import { readScope } from '../../lib/work/scope'
import { paths } from '../../lib/paths'
import { taskLayout, withWork, workSection, type WorkSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { LeadInbox } from './LeadInbox'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'
import { generalMilestoneSource, generalWorkSource } from './workSource'

/** Project work sections share one task dialog, including links from Summary. */
export function WorkTab({ state, area }: { state: GeneralProjectState; area: 'overview' | 'plan' | 'tasks' }) {
  const [params, setParams] = useSearchParams()
  const section = workSection(params, area === 'overview' ? 'summary' : area === 'plan' ? 'milestones' : 'tasks')
  const layout = taskLayout(params)

  const changeSection = (section: WorkSection) => {
    const next = withWork(params, { section })
    next.set('tab', section === 'summary' ? 'overview' : section === 'backlog' || section === 'milestones' || section === 'sprints' ? 'plan' : 'tasks')
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
          <Tabs<WorkSection>
            tabs={[{ id: 'milestones', label: 'Milestones', icon: 'target' }, { id: 'backlog', label: 'Sprints', icon: 'calendar' }]}
            active={section === 'backlog' || section === 'sprints' ? 'backlog' : 'milestones'}
            onChange={changeSection}
            variant="panel"
          />
          {section === 'backlog' || section === 'sprints' ? <div className="space-y-8">
            <section id="project-sprint-activity" aria-label="Active and finished sprints" className="scroll-mt-24">
              <SprintsView source={source} onPlan={() => document.getElementById('project-backlog')?.scrollIntoView()}
                archiveHref={state.project ? paths.projectArchive(state.project.id) : undefined} />
            </section>
            <section id="project-backlog" aria-label="Backlog and upcoming sprints" className="scroll-mt-24 border-t border-line pt-6">
              <BacklogView source={source} />
            </section>
          </div> : <MilestonesView source={generalMilestoneSource(state, showTask)} selectedId={params.get('milestone')} />}
        </div>
      ) : (
        <div className="space-y-6">
          {state.project?.has_qa && <Tabs<WorkSection>
            tabs={[
              { id: 'tasks', label: 'Tasks', icon: 'check' },
              { id: 'qa', label: 'QA queue', icon: 'shield' },
            ]}
            active={section === 'qa' ? 'qa' : 'tasks'}
            onChange={changeSection}
            variant="panel"
          />}
          {section === 'qa' && state.project?.has_qa ? <QaQueue state={state} onOpenTask={showTask} /> :
            <>
            <LeadInbox key={`${state.project?.id}-${state.viewerId}`} state={state} />
            <TasksTab
              state={state}
              layout={layout}
              onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
              onViewBoard={() => setParams(withWork(params, { scope: 'all', layout: 'board' }), { replace: true })}
              scope={scope}
              onScope={(s) => setParams(withWork(params, { scope: s }), { replace: true })}
              onOpenTask={showTask}
            /></>}
        </div>
      )}
      <TaskDialog state={state} taskId={params.get('task')} onClose={() => showTask(null)} />
    </div>
  )
}
