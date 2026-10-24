import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { DEFAULT_STAGES, stageIndex, statusForStage } from '../../lib/stages'
import type { TaskStatus } from '../../lib/types'

const TONE: Record<TaskStatus, string> = {
  todo: 'bg-pending-soft text-pending-ink',
  in_progress: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  done: 'bg-success-500/15 text-success-700 dark:text-success-300',
}

/** A task's stage, for someone who cannot move it. */
export function StageBadge({
  status,
  stage,
  stages = DEFAULT_STAGES,
}: {
  status: TaskStatus
  stage?: number | null
  /** The project's progress stages; the default three when left out. */
  stages?: readonly string[]
}) {
  return (
    <span
      className={`inline-block rounded-lg px-2 py-0.5 font-mono text-[12px] whitespace-nowrap ${TONE[status]}`}
    >
      {stages[stageIndex(status, stage, stages.length)]}
    </span>
  )
}

/**
 * A task's stage as a dropdown, for whoever may move it. The chevron sits
 * before the name so a column of these lines up on its left edge. It offers
 * the project's own stages, and answers with the status that stage means.
 * `blocked` names the stages this person may not move the task to (a project
 * with QA keeps them for QA); they are left out, apart from the current one,
 * and `blockedReason` says why on hover.
 */
export function StageSelect({
  status,
  stage,
  stages = DEFAULT_STAGES,
  title,
  onChange,
  blocked,
  blockedReason,
}: {
  status: TaskStatus
  stage?: number | null
  stages?: readonly string[]
  /** The task's title, so a screen reader knows which task this moves. */
  title: string
  blocked?: (to: number) => boolean
  blockedReason?: string
  onChange: (to: TaskStatus, stage: number) => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const current = stageIndex(status, stage, stages.length)
  const offered = stages.map((name, i) => ({ name, i })).filter(({ i }) => i === current || !blocked?.(i))
  return (
    <span
      className={`relative inline-flex items-center rounded-lg ring-1 ring-transparent transition-shadow focus-within:ring-navy-400 hover:ring-[var(--line-strong)] ${TONE[status]}`}
    >
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute left-1.5" />
      <select
        value={current}
        disabled={busy}
        aria-label={`Stage of ${title}`}
        title={offered.length < stages.length ? blockedReason : undefined}
        onChange={async (e) => {
          const to = Number(e.target.value)
          setBusy(true)
          try {
            await onChange(statusForStage(to, stages.length) as TaskStatus, to)
          } finally {
            setBusy(false)
          }
        }}
        className="cursor-pointer appearance-none rounded-lg bg-transparent py-0.5 pr-2 pl-6 font-mono text-[12px] text-inherit outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {offered.map(({ name, i }) => (
          <option key={`${i}-${name}`} value={i}>
            {name}
          </option>
        ))}
      </select>
    </span>
  )
}
