import { Icon } from '../ui/Icon'
import { dueLabel } from './ProjectCard'
import type { SeriesMember } from '../../lib/types'

/**
 * Which sections a change reaches.
 *
 * The section being edited is always in scope and cannot be unticked — it is
 * the page the professor is standing on, and a save that skips it would be a
 * save that appears to do nothing. Every other section is opt-in, which is the
 * whole point: 9A asks for an extension, 9B asked for nothing, and 9B must be
 * able to stay exactly as it is.
 *
 * Each row says the state that section is actually in, because the scope
 * picker is the last thing seen before something is overwritten.
 */
export function SeriesScope({
  members,
  current,
  chosen,
  onChange,
  verb = 'change',
}: {
  members: SeriesMember[]
  /** The project being edited. Always in scope. */
  current: string
  chosen: string[]
  onChange: (next: string[]) => void
  /** What is about to happen, for the summary line: "change", "close", "move". */
  verb?: string
}) {
  if (members.length < 2) return null

  const all = members.map((m) => m.project_id)
  const isOn = (id: string) => id === current || chosen.includes(id)

  function toggle(id: string) {
    if (id === current) return
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])
  }

  const count = chosen.filter((id) => id !== current).length + 1

  return (
    <section className="rounded-xl border border-line surface-sunken p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className=" font-semibold text-ink">Which sections</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            This project runs in {members.length} sections. Only the ones you tick
            {' '}{verb === 'change' ? 'change' : verb}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(all.filter((id) => id !== current))}
            className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink transition-colors hover:bg-[var(--surface)]"
          >
            All {members.length}
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink transition-colors hover:bg-[var(--surface)]"
          >
            This one only
          </button>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {members.map((m) => {
          const on = isOn(m.project_id)
          const here = m.project_id === current
          return (
            <li key={m.project_id}>
              <button
                type="button"
                onClick={() => toggle(m.project_id)}
                disabled={here}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                  on ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12' : 'border-line'
                }`}
              >
                <span
                  className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border ${
                    on
                      ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-500'
                      : 'border-[var(--control-line)]'
                  }`}
                >
                  {on && <Icon name="check" size={11} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {m.class_initial}  ·  {m.section}
                    {here && <span className="ml-2 text-[12px] text-faint">this page</span>}
                  </span>
                  <span className="block truncate text-[12px] text-faint">
                    {dueLabel(m.due_at)}
                    {m.locked_at ? ' · closed' : ''}
                    {m.archived_at ? ' · archived' : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 text-[12px] text-faint">
        {count === 1
          ? 'One section, and the rest are left alone.'
          : `${count} of ${members.length} sections.`}
      </p>
    </section>
  )
}
