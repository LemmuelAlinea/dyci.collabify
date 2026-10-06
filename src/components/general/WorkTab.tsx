// src/components/general/WorkTab.tsx
import { useSearchParams } from 'react-router-dom'
import { BacklogView } from '../work/BacklogView'
import { SprintsView } from '../work/SprintsView'
import { WorkNav } from '../work/WorkNav'
import { readScope } from '../../lib/work/scope'
import { taskLayout, withWork, workSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'
import { generalWorkSource } from './workSource'

/**
 * A work project's Work tab: Summary, Backlog, Sprints and Tasks; Milestones
 * join in a later part. The open task is one dialog for every section, so a
 * task opened from Summary's late list opens in place.
 */
export function WorkTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const section = workSection(params, 'tasks')
  const layout = taskLayout(params)

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
      <WorkNav active={section} onChange={(s) => setParams(withWork(params, { section: s }))} />
      {section === 'summary' ? (
        <WorkSummary state={state} onOpenTask={showTask} />
      ) : section === 'backlog' ? (
        <BacklogView source={source} />
      ) : section === 'sprints' ? (
        <SprintsView source={source} onPlan={() => setParams(withWork(params, { section: 'backlog' }))} />
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
