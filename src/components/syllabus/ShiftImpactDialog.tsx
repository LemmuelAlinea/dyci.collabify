import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import type { ShiftImpact } from '../../lib/api/syllabus'

/**
 * What the shift left stranded, and which of it should follow the term.
 *
 * This step exists because deadlines are not derived from weeks. A professor
 * set them, sometimes to a date the department fixed rather than the syllabus,
 * so moving them all silently would rewrite dates students planned around and
 * occasionally overrule somebody who was not asked.
 *
 * Everything starts ticked. After a typhoon the common case is that the whole
 * term slid together, and the exceptions are few enough to untick — the
 * opposite default would make the honest answer the laborious one.
 */
export function ShiftImpactDialog({
  rows,
  days,
  onClose,
  onApply,
}: {
  rows: ShiftImpact[]
  days: number
  onClose: () => void
  onApply: (projectIds: string[], taskIds: string[]) => Promise<void>
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.ref_id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onApply(
        rows.filter((r) => r.kind === 'project' && picked.has(r.ref_id)).map((r) => r.ref_id),
        rows.filter((r) => r.kind === 'task' && picked.has(r.ref_id)).map((r) => r.ref_id),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the deadlines.')
      setBusy(false)
    }
  }

  const label = Math.abs(days) === 1 ? 'day' : 'days'

  return (
    <Modal open onClose={onClose} title="Deadlines in the range that moved" size="lg">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {/* One sentence, two number agreements. Splitting it word by word gave
            "These deadline fell … and has not moved with it", so the whole
            clause is written twice instead. */}
        <p className="text-[13.5px] leading-relaxed text-muted">
          The weeks have moved.{' '}
          {rows.length === 1
            ? 'This deadline fell in the range that shifted and has not moved with it.'
            : 'These deadlines fell in the range that shifted and have not moved with them.'}{' '}
          Untick anything that should stay where it is.
        </p>

        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-card border border-line">
          {rows.map((row) => {
            const on = picked.has(row.ref_id)
            return (
              <li key={row.ref_id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    disabled={busy}
                    onChange={() => toggle(row.ref_id)}
                  />
                  <span
                    aria-hidden
                    className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] ${
                      on
                        ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-500'
                        : 'border-[var(--control-line)]'
                    }`}
                  >
                    {on && <Icon name="check" size={12} />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">{row.label}</span>
                    <span className="block text-[12px] text-faint">
                      {row.kind === 'task' ? `Task in ${row.parent}` : 'Project'}
                    </span>
                  </span>

                  <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">
                    {shortStamp(row.old_due)}
                    <span aria-hidden className="mx-1.5 text-faint">
                      →
                    </span>
                    <span className={on ? 'text-ink' : 'text-faint line-through'}>
                      {shortStamp(row.new_due)}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Skipping is a real answer, not a way out of the dialog. The weeks
              have already moved either way. */}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Leave them all
          </Button>
          <Button onClick={submit} loading={busy} disabled={picked.size === 0}>
            Move {picked.size} {picked.size === 1 ? 'deadline' : 'deadlines'} {Math.abs(days)}{' '}
            {label} {days > 0 ? 'later' : 'earlier'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function shortStamp(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
