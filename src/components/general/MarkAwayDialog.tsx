import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { saveTimeOffRange } from '../../lib/api/workload'
import { authErrorMessage } from '../../lib/authError'
import { manilaToday, parseHours } from '../../lib/work/hours'

/**
 * A space planner marks someone away: first and last day (a best guess is fine,
 * it can be extended), whole days or some hours each day. Never a reason.
 */
export function MarkAwayDialog({
  open,
  userId,
  name,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  userId: string
  name: string
  /** The leave being extended, if any. */
  initial?: { from: string; to: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [from, setFrom] = useState(initial?.from ?? '')
  const [to, setTo] = useState(initial?.to ?? '')
  const [hours, setHours] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFrom(initial?.from ?? '')
    setTo(initial?.to ?? '')
    setHours('')
    setError(null)
  }, [open, initial?.from, initial?.to])

  async function save() {
    setError(null)
    if (!from || !to) {
      setError('Pick the first and last day away.')
      return
    }
    if (to < from) {
      setError('Choose a start date on or before the end date.')
      return
    }
    const minutes = parseHours(hours)
    if (minutes === 'invalid' || (minutes !== null && minutes > 1440)) {
      setError('Enter hours as a number up to 24, or leave it empty for whole days.')
      return
    }
    setSaving(true)
    try {
      await saveTimeOffRange(userId, from, to, minutes)
      onSaved()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not mark them away. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark ${name} away`}
      description="Only the dates are shared with the space, never a reason."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Mark away</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day">
            {(id) => (
              <Input id={id} type="date" aria-label="First day away" min={initial?.from ?? manilaToday()} value={from} onChange={(e) => setFrom(e.target.value)} />
            )}
          </Field>
          <Field label="Last day">
            {(id) => (
              <Input id={id} type="date" aria-label="Last day away" min={from || manilaToday()} value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
        </div>
        <p className="-mt-2 text-[12px] text-muted">Best guess is fine. You can extend it.</p>
        <Field label="Hours away each day" optional>
          {(id) => (
            <Input id={id} inputMode="decimal" aria-label="Hours away each day" placeholder="Whole days" value={hours} onChange={(e) => setHours(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  )
}
