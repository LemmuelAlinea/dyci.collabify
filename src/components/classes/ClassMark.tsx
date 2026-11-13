// src/components/classes/ClassMark.tsx
import type { CSSProperties } from 'react'
import { Icon } from '../ui/Icon'
import { colorTile } from '../../lib/general/projectLook'
import type { ClassLook } from '../../lib/classLook'

/** Each place's tile, as it was before classes had a look: box, plain ground, icon size. */
export const CLASS_TILE = {
  banner: {
    box: 'h-12 w-12 rounded-xl font-display text-[15px] font-bold ring-1 ring-banner-ink/12 @min-[960px]:h-16 @min-[960px]:w-16 @min-[960px]:text-[18px]',
    plain: 'bg-banner-ink/8 text-banner-accent-text',
    iconSize: 24,
  },
  card: {
    box: 'h-12 w-12 rounded-xl font-display text-[14px] font-bold ring-1 ring-white/10',
    plain: 'bg-icon-tile text-icon-glyph',
    iconSize: 20,
  },
  rail: {
    box: 'h-10 w-10 rounded-[10px] font-mono text-[14px] font-bold',
    plain: 'place-tile text-ink',
    iconSize: 18,
  },
  home: {
    box: 'h-8 w-8 rounded-lg font-mono text-[11px] font-bold',
    plain: 'surface-sunken text-navy-600 dark:text-amber-300',
    iconSize: 15,
  },
} as const

/**
 * A class's tile: its color as the ground and its icon on it, else its
 * initials. Each place passes its own box (size, corners, type) and plain
 * ground, so a class with no look draws exactly the tile it drew before.
 */
export function ClassMark({
  look,
  initial,
  box,
  plain,
  iconSize = 20,
  style,
}: {
  look?: ClassLook | null
  /** What the tile shows without an icon: the class initials, or a name's letter. */
  initial: string
  /** Size, corners and type of the tile. */
  box: string
  /** Ground and ink when no color is set. */
  plain: string
  iconSize?: number
  style?: CSSProperties
}) {
  const tile = look?.color ? colorTile(look.color) : null
  return (
    <span
      aria-hidden
      data-class-mark={look?.icon ?? 'initials'}
      className={`grid shrink-0 place-items-center ${box} ${tile ? (tile.className ?? '') : plain}`}
      style={{ ...style, ...tile?.style }}
    >
      {look?.icon ? <Icon name={look.icon} size={iconSize} /> : initial}
    </span>
  )
}
