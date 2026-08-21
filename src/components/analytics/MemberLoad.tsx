import { useMemo } from 'react'
import { Avatar } from '../app/Avatar'
import { EmptyState } from '../ui/Tabs'
import { CARRYING_ALONE_PCT } from '../../lib/types'
import type { MemberLoad as Load } from '../../lib/types'

/**
 * Who is doing the work, by name.
 *
 * Effort only — held and finished. No verdict, no feedback, no mark: this
 * answers who is carrying a group, not who deserves what, and mixing the two on
 * one page would quietly turn participation into a grade.
 *
 * A free-rider is invisible one level up. A group at eighty per cent looks
 * healthy whether five people did it or one did.
 */
export function MemberLoad({ rows }: { rows: Load[] }) {
  const { alone, idle } = useMemo(() => {
    // Only meaningful on a board somebody has actually started.
    const started = rows.filter((r) => r.group_size > 1)
    return {
      alone: started
        .filter((r) => Number(r.held_pct) >= CARRYING_ALONE_PCT)
        .sort((a, b) => Number(b.held_pct) - Number(a.held_pct)),
      idle: started
        .filter((r) => Number(r.held_pct) === 0)
        .sort((a, b) => a.student_name.localeCompare(b.student_name)),
    }
  }, [rows])

  if (alone.length === 0 && idle.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="The work is spread"
        body="Nobody is carrying a group alone, and nobody is holding nothing."
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Column
        title="Carrying a group"
        hint={`Holding ${CARRYING_ALONE_PCT}% or more of a board on their own.`}
        rows={alone}
        tone="amber"
      />
      <Column
        title="Holding nothing"
        hint="On a group board with no task claimed."
        rows={idle}
        tone="plain"
      />
    </div>
  )
}

function Column({
  title,
  hint,
  rows,
  tone,
}: {
  title: string
  hint: string
  rows: Load[]
  tone: 'amber' | 'plain'
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">
          {title}
          <span className="ml-1.5 font-mono text-[12px] font-normal text-faint">
            {rows.length}
          </span>
        </h3>
        <p className="text-[12.5px] text-muted">{hint}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-center text-[13px] text-muted">
          Nobody.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={`${r.board_id}-${r.student_id}`}
              className="surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5"
            >
              <Avatar
                profile={{
                  // student_name is already the joined "first last"; split it
                  // back so the initials fall out the same way everywhere else.
                  first_name: r.student_name.split(' ')[0] ?? '',
                  last_name: r.student_name.split(' ').slice(1).join(' '),
                  avatar_url: r.avatar_url,
                }}
                size={30}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{r.student_name}</span>
                <span className="block truncate text-[12px] text-faint">
                  {r.group_name} · {r.project_title}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[11.5px] ${
                  tone === 'amber'
                    ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                    : 'surface-sunken text-muted'
                }`}
              >
                {Number(r.held_pct)}% held
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-faint">
                {r.done_count}/{r.task_count} done
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
