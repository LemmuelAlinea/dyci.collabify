import { useState } from 'react'
import { Icon } from '../ui/Icon'
import {
  MAX_STAGES,
  MAX_STAGE_LENGTH,
  MIN_STAGES,
  STAGE_PRESETS,
  checkStages,
  presetOf,
  statusForStage,
} from '../../lib/stages'

const TONE = {
  todo: 'bg-pending-soft text-pending-ink',
  in_progress: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  done: 'bg-success-500/15 text-success-700 dark:text-success-300',
} as const

const MEANING = { todo: 'Not started', in_progress: 'In progress', done: 'Done' } as const

/**
 * The columns a project's work moves through: pick a preset, or name your own.
 * The first stage means not started and the last means done, so reports and
 * grading read the same whatever the names are.
 */
export function StagesEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  // Custom can be picked while the names still match a preset, to start
  // renaming from it.
  const [customPicked, setCustomPicked] = useState(false)
  const preset = customPicked ? 'custom' : presetOf(value)
  const problem = checkStages(value)
  const list = [...value]

  const set = (i: number, name: string) => onChange(list.map((s, j) => (j === i ? name : s)))
  const swap = (i: number, j: number) => {
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Stage preset" className="flex flex-wrap gap-2">
        {[...STAGE_PRESETS, { id: 'custom', label: 'Custom', stages: [] as readonly string[] }].map((p) => {
          const on = preset === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => {
                setCustomPicked(p.id === 'custom')
                if (p.id !== 'custom') onChange([...p.stages])
              }}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${
                on
                  ? 'border-navy-500 bg-navy-50 text-navy-700 dark:border-navy-300 dark:bg-navy-500/18 dark:text-navy-100'
                  : 'border-line text-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <ol className="space-y-2">
        {list.map((name, i) => {
          const meaning = statusForStage(i, list.length)
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[12px] text-faint">{i + 1}</span>
              <input
                value={name}
                disabled={disabled}
                maxLength={MAX_STAGE_LENGTH}
                aria-label={`Stage ${i + 1} name`}
                onChange={(e) => set(i, e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-[var(--surface)] px-3 text-[14px] text-ink outline-none transition-colors focus:border-navy-400 disabled:opacity-60"
              />
              <span
                className={`hidden w-[92px] shrink-0 rounded-md px-1.5 py-0.5 text-center font-mono text-[11px] sm:inline-block ${TONE[meaning]}`}
              >
                {MEANING[meaning]}
              </span>
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  disabled={disabled || i === 0}
                  onClick={() => swap(i, i - 1)}
                  aria-label={`Move ${name || `stage ${i + 1}`} up`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevronDown" size={15} className="rotate-180" />
                </button>
                <button
                  type="button"
                  disabled={disabled || i === list.length - 1}
                  onClick={() => swap(i, i + 1)}
                  aria-label={`Move ${name || `stage ${i + 1}`} down`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
                >
                  <Icon name="chevronDown" size={15} />
                </button>
                <button
                  type="button"
                  disabled={disabled || list.length <= MIN_STAGES}
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                  aria-label={`Remove ${name || `stage ${i + 1}`}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-danger-600 disabled:opacity-30 dark:hover:text-danger-400"
                >
                  <Icon name="x" size={15} />
                </button>
              </span>
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {list.length < MAX_STAGES ? (
          <button
            type="button"
            disabled={disabled}
            // A new stage goes before the last, so the end still means done.
            onClick={() => onChange([...list.slice(0, -1), '', list[list.length - 1]])}
            className="flex items-center gap-1.5 text-[13px] font-medium text-navy-600 hover:underline disabled:opacity-60 dark:text-navy-200"
          >
            <Icon name="plus" size={14} />
            Add a stage
          </button>
        ) : (
          <span className="text-[12px] text-faint">{MAX_STAGES} stages is the most a project can have.</span>
        )}
        <p className="text-[12px] text-muted">
          The first stage is not started, the last is done, and the rest count as in progress.
        </p>
      </div>

      {problem && <p className="text-[12px] text-danger-600 dark:text-danger-400">{problem}</p>}
    </div>
  )
}
