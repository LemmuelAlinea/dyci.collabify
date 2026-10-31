import { formatDay } from '../../lib/general/dates'
import type { Milestone } from '../../lib/work/types'

/** The narrowest a milestone's slot gets before the chart scrolls sideways. */
const SLOT = 104

function Dot({ reached, running }: { reached: boolean; running?: boolean }) {
  if (running) {
    return (
      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-visible">
        <span className="block h-[18px] w-[18px] shrink-0 rounded-full border-[5px] border-warning-500 surface ring-4 ring-warning-500/25" />
      </span>
    )
  }
  return (
    <span
      className={`block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-navy-600 dark:border-navy-300 ${
        reached ? 'bg-navy-600 dark:bg-navy-300' : 'surface'
      }`}
    />
  )
}

function Label({ m, align, running }: { m: Milestone; align: 'center' | 'left'; running?: boolean }) {
  return (
    <span className={`block min-w-0 ${align === 'center' ? 'text-center' : 'text-left'}`}>
      <span className="line-clamp-2 text-[13px] leading-snug font-medium text-ink group-hover:underline">{m.name}</span>
      <span className={`block font-mono text-[11px] ${running ? 'text-warning-700 dark:text-warning-300' : 'text-faint'}`}>{formatDay(m.due_on)}{running && ' · Sprint running'}</span>
    </span>
  )
}

/**
 * Every milestone on one line, evenly spaced in date order, names taking turns
 * above and below so neighbours never collide. A filled dot is reached. On a
 * phone the line runs down the page instead. Picking one shows its card. The
 * milestone the running sprint counts toward is highlighted.
 */
export function MilestoneChart({
  milestones,
  isReached,
  runningId,
  onPick,
}: {
  /** Already in date order. */
  milestones: Milestone[]
  isReached: (m: Milestone) => boolean
  /** The milestone the running sprint counts toward, if any. */
  runningId?: string | null
  onPick: (id: string) => void
}) {
  const n = milestones.length
  if (n === 0) return null
  const say = (m: Milestone) =>
    `${m.name}, due ${formatDay(m.due_on)}, ${isReached(m) ? 'reached' : 'not reached yet'}${m.id === runningId ? ', the running sprint counts toward it' : ''}. Show its card.`

  return (
    <section aria-label="Milestone timeline" className="card p-4 shadow-card">
      <p className="eyebrow mb-2 text-faint">Timeline</p>

      <div className="hidden overflow-x-auto sm:block">
        <ol className="relative h-[184px]" style={{ minWidth: (n + 1) * SLOT }}>
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-[var(--line-strong)]" />
          {milestones.map((m, i) => {
            const above = i % 2 === 0
            return (
              <li
                key={m.id}
                className="absolute -translate-x-1/2"
                style={{
                  // Each half reaches 7px past the line, so the dot sits centred on it.
                  ...(above ? { top: 0, bottom: 'calc(50% - 7px)' } : { top: 'calc(50% - 7px)', bottom: 0 }),
                  // n + 1 slots with a dot between each pair, so the end labels stay inside.
                  left: `${((i + 1) / (n + 1)) * 100}%`,
                  // Same-side labels sit two slots apart, so each may use two slots' width.
                  width: `min(220px, calc(${200 / (n + 1)}% - 12px))`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onPick(m.id)}
                  aria-label={say(m)}
                  className={`group flex h-full w-full items-center rounded-lg ${above ? 'flex-col-reverse' : 'flex-col'}`}
                >
                  <Dot reached={isReached(m)} running={m.id === runningId} />
                  <span aria-hidden className="h-6 w-px shrink-0 bg-[var(--line-strong)]" />
                  <span className={`w-full ${above ? 'mb-1' : 'mt-1'}`}>
                    <Label m={m} align="center" running={m.id === runningId} />
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <ol className="relative space-y-3 sm:hidden">
        <span aria-hidden className="absolute top-2 bottom-2 left-[6px] w-px bg-[var(--line-strong)]" />
        {milestones.map((m) => (
          <li key={m.id} className="relative">
            <button type="button" onClick={() => onPick(m.id)} aria-label={say(m)} className="group flex w-full items-start gap-3 rounded-lg">
              <span className="mt-1">
                <Dot reached={isReached(m)} running={m.id === runningId} />
              </span>
              <Label m={m} align="left" running={m.id === runningId} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
