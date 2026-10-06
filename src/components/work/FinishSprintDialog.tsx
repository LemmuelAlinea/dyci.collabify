import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { sprintItems } from '../../lib/work/backlog'
import { nextSprintDraft, plannedSprints, sprintCounts } from '../../lib/work/sprints'
import type { Sprint, WorkSource } from '../../lib/work/types'

type Target = 'backlog' | 'next' | 'new'

/** Close the running sprint, and say where its unfinished tasks go. */
export function FinishSprintDialog({
  open,
  onClose,
  sprint,
  source,
}: {
  open: boolean
  onClose: () => void
  sprint: Sprint
  source: WorkSource
}) {
  const { show } = useToast()
  const planned = plannedSprints(source.sprints)
  const unfinished = sprintItems(source.items, sprint.id).filter((i) => i.status !== 'done').length
  const counts = sprintCounts(source.items, sprint.id)
  // Taken once, so the label keeps its name and dates if the sprints reload.
  const [draft] = useState(() => nextSprintDraft(source.sprints))
  const [target, setTarget] = useState<Target>(planned.length > 0 ? 'next' : 'backlog')
  const [nextId, setNextId] = useState(planned[0]?.id ?? '')
  // A retry after a failed finish reuses the sprint the first attempt made.
  const createdRef = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextValid = planned.some((s) => s.id === nextId) ? nextId : (planned[0]?.id ?? '')
  const effectiveTarget: Target = target === 'next' && planned.length === 0 ? 'backlog' : target

  async function finish() {
    setError(null)
    setBusy(true)
    try {
      let carryTo: string | null = null
      if (unfinished > 0 && effectiveTarget === 'next') carryTo = nextValid || null
      if (unfinished > 0 && effectiveTarget === 'new') {
        createdRef.current ??= await source.createSprint(draft)
        carryTo = createdRef.current
      }
      await source.finishSprint(sprint.id, carryTo)
      show(`${sprint.name} finished`)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not finish the sprint.'))
    } finally {
      setBusy(false)
    }
  }

  const option = (value: Target, label: string, extra?: ReactNode) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-navy-400 has-[:checked]:bg-navy-500/8">
      <input
        type="radio"
        name="carry"
        value={value}
        checked={effectiveTarget === value}
        onChange={() => setTarget(value)}
        className="mt-1 accent-[var(--color-navy-600)]"
      />
      <span className="min-w-0 flex-1 text-[14px] text-ink">
        {label}
        {extra}
      </span>
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Finish ${sprint.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void finish()} loading={busy}>
            Finish sprint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-[14px] text-muted">
          {counts.done} of {counts.total} {counts.total === 1 ? 'task' : 'tasks'} done.{' '}
          {unfinished === 0 ? 'Every task in it is finished.' : `Where should the ${unfinished} unfinished ${unfinished === 1 ? 'task' : 'tasks'} go?`}
        </p>
        {unfinished > 0 && (
          <div className="space-y-2" role="radiogroup" aria-label="Where unfinished tasks go">
            {planned.length > 0 &&
              option(
                'next',
                'Into a planned sprint',
                effectiveTarget === 'next' && (
                  <span className="mt-2 block">
                    <Select
                      value={nextValid}
                      onChange={(e) => setNextId(e.target.value)}
                      options={planned.map((s) => ({ value: s.id, label: `${s.name} · ${dateRange(s.starts_on, s.ends_on)}` }))}
                      aria-label="Planned sprint"
                      className="!h-9 !text-[13px]"
                    />
                  </span>
                ),
              )}
            {option('new', `Into a new sprint (${draft.name}, ${dateRange(draft.startsOn, draft.endsOn)})`)}
            {option('backlog', 'Back to the backlog')}
          </div>
        )}
      </div>
    </Modal>
  )
}
