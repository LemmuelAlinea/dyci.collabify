import { MILESTONE_STATUS_LABEL } from '../../lib/work/milestones'
import type { MilestoneStatus } from '../../lib/work/milestones'

const TONE: Record<MilestoneStatus, string> = {
  reached: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300',
  late: 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300',
  at_risk: 'bg-warning-50 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300',
  upcoming: 'bg-pending-soft text-pending-ink',
}

/** A milestone's status, in the colours Milestones and Summary share. */
export function StatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${TONE[status]}`}>
      {MILESTONE_STATUS_LABEL[status]}
    </span>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full surface-sunken">
      <span className="block h-full rounded-full bg-progress" style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  )
}
