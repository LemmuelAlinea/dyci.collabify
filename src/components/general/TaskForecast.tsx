import { useEffect, useState } from 'react'
import { taskForecast, type TaskShortfall } from '../../lib/api/workload'
import { formatHours } from '../../lib/work/hours'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * "Needs 5 h more than Ivan Cruz has before it's due", one line per holder short
 * of hours. Only the project's planners and the task's holders get any rows.
 */
export function TaskForecast({ taskId, state }: { taskId: string; state: GeneralProjectState }) {
  const [rows, setRows] = useState<TaskShortfall[]>([])
  useEffect(() => {
    let current = true
    taskForecast(taskId)
      .then((r) => { if (current) setRows(r) })
      .catch(() => { if (current) setRows([]) })
    return () => { current = false }
  }, [taskId])
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <p key={r.user_id} className="text-[13px] text-danger-700 dark:text-danger-300">
          Needs {formatHours(r.short_minutes)} more than {r.user_id === state.viewerId ? 'you have' : `${state.nameOf(r.user_id)} has`} before it&apos;s due
        </p>
      ))}
    </div>
  )
}
