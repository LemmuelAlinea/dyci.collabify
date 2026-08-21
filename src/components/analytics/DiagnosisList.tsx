import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { boardCauses } from '../../lib/insight'
import type { BoardDiagnosis } from '../../lib/insight'

/**
 * Why each board is where it is.
 *
 * One card per board that has something wrong with it, and every line inside is
 * a measured fact with its number. Nothing is inferred about people: the
 * database knows that four tasks are unclaimed and that nothing has moved for
 * nine days, and it does not know that a group has fallen out.
 *
 * Boards with nothing to explain are not listed at all — a card saying "no
 * problems found" is noise between the ones that matter.
 */
export function DiagnosisList({ rows }: { rows: BoardDiagnosis[] }) {
  const diagnosed = rows
    .map((d) => ({ d, causes: boardCauses(d) }))
    .filter(({ causes }) => causes.length > 0)
    .sort((a, b) => b.causes[0].weight - a.causes[0].weight)

  if (diagnosed.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Nothing to explain"
        body="No board in view has unclaimed work, a stall, a return nobody acted on, or one person carrying it."
      />
    )
  }

  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {diagnosed.map(({ d, causes }) => (
        <li
          key={d.board_id}
          className="surface rounded-card border border-line p-4 shadow-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">{d.project_title}</p>
              <h3 className="mt-0.5 truncate text-[15px] font-medium text-ink">
                {d.owner_name ?? 'A board'}
              </h3>
            </div>
            <span className="shrink-0 font-mono text-[13px] text-muted">
              {d.done_count}/{d.task_count}
            </span>
          </div>

          <ul className="mt-3 space-y-1.5">
            {causes.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-[13px] leading-relaxed">
                <Icon
                  name={c.weight >= 70 ? 'alert' : 'info'}
                  size={13}
                  className={`mt-[3px] shrink-0 ${
                    c.weight >= 70
                      ? 'text-red-600 dark:text-red-400'
                      : c.weight >= 55
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-faint'
                  }`}
                />
                <span className="text-muted">{c.text}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
