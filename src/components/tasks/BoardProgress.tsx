import { Icon } from '../ui/Icon'
import type { BoardSummary } from '../../lib/types'

/**
 * The group's 100, whole. Adding a task does not add points — it shrinks every
 * other slice — so this bar is always the full project, never a running total.
 */
export function BoardProgress({ board }: { board: BoardSummary }) {
  const done = Number(board.done_pct)
  const doing = Number(board.doing_pct)
  const unclaimed = Number(board.unclaimed_pct)
  const left = Math.max(0, 100 - done - doing)

  return (
    <div className="surface rounded-card border border-line p-5 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Group progress</p>
          <p className="mt-2 text-[28px] leading-none font-semibold text-ink">
            {done}
            <span className="ml-0.5 text-[16px] text-muted">%</span>
          </p>
        </div>
        <p className="text-[13px] text-muted">
          {board.done_count} of {board.task_count} tasks · worth{' '}
          <strong className="text-ink">{board.total_points}</strong> points
        </p>
      </div>

      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full surface-sunken">
        <span
          className="bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${done}%` }}
        />
        <span
          className="bg-amber-400 transition-[width] duration-300"
          style={{ width: `${doing}%` }}
        />
        <span className="flex-1" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
        <Legend colour="bg-emerald-500" label="Done" value={done} />
        <Legend colour="bg-amber-400" label="In progress" value={doing} />
        <Legend colour="surface-sunken border border-line" label="Not started" value={left} />
        {unclaimed > 0 && (
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <Icon name="alert" size={13} />
            {unclaimed}% belongs to nobody yet
          </span>
        )}
      </div>
    </div>
  )
}

function Legend({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${colour}`} />
      {label}
      <span className="font-mono text-faint">{Math.round(value * 10) / 10}%</span>
    </span>
  )
}
