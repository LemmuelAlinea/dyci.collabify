import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/**
 * The dashboard's packing layout.
 *
 * A two-column grid left a ragged tail: whichever column ran short ended in
 * dead space, and the amount of it changed with the data. CSS multi-column
 * packs by height instead of by slot, so a short panel is followed
 * immediately by the next one and the columns end level whatever the content
 * does. `break-inside: avoid` on each child is what keeps a panel whole.
 *
 * Not a grid, deliberately: `grid-template-rows: masonry` is still not
 * shipped anywhere, and dense grid flow only fills holes a fixed row height
 * leaves behind — it cannot make rows of unequal panels end together.
 *
 * Reading order runs down each column rather than across, which suits a
 * dashboard of independent panels and would be wrong for a sequence.
 */
export function Bento({ children }: { children: ReactNode }) {
  return (
    <div className="gap-5 md:gap-7 [column-fill:balance] columns-1 lg:columns-2 xl:columns-3">
      {children}
    </div>
  )
}

/**
 * One panel in the pack.
 *
 * `wide` opts a panel out of the packing and across the full width — for the
 * one or two panels per page whose content needs the room (a table, a wide
 * chart). Everything else should stay packable.
 */
export function BentoCell({
  children,
  wide = false,
}: {
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className={`mb-5 break-inside-avoid md:mb-7 ${wide ? 'lg:[column-span:all]' : ''}`}
    >
      {children}
    </div>
  )
}

/**
 * A true bento: one grid whose tiles always meet in a rectangle. Each tile is
 * a grid item that stretches to its row, so whatever the content does the
 * outer edge stays square. The page places each tile with spans; this only
 * sets the columns and the gaps.
 */
export function BentoGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${className}`}>{children}</div>
}

/**
 * One tile: a single card with the section's heading at the top and its
 * content filling the rest. What sits inside should be flat rows, not more
 * cards — a card inside a card is what made the old dashboard read as clutter.
 */
export function BentoTile({
  icon,
  title,
  count,
  seeAll,
  seeAllLabel = 'See all',
  className = '',
  children,
}: {
  icon: IconName
  title: string
  count?: number
  seeAll?: string
  seeAllLabel?: string
  /** The tile's place in the grid: its spans per breakpoint. */
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={`surface flex min-w-0 flex-col rounded-card border border-line p-4 shadow-card sm:p-5 ${className}`}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px]">
          <Icon name={icon} size={16} className="shrink-0 text-faint" />
          <span className="truncate">{title}</span>
          {typeof count === 'number' && count > 0 && <Badge numeric>{count}</Badge>}
        </h2>
        {seeAll && (
          <Link
            to={seeAll}
            className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            {seeAllLabel}
            <Icon name="chevronRight" size={13} />
          </Link>
        )}
      </header>
      <div className="@container mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/** A tile's empty state: one quiet line, centred in whatever room it has. */
export function TileEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="grid flex-1 place-items-center px-2 py-6 text-center text-[13px] text-muted">
      {children}
    </p>
  )
}
