import { useMemo } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { fullName } from '../../lib/types'
import type { ArrangementGroup, PickableStudent } from '../../lib/api/groups'

export type Draft = ArrangementGroup

export function ManualBuilder({
  students,
  drafts,
  onChange,
}: {
  students: PickableStudent[]
  drafts: Draft[]
  onChange: (next: Draft[]) => void
}) {
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const assigned = useMemo(() => new Set(drafts.flatMap((d) => d.students)), [drafts])
  const unassigned = students.filter((s) => !assigned.has(s.id))

  function update(index: number, patch: Partial<Draft>) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  function addGroup() {
    onChange([
      ...drafts,
      {
        name: `Group ${drafts.length + 1}`,
        member_limit: drafts[0]?.member_limit ?? 5,
        students: [],
      },
    ])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-muted">
          {unassigned.length === 0
            ? 'Everyone is placed.'
            : `${unassigned.length} student${unassigned.length === 1 ? '' : 's'} still unplaced`}
        </p>
        <Button variant="outline" size="sm" className="!rounded-lg" onClick={addGroup}>
          <Icon name="plus" size={15} />
          Add group
        </Button>
      </div>

      <div className="space-y-3">
        {drafts.map((d, i) => {
          const full = d.students.length >= d.member_limit
          return (
            <div key={i} className="rounded-card border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  aria-label={`Group ${i + 1} name`}
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold text-ink hover:border-[var(--line)] focus:border-navy-400 focus:outline-none"
                />
                <span className="font-mono text-[11.5px] text-faint">
                  {d.students.length}/{d.member_limit}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(drafts.filter((_, n) => n !== i))}
                  aria-label={`Remove ${d.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>

              {d.students.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {d.students.map((sid) => {
                    const p = byId.get(sid)
                    if (!p) return null
                    return (
                      <li
                        key={sid}
                        className="flex items-center gap-2 rounded-full surface-sunken py-1 pr-1 pl-1.5"
                      >
                        <Avatar profile={p} size={22} />
                        <span className="text-[12.5px] text-ink">
                          {p.last_name}, {p.first_name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            update(i, { students: d.students.filter((x) => x !== sid) })
                          }
                          aria-label={`Remove ${fullName(p)}`}
                          className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-ink"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="mt-3">
                <Select
                  aria-label={`Add a student to ${d.name}`}
                  value=""
                  disabled={full || unassigned.length === 0}
                  onChange={(e) => {
                    if (!e.target.value) return
                    update(i, { students: [...d.students, e.target.value] })
                  }}
                  placeholder={
                    full
                      ? 'Group is full'
                      : unassigned.length === 0
                        ? 'Everyone is placed'
                        : 'Add a student…'
                  }
                  options={unassigned.map((s) => ({
                    value: s.id,
                    label: `${s.last_name}, ${s.first_name}`,
                  }))}
                  className="!h-10 text-[13.5px]"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
