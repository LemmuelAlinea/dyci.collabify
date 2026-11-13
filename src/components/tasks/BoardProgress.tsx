import { useId, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { BoardSummary } from '../../lib/types'

type Part = { key: 'done' | 'doing' | 'left'; label: string; value: number; ring: string; dot: string }

/** The board's 100 split three ways, in the order the ring draws them. */
function partsOf(board: BoardSummary): Part[] {
  const done = Number(board.done_pct)
  const doing = Number(board.doing_pct)
  const left = Math.max(0, 100 - done - doing)
  return [
    { key: 'done', label: 'Done', value: done, ring: 'stroke-success-500', dot: 'bg-success-500' },
    { key: 'doing', label: 'In progress', value: doing, ring: 'stroke-warning-400', dot: 'bg-warning-400' },
    { key: 'left', label: 'Not started', value: left, ring: 'stroke-pending-soft', dot: 'bg-pending-soft border border-line' },
  ]
}

const pct = (value: number) => Math.round(value * 10) / 10

/**
 * The group's 100, whole. Adding a task does not add points — it shrinks every
 * other slice — so this is always the full project, never a running total.
 *
 * `bar` is the strip a student reads above their board; `pie` is the ring a
 * professor reads beside the group's shares, with what is done in its middle.
 */
export function BoardProgress({ board, variant = 'bar' }: { board: BoardSummary; variant?: 'bar' | 'pie' }) {
  const parts = partsOf(board)
  const [done, doing] = parts
  const unclaimed = Number(board.unclaimed_pct)

  const owner = unclaimed > 0 && (
    <span className="flex items-center gap-2 text-[12px] text-warning-700 dark:text-warning-300">
      <Icon name="alert" size={13} />
      {pct(unclaimed)}% belongs to nobody yet
    </span>
  )

  if (variant === 'pie') {
    return (
      <div className="card flex h-full flex-col p-4 sm:p-5 shadow-card">
        <p className="eyebrow text-amber-500 dark:text-amber-300">Group progress</p>
        <p className="mt-1 text-[13px] text-muted">
          {board.done_count} of {board.task_count} tasks · worth{' '}
          <strong className="text-ink">{board.total_points}</strong> points
        </p>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
          <ProgressRing parts={parts} />
          <ul className="grid w-full max-w-[240px] gap-1.5 text-[13px]">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-2">
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.dot}`} />
                <span className="text-ink">{p.label}</span>
                <span className="ml-auto font-mono tabular-nums text-muted">{pct(p.value)}%</span>
              </li>
            ))}
          </ul>
          {owner}
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 sm:p-5 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Group progress</p>
          <p className="mt-2 text-[28px] leading-none font-semibold text-ink">
            {done.value}
            <span className="ml-0.5 text-[15.5px] text-muted">%</span>
          </p>
        </div>
        <p className="text-[13px] text-muted">
          {board.done_count} of {board.task_count} tasks · worth{' '}
          <strong className="text-ink">{board.total_points}</strong> points
        </p>
      </div>

      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full surface-sunken">
        <span className="bg-success-500 transition-[width] duration-300" style={{ width: `${done.value}%` }} />
        <span className="bg-warning-400 transition-[width] duration-300" style={{ width: `${doing.value}%` }} />
        <span className="flex-1" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-2 text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${p.key === 'left' ? 'surface-sunken border border-line' : p.dot}`} />
            {p.label}
            <span className="font-mono text-faint">{pct(p.value)}%</span>
          </span>
        ))}
        {owner}
      </div>
    </div>
  )
}

/** A ring this long all the way round, so a slice's dash is its percentage. */
const R = 15.915
/** The surface gap between slices: about 2px at the ring's size. */
const GAP = 0.6

/**
 * Done, in progress and not started as a ring, a small gap between slices.
 * The middle reads what is done; hovering or focusing a slice reads that one.
 */
function ProgressRing({ parts }: { parts: Part[] }) {
  const uid = useId()
  const [hover, setHover] = useState<Part['key'] | null>(null)
  const shown = parts.filter((p) => p.value > 0)
  const gap = shown.length > 1 ? GAP : 0
  const focus = parts.find((p) => p.key === hover) ?? parts[0]
  let offset = 25 // start at twelve o'clock

  return (
    <svg
      viewBox="0 0 42 42"
      className="h-40 w-40 shrink-0 sm:h-44 sm:w-44"
      role="img"
      aria-labelledby={`${uid}t ${uid}d`}
    >
      <title id={`${uid}t`}>Group progress</title>
      <desc id={`${uid}d`}>{parts.map((p) => `${p.label}: ${pct(p.value)}%`).join(', ')}</desc>
      {shown.map((p) => {
        const len = Math.max(0, p.value - gap)
        const slice = (
          <circle
            key={p.key}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            strokeWidth={hover === p.key ? 7 : 6}
            strokeDasharray={`${len} ${100 - len}`}
            strokeDashoffset={offset - gap / 2}
            className={`${p.ring} cursor-default transition-[stroke-width] duration-150 outline-none`}
            tabIndex={0}
            onMouseEnter={() => setHover(p.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.key)}
            onBlur={() => setHover(null)}
          >
            <title>{`${p.label}: ${pct(p.value)}%`}</title>
          </circle>
        )
        offset -= p.value
        return slice
      })}
      <text x="21" y="21.6" textAnchor="middle" className="fill-[var(--ink)] font-mono text-[7px] font-semibold">
        {pct(focus.value)}%
      </text>
      <text x="21" y="27" textAnchor="middle" className="fill-[var(--ink-muted)] text-[3px]">
        {focus.label.toLowerCase()}
      </text>
    </svg>
  )
}
