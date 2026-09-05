import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Modal } from '../ui/Modal'
import { SeriesScope } from './SeriesScope'
import type { SeriesMember } from '../../lib/types'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Anything done to a project that runs in several sections, asked once: which
 * sections, then do it.
 *
 * The scope defaults to the section being looked at and nothing else. That is
 * deliberate — a professor arrives here to close 9A or to extend 9A, and the
 * damaging mistake is the one that quietly reaches the three sections that
 * asked for nothing. Ticking the rest is one press away.
 */
export function SeriesActionDialog({
  open,
  onClose,
  members,
  current,
  title,
  body,
  confirmLabel,
  verb,
  deadline,
  defaultDue,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  members: SeriesMember[]
  current: string
  title: string
  body: string
  confirmLabel: string
  /** Filled into the scope line: "close", "reopen", "move". */
  verb: string
  /** Set to ask for a new deadline as well as a scope. */
  deadline?: boolean
  defaultDue?: string | null
  onConfirm: (targets: string[], dueAt: string | null) => Promise<void>
}) {
  const [scope, setScope] = useState<string[]>([])
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setScope([])
    setDue(toLocalInput(defaultDue ?? null))
    setError(null)
  }, [open, defaultDue])

  async function run() {
    setError(null)
    setBusy(true)
    try {
      const targets = [current, ...scope.filter((id) => id !== current)]
      await onConfirm(targets, deadline ? (due ? new Date(due).toISOString() : null) : null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="md"
      focusField={deadline}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} loading={busy} className="!rounded-xl">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {deadline && (
          <Field label="New deadline" optional>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            )}
          </Field>
        )}
        {deadline && !due && (
          <p className="-mt-2 text-[12.5px] text-faint">
            Left empty, the sections you tick end up with no deadline at all.
          </p>
        )}

        <SeriesScope
          members={members}
          current={current}
          chosen={scope}
          onChange={setScope}
          verb={verb}
        />
      </div>
    </Modal>
  )
}
