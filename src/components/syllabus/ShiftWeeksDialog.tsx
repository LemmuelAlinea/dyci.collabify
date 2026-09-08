import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { describeShift, shiftDays } from '../../lib/termShift'
import type { ClassWeek } from '../../lib/types'
import { LIMIT } from '../../lib/limits'

/**
 * Where a professor answers a typhoon.
 *
 * The date input is the whole interface: this week starts here now. The delta
 * is derived rather than typed, because "move it to the 26th" is what somebody
 * actually knows and "+7 days" is arithmetic they should not have to do at the
 * end of a week the school was shut.
 *
 * The sentence under the input is the safety net. A date picker gives no sense
 * of blast radius, and the difference between fixing one disruption and
 * re-dating two thirds of a term is exactly what it says out loud before the
 * button is pressed.
 */
export function ShiftWeeksDialog({
  week,
  weeksAfter,
  onClose,
  onShift,
}: {
  week: ClassWeek
  /** How many weeks move, this one included. Only used to say so. */
  weeksAfter: number
  onClose: () => void
  onShift: (days: number, reason: string) => Promise<void>
}) {
  const current = week.week_start ?? ''
  const [next, setNext] = useState(current)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = next ? shiftDays(current, next) : 0
  const ready = days !== 0 && reason.trim().length > 0

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onShift(days, reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the weeks.')
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Move week ${week.week_no}`}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <p className="text-[13.5px] leading-relaxed text-muted">
          Week {week.week_no}
          {week.title ? ` · ${week.title}` : ''} currently starts on{' '}
          <strong className="text-ink">{longDay(current)}</strong>.
          {/* Week 1 has nothing before it, and saying so anyway reads as a
              sentence nobody checked. */}
          {week.week_no > 1 && ' Weeks before it stay where they are.'}
        </p>

        <Field label="It should start on">
          {(id) => (
            <Input id={id} type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          )}
        </Field>

        {/* The blast radius, said before the button rather than after. */}
        <p
          className={`text-[13px] leading-relaxed ${
            days === 0 ? 'text-faint' : 'font-medium text-ink'
          }`}
        >
          {describeShift(days, weeksAfter)}
        </p>

        <Field label="Why">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={LIMIT.shiftReason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Typhoon Kristine — classes suspended"
            />
          )}
        </Field>

        {/* Students read this on the week map. Somebody who planned around the
            old date is owed the reason, not just the new date. */}
        <p className="text-[12px] leading-relaxed text-faint">
          Everyone in the class sees this on the week map.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ready}>
            Move the weeks
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function longDay(value: string) {
  if (!value) return 'no date'
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
