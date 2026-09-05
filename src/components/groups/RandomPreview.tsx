import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import type { Draft } from './ManualBuilder'
import type { PickableStudent } from '../../lib/api/groups'

export function RandomPreview({
  students,
  groupCount,
  limit,
  drafts,
  onCountChange,
  onLimitChange,
  onShuffle,
}: {
  students: PickableStudent[]
  groupCount: number
  limit: number
  drafts: Draft[]
  onCountChange: (n: number) => void
  onLimitChange: (n: number) => void
  onShuffle: () => void
}) {
  const capacity = groupCount * limit
  const tooSmall = capacity < students.length

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Number of groups">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={50}
              value={groupCount}
              onChange={(e) => onCountChange(Math.max(1, Number(e.target.value) || 1))}
            />
          )}
        </Field>
        <Field label="Members per group">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => onLimitChange(Math.max(1, Number(e.target.value) || 1))}
            />
          )}
        </Field>
      </div>

      <p className="text-[13px] text-muted">
        {students.length} student{students.length === 1 ? '' : 's'} in this class · room for{' '}
        {capacity}
      </p>

      {tooSmall && (
        <Alert tone="error">
          {groupCount} groups of {limit} holds {capacity} students, but the class has{' '}
          {students.length}. Raise either number before shuffling.
        </Alert>
      )}

      <Button
        variant="outline"
        full
        className="!rounded-xl"
        disabled={tooSmall || students.length === 0}
        onClick={onShuffle}
      >
        <Icon name="refresh" size={16} />
        {drafts.length ? 'Reshuffle' : 'Shuffle students'}
      </Button>

      {drafts.length > 0 && (
        <>
          <p className="text-[12.5px] text-faint">
            Nothing is saved until you choose Create. Reshuffle as many times as you like.
          </p>
          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="rounded-xl border border-line p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[14.5px] font-semibold text-ink">{d.name}</p>
                  <span className="font-mono text-[11.5px] text-faint">
                    {d.students.length}/{d.member_limit}
                  </span>
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-2">
                  {d.students.map((sid) => {
                    const p = students.find((s) => s.id === sid)
                    if (!p) return null
                    return (
                      <li
                        key={sid}
                        className="flex items-center gap-1.5 rounded-full surface-sunken py-1 pr-2.5 pl-1"
                      >
                        <Avatar profile={p} size={20} />
                        <span className="text-[12px] text-ink">
                          {p.last_name}, {p.first_name}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
