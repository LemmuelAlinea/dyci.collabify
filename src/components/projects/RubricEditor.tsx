import { useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import { authErrorMessage } from '../../lib/authError'
import type { CriterionInput } from '../../lib/api/projects'

const BLANK: CriterionInput = { label: '', description: '', max_points: 10 }

export function RubricEditor({
  rows,
  onChange,
  totalPoints,
  locked = false,
  onClearScores,
}: {
  rows: CriterionInput[]
  onChange: (next: CriterionInput[]) => void
  totalPoints: number
  /** Scores exist: points and criteria are fixed, wording is not. */
  locked?: boolean
  onClearScores?: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const sum = rows.reduce((n, r) => n + (Number.isFinite(r.max_points) ? r.max_points : 0), 0)
  const named = rows.filter((r) => r.label.trim()).length
  const mismatch = named > 0 && sum !== totalPoints

  function patch(i: number, next: Partial<CriterionInput>) {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...next } : r)))
  }

  async function clear() {
    if (!onClearScores) return
    setClearError(null)
    setClearing(true)
    try {
      await onClearScores()
      setConfirming(false)
    } catch (err) {
      setClearError(authErrorMessage(err, 'Could not clear the scores. Try again.'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-3">
      {locked && (
        <div className="space-y-3 rounded-xl border border-line surface-sunken p-3 text-[13px] text-muted">
          <div className="flex flex-wrap items-start gap-3">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-faint" />
            <p className="min-w-0 flex-1">
              Scores exist for this project, so its points and criteria are locked. You can still
              reword them.
            </p>
            {onClearScores && !confirming && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Clear scores…
              </Button>
            )}
          </div>
          {confirming && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-ink">
                This deletes every score and confirmed grade on this project and hides released
                grades. The history keeps a record.
              </p>
              {clearError && <p className="text-danger-700 dark:text-danger-300">{clearError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="danger" size="sm" loading={clearing} onClick={clear}>
                  Clear scores
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep them
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          No rubric yet. Add the criteria you will mark against — a project needs at least
          one.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_96px_auto] sm:items-start"
            >
              <div className="space-y-2">
                <Input
                  value={r.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="Criterion, e.g. Functionality"
                  aria-label={`Criterion ${i + 1} name`}
                  className="!h-10"
                />
                <Input
                  value={r.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="What earns full marks here"
                  aria-label={`Criterion ${i + 1} description`}
                  className="!h-10 !text-[13px]"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={1000}
                value={r.max_points}
                disabled={locked}
                onChange={(e) => patch(i, { max_points: Number(e.target.value) })}
                aria-label={`Criterion ${i + 1} points`}
                className="!h-10 text-center"
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, n) => n !== i))}
                  aria-label={`Remove criterion ${i + 1}`}
                  className="grid h-10 w-10 place-items-center justify-self-end rounded-full text-faint transition-colors hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!locked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="!rounded-lg"
            onClick={() => onChange([...rows, { ...BLANK }])}
          >
            <Icon name="plus" size={15} />
            Add criterion
          </Button>
        )}

        {named > 0 && (
          <p
            className={`font-mono text-[12px] ${
              mismatch ? 'text-warning-700 dark:text-warning-300' : 'text-faint'
            }`}
          >
            {sum} / {totalPoints} points
            {mismatch && ' · does not add up to the total'}
          </p>
        )}
      </div>
    </div>
  )
}
