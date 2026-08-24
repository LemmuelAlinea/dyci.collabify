import { Avatar } from '../app/Avatar'
import type { Participation } from '../../lib/insight'

/**
 * Who in the class is nowhere near the work.
 *
 * Every other figure on this page is built from what people have produced, so a
 * student who has produced nothing is invisible to all of them — the one the
 * page most needs to name. Enrolled and in no group, or on a board holding
 * nothing, are separate rows because they are separate fixes: one needs a group,
 * the other needs a task.
 *
 * Effort only. What somebody holds and what they finished, never a judgement of
 * either.
 */
export function ParticipationList({ rows }: { rows: Participation[] }) {
  const ungrouped = rows.filter((r) => !r.in_any_group)
  const empty = rows.filter((r) => r.in_any_group && r.tasks_held === 0)
  const working = rows.filter((r) => r.tasks_held > 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <Figure value={working.length} total={rows.length} label="holding work" />
        <Figure value={empty.length} total={rows.length} label="in a group, holding nothing" />
        <Figure value={ungrouped.length} total={rows.length} label="in no group at all" />
      </div>

      {ungrouped.length > 0 && (
        <People
          title="In no group"
          hint="The class has group work out and they are on no board of it."
          rows={ungrouped}
        />
      )}
      {empty.length > 0 && (
        <People
          title="On a board, holding nothing"
          hint="They can see the work and have taken none of it."
          rows={empty}
        />
      )}
    </div>
  )
}

function Figure({ value, total, label }: { value: number; total: number; label: string }) {
  return (
    <div className="surface rounded-card border border-line px-3 py-2.5 shadow-card sm:px-4 sm:py-3">
      <p className="font-mono text-[19px] text-ink">
        {value}
        <span className="text-[13px] text-faint">/{total}</span>
      </p>
      <p className="text-[12px] text-muted">{label}</p>
    </div>
  )
}

function People({
  title,
  hint,
  rows,
}: {
  title: string
  hint: string
  rows: Participation[]
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[14.5px] text-ink">{title}</h3>
        <p className="text-[12.5px] text-muted">{hint}</p>
      </div>
      <ul className="flex max-h-[164px] flex-wrap gap-2 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li
            key={`${r.class_id}-${r.student_id}`}
            className="surface flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3"
          >
            <Avatar
              profile={{
                first_name: r.student_name.split(' ')[0] ?? '',
                last_name: r.student_name.split(' ').slice(1).join(' '),
                avatar_url: r.avatar_url,
              }}
              size={24}
            />
            <span className="text-[13px] text-ink">{r.student_name}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
