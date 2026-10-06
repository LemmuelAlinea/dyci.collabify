import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { authErrorMessage } from '../../lib/authError'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

/** Pick unfinished tasks to count toward a milestone. A task can count toward one milestone at a time. */
export function TagTasksDialog({
  open,
  onClose,
  milestone,
  source,
}: {
  open: boolean
  onClose: () => void
  milestone: Milestone
  source: MilestoneSource
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const candidates = source.items.filter((i) => i.status !== 'done' && i.milestone_id !== milestone.id)
  const chosen = candidates.filter((c) => picked.has(c.id))
  const nameOf = (id: string | null) => source.milestones.find((m) => m.id === id)?.name

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    setError(null)
    setBusy(true)
    try {
      await source.tag(chosen.map((c) => c.id), milestone.id)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not tag those tasks.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Tasks for ${milestone.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={chosen.length === 0}>
            {chosen.length === 0 ? 'Tag tasks' : `Tag ${chosen.length} ${chosen.length === 1 ? 'task' : 'tasks'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {candidates.length === 0 ? (
          <p className="text-[14px] text-muted">No unfinished tasks to tag.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-line">
            {candidates.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={picked.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-navy-600)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">{item.title}</span>
                    {item.milestone_id && (
                      <span className="block text-[12px] text-faint">Moves from {nameOf(item.milestone_id) ?? 'another milestone'}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
