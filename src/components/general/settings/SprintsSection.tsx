// src/components/general/settings/SprintsSection.tsx
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Input, Toggle } from '../../ui/Field'
import { Icon } from '../../ui/Icon'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { saveSprintSettings } from '../../../lib/api/sprints'
import { authErrorMessage } from '../../../lib/authError'
import { startWeekdayOf } from '../../../lib/work/sprintSettings'
import type { SprintCarry } from '../../../lib/work/sprintSettings'
import type { GeneralProjectState } from '../useGeneralProject'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label }))

const CARRY_LABELS: Record<SprintCarry, string> = {
  ask: 'Ask on finish',
  next: 'Move to the next sprint',
  backlog: 'Return to the backlog',
}

const LENGTH_ERROR = 'Use a length from 1 to 90 days.'
const AUTO_MOVED = 'Unfinished tasks will move to the next sprint. You can choose the backlog instead.'

/** "09:30" reads "9:30 AM". */
function timeLabel(value: string) {
  const [h, m] = value.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
  return { value, label: timeLabel(value) }
})

export function SprintsSection({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const saved = state.sprintSettings
  const editable = !state.readOnly && (state.myRole === 'pm' || state.myRole === 'coordinator')

  const [autoFinish, setAutoFinish] = useState(saved.autoFinish)
  const [autoStart, setAutoStart] = useState(saved.autoStart)
  const [carry, setCarry] = useState<SprintCarry>(saved.carry)
  const [length, setLength] = useState(String(saved.lengthDays))
  // Null stays derived from the first sprint until somebody picks a day.
  const [weekday, setWeekday] = useState<number | null>(saved.startWeekday)
  const [runAt, setRunAt] = useState(saved.runAt)
  const [autoMoved, setAutoMoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lengthError, setLengthError] = useState<string | null>(null)

  const lengthId = useId()
  const carryId = useId()
  const dayId = useId()
  const timeId = useId()
  const orgHelpId = useId()

  // Reset when the saved row changes underneath, not on every realtime reload
  // while somebody is editing.
  const key = JSON.stringify(saved)
  useEffect(() => {
    setAutoFinish(saved.autoFinish)
    setAutoStart(saved.autoStart)
    setCarry(saved.carry)
    setLength(String(saved.lengthDays))
    setWeekday(saved.startWeekday)
    setRunAt(saved.runAt)
    setAutoMoved(false)
    setLengthError(null)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const timeOptions = TIME_OPTIONS.some((o) => o.value === runAt)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value: runAt, label: timeLabel(runAt) }].sort((a, b) => a.value.localeCompare(b.value))
  const carryOptions = (Object.keys(CARRY_LABELS) as SprintCarry[]).map((value) => ({
    value,
    label: CARRY_LABELS[value],
    // The database refuses auto-finish together with "Ask on finish".
    disabled: autoFinish && value === 'ask',
  }))
  const shownDay = weekday ?? startWeekdayOf(saved, state.sprints)

  function toggleAutoFinish(next: boolean) {
    setAutoFinish(next)
    // The database refuses auto-finish with "Ask on finish", so the pair never forms.
    if (next && carry === 'ask') {
      setCarry('next')
      setAutoMoved(true)
    } else if (!next) {
      setAutoMoved(false)
    }
  }

  async function save() {
    if (!state.project) return
    setError(null)
    const days = Number(length)
    if (length.trim() === '' || !Number.isInteger(days) || days < 1 || days > 90) {
      return setLengthError(LENGTH_ERROR)
    }
    setLengthError(null)
    setBusy(true)
    try {
      await saveSprintSettings(state.project.id, {
        autoFinish,
        autoStart,
        carry: autoFinish && carry === 'ask' ? 'next' : carry,
        lengthDays: days,
        startWeekday: weekday,
        runAt,
      })
      await state.reload()
      show('Sprint settings saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the sprint settings.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2">
        <h2>Sprints</h2>
        <p className="mt-0.5 text-[12px] text-muted">How this project's sprints start, run and finish.</p>
      </header>

      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        <Row title="Sprint organization" help="One sprint runs at a time." helpId={orgHelpId}>
          <div
            role="radiogroup"
            aria-label="Sprint organization"
            aria-describedby={orgHelpId}
            className="flex flex-wrap gap-2"
          >
            <Choice selected label="Sequential" disabled={!editable} />
            <Choice label="Multiple sprint streams · soon" disabled />
            <Choice label="Flexible parallel · soon" disabled />
          </div>
        </Row>

        <Row title="Finish sprints automatically" help="When the end date passes, at the time below.">
          <Toggle
            label="Finish sprints automatically"
            checked={autoFinish}
            onChange={toggleAutoFinish}
            disabled={!editable || busy}
          />
        </Row>

        <Row
          title="Start the next sprint automatically"
          help="Creates the next sprint if none is planned. Never makes a duplicate, and never starts one after the project's due date."
        >
          <Toggle
            label="Start the next sprint automatically"
            checked={autoStart}
            onChange={setAutoStart}
            disabled={!editable || busy}
          />
        </Row>

        <Row
          title="Unfinished tasks at finish"
          htmlFor={carryId}
          help="Where tasks that are not done go."
          note={autoMoved ? AUTO_MOVED : undefined}
        >
          <Select
            id={carryId}
            value={carry}
            onChange={(e) => {
              setCarry(e.target.value as SprintCarry)
              setAutoMoved(false)
            }}
            disabled={!editable || busy}
            options={carryOptions}
          />
        </Row>

        <Row title="Default sprint length" htmlFor={lengthId}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Input
                id={lengthId}
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                step={1}
                value={length}
                onChange={(e) => {
                  setLength(e.target.value)
                  setLengthError(null)
                }}
                aria-invalid={lengthError ? true : undefined}
                disabled={!editable || busy}
              />
            </div>
            <span className="text-[13px] text-muted">days</span>
          </div>
          {lengthError && (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-danger-600 dark:text-danger-400">
              <Icon name="alert" size={14} />
              {lengthError}
            </p>
          )}
        </Row>

        <Row title="Sprint start day" htmlFor={dayId}>
          <Select
            id={dayId}
            value={String(shownDay)}
            onChange={(e) => setWeekday(Number(e.target.value))}
            disabled={!editable || busy}
            options={DAY_OPTIONS}
          />
        </Row>

        <Row title="Start and finish time" htmlFor={timeId} help="Philippine time.">
          <Select
            id={timeId}
            value={runAt}
            onChange={(e) => setRunAt(e.target.value)}
            disabled={!editable || busy}
            options={timeOptions}
          />
        </Row>
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save sprint settings
          </Button>
        </div>
      )}

      <p className="mt-4 text-[12px] text-muted">
        Only the project manager and coordinators can change these. Changes apply to this project only.
      </p>
    </section>
  )
}

/** A label over its control on a phone, the label beside it from `sm` up. */
function Row({
  title,
  help,
  helpId,
  note,
  htmlFor,
  children,
}: {
  title: string
  help?: string
  helpId?: string
  note?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 py-4 first:pt-2 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)] sm:items-center sm:gap-6">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
            {title}
          </label>
        ) : (
          <p className="text-[13px] font-medium text-ink">{title}</p>
        )}
        {help && (
          <p id={helpId} className="mt-0.5 text-[12px] text-muted">
            {help}
          </p>
        )}
        {note && <p className="mt-1 text-[12px] text-muted">{note}</p>}
      </div>
      <div className="min-w-0 sm:justify-self-end sm:w-full">{children}</div>
    </div>
  )
}

/** One option of the segmented organization control. */
function Choice({ label, selected = false, disabled }: { label: string; selected?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-[13px] transition-colors duration-150 disabled:cursor-not-allowed ${
        selected
          ? 'border-navy-600 bg-navy-600 font-medium text-white disabled:opacity-100 dark:border-amber-400 dark:bg-amber-400 dark:text-navy-900'
          : 'border-line-strong text-muted opacity-60'
      }`}
    >
      {label}
    </button>
  )
}
