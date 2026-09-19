import { useNavigate } from 'react-router-dom'
import { dateRange } from '../../lib/general/dates'
import { projectProgress } from '../../lib/general/progress'
import { ForecastPanel } from './ForecastPanel'
import { GanttChart } from './GanttChart'
import { PressurePanel } from './PressurePanel'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Where the project stands, in the order somebody asks the questions.
 *
 * Read-only, and readable by every member: nothing here is a fact a member
 * could not reach by clicking through the tasks — the arrangement is the point.
 */
export function ProgressTab({ state }: { state: GeneralProjectState }) {
  const navigate = useNavigate()
  const project = state.project
  if (!project) return null

  const progress = projectProgress(state.tasks, project.points_enabled)

  return (
    <div className="space-y-6">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Where we are</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-[32px] leading-none font-bold text-ink">
            {progress.pct}%
          </span>
          <span className="text-[13px] text-muted">
            {progress.done} of {progress.total} tasks done
            {project.points_enabled ? ' · counted by points' : ''}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full surface-sunken">
          <span
            className="block h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.min(100, progress.pct)}%` }}
          />
        </div>
        <p className="mt-2 text-[12px] text-faint">{dateRange(project.starts_on, project.ends_on)}</p>
      </section>

      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Timeline</h2>
        <p className="mt-0.5 mb-3 text-[12px] text-muted">
          Every task with a date, laid out across the project.
        </p>
        <GanttChart state={state} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Will we finish in time</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">
            The pace so far, carried forward. Counting, not a promise.
          </p>
          <ForecastPanel state={state} />
        </section>

        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Late, and landing next</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">
            The part of this page you can still act on.
          </p>
          <PressurePanel
            state={state}
            onOpen={(taskId) => navigate(`/general/projects/${project.id}?task=${taskId}`)}
          />
        </section>
      </div>
    </div>
  )
}
