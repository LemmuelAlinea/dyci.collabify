import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { deleteTimeOff, listMyTimeOff, saveTimeOff } from '../../lib/api/workload'
import type { TimeOff } from '../../lib/api/workload'
import { formatDayLabel, formatHours, manilaToday, parseHours } from '../../lib/work/hours'

/** Settings → Profile: days or hours off that lower the hours a planner counts on. */
export function TimeOffSetting() {
  const [items, setItems] = useState<TimeOff[] | null>(null)
  const [date, setDate] = useState('')
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listMyTimeOff(manilaToday()))
    } catch {
      setItems([])
      setError("We couldn't load your time off. Reload the page to try again.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    setError(null)
    if (!date) {
      setError('Pick the day you are off.')
      return
    }
    const minutes = parseHours(hours)
    if (minutes === 'invalid') {
      setError('Enter hours as a number, like 4 or 2.5, or leave it empty for the whole day.')
      return
    }
    if (minutes !== null && minutes > 1440) {
      setError('Enter up to 24 hours for one day.')
      return
    }
    setBusy(true)
    try {
      await saveTimeOff(date, minutes)
      setDate('')
      setHours('')
      await load()
    } catch {
      setError("We couldn't save that. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await deleteTimeOff(id)
      await load()
    } catch {
      setError("We couldn't remove that. Try again.")
    }
  }

  return (
    <div className="mt-6 space-y-3 border-t border-line pt-5">
      <div className="flex min-w-0 gap-3">
        <Icon name="calendar" size={18} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">Time off</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            Planners in your spaces see only the hours you have off, never a reason. Leave hours empty
            to take the whole day.
          </p>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="text-ink">
                {formatDayLabel(t.off_on)} · {t.minutes === null ? 'Full day' : formatHours(t.minutes)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(t.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Day">
          {(id) => (
            <Input id={id} type="date" min={manilaToday()} value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Field label="Hours off" optional>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              placeholder="Whole day"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          )}
        </Field>
        <Button type="button" loading={busy} onClick={() => void add()}>
          Add time off
        </Button>
      </div>
    </div>
  )
}
