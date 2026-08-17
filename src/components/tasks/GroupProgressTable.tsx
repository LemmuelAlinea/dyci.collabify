import { Icon } from '../ui/Icon'
import type { BoardSummary } from '../../lib/types'

/** Where every group stands. Counts only until batch 2 weighs them. */
export function GroupProgressTable({
  boards,
  onOpen,
}: {
  boards: BoardSummary[]
  onOpen: (board: BoardSummary) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] tracking-wide text-faint uppercase">
            <th className="py-2.5 pr-3 font-medium">Group</th>
            <th className="py-2.5 pr-3 font-medium">Tasks</th>
            <th className="py-2.5 pr-3 font-medium">Doing</th>
            <th className="py-2.5 pr-3 font-medium">Unclaimed</th>
            <th className="py-2.5 pr-3 font-medium">Done</th>
            <th className="py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody>
          {boards.map((b) => {
            // Weighted, not counted: a group can finish most of its tasks and
            // still be short of the project.
            const pct = Number(b.done_pct)
            return (
              <tr
                key={b.id}
                className="border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)]"
              >
                <td className="py-3 pr-3">
                  <p className="text-[14px] font-medium text-ink">
                    {b.group_name ?? 'One student'}
                  </p>
                  {b.group_id && (
                    <p className="text-[12px] text-faint">
                      {b.member_count} member{b.member_count === 1 ? '' : 's'}
                    </p>
                  )}
                </td>
                <td className="py-3 pr-3 font-mono text-[13px] text-muted">{b.task_count}</td>
                <td className="py-3 pr-3 font-mono text-[13px] text-muted">{b.doing_count}</td>
                <td
                  className={`py-3 pr-3 font-mono text-[13px] ${
                    b.unclaimed_count > 0
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-faint'
                  }`}
                >
                  {b.unclaimed_count}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full surface-sunken">
                      <span
                        className="block h-full rounded-full bg-amber-400 transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="font-mono text-[12px] text-muted">{pct}%</span>
                  </div>
                </td>
                <td className="py-3">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    className="flex items-center gap-1 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
                  >
                    Open
                    <Icon name="chevronRight" size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
