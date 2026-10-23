import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import type { MilestoneInput, Sprint } from '../../lib/work/types'

/** What creating one milestone per sprint needs; left out when editing or with no sprints. */
export type PerSprint = {
  sprints: Sprint[]
  /** The milestone a sprint already counts toward, by name. */
  nameOf: (milestoneId: string) => string | undefined
  /** Make one milestone for the sprint and count it toward it. */
  create: (sprint: Sprint, description: string) => Promise<unknown>
}

/**
 * Create or edit a milestone. The parent passes a `key` that changes per
 * milestone, so the fields start from `initial` each time it opens. With
 * `perSprint`, it can instead make one milestone per sprint, each named after
 * its sprint, due when the sprint ends, and counting the sprint toward it.
 */
export function MilestoneDialog({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  onSubmit,
  perSprint,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: MilestoneInput
  onSubmit: (input: MilestoneInput) => Promise<unknown>
  perSprint?: PerSprint
}) {
  const [mode, setMode] = useState<'one' | 'sprints'>('one')
  const [name, setName] = useState(initial.name)
  const [dueOn, setDueOn] = useState(initial.dueOn)
  const [description, setDescription] = useState(initial.description)
  // A sprint already counting toward a milestone starts unchecked; checking it moves it.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(perSprint?.sprints.filter((s) => !s.milestone_id).map((s) => s.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bySprint = perSprint && mode === 'sprints'
  const chosen = perSprint?.sprints.filter((s) => picked.has(s.id)) ?? []

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    setError(null)
    if (bySprint) return saveEach()
    if (!name.trim()) return setError('A milestone needs a name.')
    if (!dueOn) return setError('A milestone needs a due date.')
    setBusy(true)
    try {
      await onSubmit({ name, description, dueOn })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the milestone.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveEach() {
    if (!perSprint || chosen.length === 0) return setError('Pick at least one sprint.')
    setBusy(true)
    const done: string[] = []
    try {
      for (const s of chosen) {
        await perSprint.create(s, description)
        done.push(s.id)
      }
      onClose()
    } catch (err) {
      // Done ones leave the list, so trying again only makes the rest.
      setPicked((prev) => new Set([...prev].filter((id) => !done.includes(id))))
      const made = done.length
      const left = chosen.length - made
      setError(
        authErrorMessage(
          err,
          made > 0
            ? `Added ${made} of ${chosen.length} milestones. Try again to add the other ${left}.`
            : 'Could not add the milestones.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={bySprint && chosen.length === 0}>
            {bySprint
              ? chosen.length === 1
                ? 'Add 1 milestone'
                : `Add ${chosen.length} milestones`
              : submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {perSprint && (
          <div className="surface-sunken flex gap-1 rounded-lg p-0.5">
            {(
              [
                ['one', 'One milestone'],
                ['sprints', 'One per sprint'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                  mode === value ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {bySprint ? (
          <div>
            <p className="mb-2 text-[13px] text-muted">
              Each sprint gets a milestone with its name, due the day it ends. Its tasks count toward it.
            </p>
            <ul className="max-h-[40vh] divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-line">
              {perSprint.sprints.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-navy-600)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{s.name}</span>
                      <span className="block font-mono text-[12px] text-faint">
                        Due {formatDay(s.ends_on)}
                        {s.state === 'active' ? ' · running' : ''}
                      </span>
                      {s.milestone_id && (
                        <span className="block text-[12px] text-faint">
                          Counts toward {perSprint.nameOf(s.milestone_id) ?? 'another milestone'}
                          {picked.has(s.id) ? '; moves to the new one' : ''}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <Field label="Name">
              {(id) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Due">
              {(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
            </Field>
          </>
        )}
        <Field
          label="Description"
          optional
          hint={
            <span className="text-[12px] text-faint">
              {bySprint ? 'Goes on every milestone added. ' : ''}What reaching it means, in a sentence.
            </span>
          }
        >
          {(id) => <Textarea id={id} rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
