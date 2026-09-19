import { Alert } from '../ui/Alert'
import { projectForecast } from '../../lib/general/forecast'
import { formatDay } from '../../lib/general/dates'
import type { GeneralProjectState } from './useGeneralProject'

/** An ISO instant as the calendar day it falls on, locally. */
function asDay(iso: string) {
  const d = new Date(iso)
  return formatDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}

/**
 * Whether the work still open fits before the end date.
 *
 * The arithmetic is shown beside the answer for the same reason Education's
 * pace card shows it: a group asked to act on a projection is owed the sum
 * behind it.
 */
export function ForecastPanel({ state }: { state: GeneralProjectState }) {
  const project = state.project
  if (!project) return null

  const f = projectForecast(state.tasks, project.ends_on)

  if (f.state === 'no_tasks') {
    return <p className="text-[13px] text-muted">This project has no tasks yet.</p>
  }

  if (f.state === 'not_started') {
    return (
      <Alert tone="info">
        Nothing has been finished yet, so there is no pace to go on. This reads differently from
        moving slowly — it usually means nobody has picked the work up.
      </Alert>
    )
  }

  if (f.state === 'finished') {
    return (
      <p className="text-[14px] text-ink">
        Every task is done — all {f.total} of them.
      </p>
    )
  }

  // `rate` is rounded to one decimal for display, but `daysLeft` is computed
  // from the unrounded figures. A project whose one finished task is months
  // old can carry a real, tiny rate that rounds to 0 while still projecting a
  // concrete finish date — printing "0 a week" beside that date reads as a
  // contradiction, so a rate that rounds to 0 is named instead of shown.
  const paceText = f.rate === 0 ? 'under one a week' : `about ${f.rate} a week`

  const sum = (
    <p className="text-[12px] text-faint">
      {f.done} of {f.total} finished, {paceText} so far, {f.total - f.done} left.
    </p>
  )

  if (f.state === 'no_end_date') {
    return (
      <div className="space-y-1.5">
        <p className="text-[14px] text-ink">
          At this pace the last task lands around {asDay(f.finishesOn as string)}.
        </p>
        {sum}
        <p className="text-[12px] text-muted">
          This project has no end date, so there is nothing to compare that against. An Owner can
          set one on the Overview tab.
        </p>
      </div>
    )
  }

  if (f.state === 'overrunning') {
    return (
      <div className="space-y-1.5">
        <p className="text-[14px] text-red-700 dark:text-red-300">
          At this pace the work runs {f.overrunDays} {f.overrunDays === 1 ? 'day' : 'days'} past the
          end date — finishing around {asDay(f.finishesOn as string)} against{' '}
          {formatDay(project.ends_on as string)}.
        </p>
        {sum}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[14px] text-emerald-700 dark:text-emerald-300">
        At this pace the work finishes around {asDay(f.finishesOn as string)}, inside the{' '}
        {formatDay(project.ends_on as string)} end date.
      </p>
      {sum}
    </div>
  )
}
