import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

/**
 * Pick sprints to count toward a milestone: every task in them, and any that
 * join later, is tagged with it. A sprint counts toward one milestone at a time.
 */
export function AddSprintDialog({
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
  // A finished sprint is fixed; only planned and running ones can be added.
  const candidates = source.sprints.filter((s) => s.state !== 'completed' && s.milestone_id !== milestone.id)
  const chosen = candidates.filter((c) => picked.has(c.id))
  const nameOf = (id: string | null) => source.milestones.find((m) => m.id === id)?.name
  const tasksIn = (id: string) => source.items.filter((i) => i.sprint_id === id).length

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
      for (const s of chosen) await source.linkSprint(s.id, milestone.id)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that sprint.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Sprints for ${milestone.name}`}
      description="Every task in the sprint counts toward the milestone, including tasks added later. When they are all done, the milestone is reached."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={chosen.length === 0}>
            {chosen.length === 0 ? 'Add sprint' : `Add ${chosen.length} ${chosen.length === 1 ? 'sprint' : 'sprints'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {candidates.length === 0 ? (
          <p className="text-[14px] text-muted">
            No planned or running sprints to add. Create one in Backlog first.
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-line">
            {candidates.map((s) => (
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
                      {formatDay(s.starts_on)} – {formatDay(s.ends_on)} · {tasksIn(s.id)}{' '}
                      {tasksIn(s.id) === 1 ? 'task' : 'tasks'}
                      {s.state === 'active' ? ' · running' : ''}
                    </span>
                    {s.milestone_id && (
                      <span className="block text-[12px] text-faint">
                        Moves from {nameOf(s.milestone_id) ?? 'another milestone'}
                      </span>
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
