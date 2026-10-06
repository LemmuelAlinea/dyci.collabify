// src/components/general/WorkTab.tsx
import { useSearchParams } from 'react-router-dom'
import { WorkNav } from '../work/WorkNav'
import { taskLayout, withWork, workSection } from '../../lib/work/nav'
import { TaskDialog } from './TaskDialog'
import { TasksTab } from './TasksTab'
import { WorkSummary } from './WorkSummary'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A work project's Work tab: Summary and Tasks for now; Backlog, Sprints and
 * Milestones join in later parts. The open task is one dialog for every
 * section, so a task opened from Summary's late list opens in place.
 */
export function WorkTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const section = workSection(params, 'tasks')
  const layout = taskLayout(params)

  const showTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  return (
    <div className="space-y-5">
      <WorkNav active={section} onChange={(s) => setParams(withWork(params, { section: s }))} />
      {section === 'summary' ? (
        <WorkSummary state={state} onOpenTask={showTask} />
      ) : (
        <TasksTab
          state={state}
          layout={layout}
          onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
          onOpenTask={showTask}
        />
      )}
      <TaskDialog state={state} taskId={params.get('task')} onClose={() => showTask(null)} />
    </div>
  )
}
