import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { BoardDrag } from './useBoardDrag'

/** The gap that opens where a card will land. */
function BoardSlot({ open, height }: { open: boolean; height: number }) {
  const reduce = useReducedMotion()
  const shut = { height: 0, opacity: 0, marginBottom: 0 }
  return (
    <motion.div
      aria-hidden="true"
      initial={shut}
      animate={open ? { height, opacity: 1, marginBottom: 12 } : shut}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, restDelta: 0.5 }}
      className="rounded-xl bg-navy-500/8 outline-1 -outline-offset-1 outline-navy-400/60 outline-dashed dark:bg-navy-300/10"
    />
  )
}

/**
 * One stage of a board: a drop target that dims when it refuses the lifted
 * card and says why when the card is over it. `slotAt` is where the card would
 * land among `cards`.
 */
export function BoardColumn({
  drag,
  column,
  header,
  cards,
  slotAt,
  empty,
}: {
  drag: BoardDrag
  column: number
  header: ReactNode
  cards: ReactNode[]
  slotAt: number
  empty: ReactNode
}) {
  const reduce = useReducedMotion()
  const active = drag.active
  const away = active !== null && active.column !== column
  const refusal = away ? active.refusals.get(column) : undefined
  const isOver = away && drag.over === column
  const opening = isOver && !refusal && active.phase === 'dragging'
  const slot =
    away && !refusal && active.phase !== 'landing' ? (
      <BoardSlot key="board-slot" open={opening} height={active.height} />
    ) : null
  const list = slot ? [...cards.slice(0, slotAt), slot, ...cards.slice(slotAt)] : cards

  return (
    <section
      data-board-column={column}
      className={`relative -mx-1.5 -my-1.5 min-w-0 rounded-xl px-1.5 py-1.5 transition-colors duration-150 ${
        opening ? 'bg-navy-500/6 ring-1 ring-navy-400/30 ring-inset dark:bg-navy-300/8' : ''
      }`}
    >
      <div className={`space-y-3 transition-opacity duration-150 ${refusal && active?.phase === 'dragging' ? 'opacity-45' : ''}`}>
        {header}
        {cards.length === 0 && !opening && empty}
        {list}
      </div>
      {isOver && refusal && active.phase === 'dragging' && (
        <motion.p
          role="status"
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.14 }}
          className="surface absolute inset-x-1.5 top-11 z-20 rounded-xl border border-warning-300 px-3 py-2 text-[12px] text-warning-700 shadow-lift dark:border-warning-400/50 dark:text-warning-300"
        >
          {refusal}
        </motion.p>
      )}
    </section>
  )
}

/**
 * Moves a card without dragging it: a native list, so a keyboard, a screen
 * reader and a phone each get the control they already know.
 */
export function MoveToStage({
  title,
  options,
  onMove,
}: {
  title: string
  options: { value: number; label: string }[]
  onMove: (column: number) => void
}) {
  if (options.length === 0) return null
  return (
    <span
      title="Move to another stage"
      className="relative grid h-7 w-7 place-items-center rounded-full text-faint transition-colors focus-within:ring-2 focus-within:ring-navy-400 hover:bg-[var(--surface-sunken)] hover:text-ink"
    >
      <Icon name="kanban" size={14} />
      <select
        value=""
        aria-label={`Move ${title} to another stage`}
        onChange={(e) => {
          if (e.target.value !== '') onMove(Number(e.target.value))
        }}
        className="absolute inset-0 cursor-pointer rounded-full opacity-0"
      >
        <option value="" hidden>
          Move to
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}
