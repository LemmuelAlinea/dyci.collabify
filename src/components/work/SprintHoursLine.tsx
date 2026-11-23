import { useEffect, useState } from 'react'
import type { SprintHours } from '../../lib/api/workload'
import { plural } from '../../lib/plural'
import { formatHours } from '../../lib/work/hours'

/**
 * "Team hours 64 h (8 h away) · Planned 70 h" for a work project's sprint, then
 * what the hours can't count. Nothing without a loader (a class board).
 */
export function SprintHoursLine({ sprintId, load }: { sprintId: string; load?: (sprintId: string) => Promise<SprintHours | null> }) {
  const [hours, setHours] = useState<SprintHours | null>(null)
  useEffect(() => {
    if (!load) return
    let current = true
    load(sprintId)
      .then((h) => { if (current) setHours(h) })
      .catch(() => { if (current) setHours(null) })
    return () => { current = false }
  }, [sprintId, load])
  if (!load || !hours) return null
  const over = hours.planned_minutes > hours.available_minutes
  const notes = [
    hours.unassigned > 0 && `${hours.unassigned} ${plural(hours.unassigned, 'task has', 'tasks have')} no holder`,
    hours.people_without_hours > 0 &&
      `${hours.people_without_hours} ${plural(hours.people_without_hours, 'person has', 'people have')} no weekly hours`,
  ].filter(Boolean)
  return (
    <p className="font-mono text-[12px] text-muted">
      <span {...(over ? { 'data-over': '' } : {})} className={over ? 'text-warning-700 dark:text-warning-300' : ''}>
        Team hours {formatHours(hours.available_minutes)}
        {hours.away_minutes > 0 && ` (${formatHours(hours.away_minutes)} away)`} · Planned {formatHours(hours.planned_minutes)}
      </span>
      {notes.length > 0 && <span className="block text-faint">{notes.join(' · ')}</span>}
    </p>
  )
}
