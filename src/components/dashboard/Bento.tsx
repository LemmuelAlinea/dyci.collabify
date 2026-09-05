import type { ReactNode } from 'react'

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
