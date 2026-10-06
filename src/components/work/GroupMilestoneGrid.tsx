import { StatusPill } from './MilestoneBits'
import { useNow } from '../../hooks/useNow'
import { formatDay } from '../../lib/general/dates'
import { milestoneGrid } from '../../lib/work/summary'
import type { Milestone, MilestoneGroup } from '../../lib/work/types'

/**
 * Every group against every milestone, for a professor: one row per group,
 * one column per milestone in date order. A cell is that group's tagged tasks
 * done, with the status the Milestones page shows. It scrolls inside its own
 * box, so a long run of milestones never widens the page.
 */
export function GroupMilestoneGrid({
  milestones,
  groups,
  who,
  onOpenGroup,
  onSetMilestones,
}: {
  milestones: Milestone[]
  groups: MilestoneGroup[]
  /** 'group' or 'student', for the copy. */
  who: string
  onOpenGroup: (id: string) => void
  onSetMilestones: () => void
}) {
  const now = useNow()
  const grid = milestoneGrid(milestones, groups, now)

  if (grid.milestones.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        No milestones yet.{' '}
        <button
          type="button"
          onClick={onSetMilestones}
          className="font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          Set them in Milestones
        </button>{' '}
        to follow each {who} against them.
      </p>
    )
  }
  if (grid.rows.length === 0) {
    return <p className="text-[13px] text-muted">No {who} has a board yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-panel border border-line surface">
      <table aria-label={`Milestones by ${who}`} className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="surface-sunken">
            <th scope="col" className="sticky left-0 z-10 surface-sunken px-3 py-2 text-left font-medium text-muted">
              {who === 'student' ? 'Student' : 'Group'}
            </th>
            {grid.milestones.map((m) => (
              <th key={m.id} scope="col" className="px-3 py-2 text-left font-medium">
                <span className="block max-w-[10rem] truncate text-ink" title={m.name}>{m.name}</span>
                <span className="block font-mono text-[11px] font-normal text-faint">{formatDay(m.due_on)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {grid.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky left-0 z-10 surface px-3 py-2 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onOpenGroup(r.id)}
                  title={r.name}
                  className="block max-w-[12rem] truncate text-ink hover:underline"
                >
                  {r.name}
                </button>
              </th>
              {r.cells.map((c) => (
                <td key={c.milestoneId} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-10 font-mono text-[12px] text-faint">
                      {c.total ? `${c.done}/${c.total}` : <span aria-label="No tasks tagged">—</span>}
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
