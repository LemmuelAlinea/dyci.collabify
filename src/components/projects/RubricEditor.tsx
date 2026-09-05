import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import type { CriterionInput } from '../../lib/api/projects'

const BLANK: CriterionInput = { label: '', description: '', max_points: 10 }

export function RubricEditor({
  rows,
  onChange,
  totalPoints,
}: {
  rows: CriterionInput[]
  onChange: (next: CriterionInput[]) => void
  totalPoints: number
}) {
  const sum = rows.reduce((n, r) => n + (Number.isFinite(r.max_points) ? r.max_points : 0), 0)
  const named = rows.filter((r) => r.label.trim()).length
  const mismatch = named > 0 && sum !== totalPoints

  function patch(i: number, next: Partial<CriterionInput>) {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...next } : r)))
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          No rubric yet. Add the criteria you will mark against — a project needs at least
          one.
        </p>
      ) : (
        <ul className="space-y-2.5">
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
                onChange={(e) => patch(i, { max_points: Number(e.target.value) })}
                aria-label={`Criterion ${i + 1} points`}
                className="!h-10 text-center"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, n) => n !== i))}
                aria-label={`Remove criterion ${i + 1}`}
                className="grid h-10 w-10 place-items-center justify-self-end rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
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

        {named > 0 && (
          <p
            className={`font-mono text-[12px] ${
              mismatch ? 'text-amber-700 dark:text-amber-300' : 'text-faint'
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
