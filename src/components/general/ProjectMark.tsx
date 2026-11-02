// src/components/general/ProjectMark.tsx
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { colorTile } from '../../lib/general/projectLook'
import type { ProjectColor, ProjectIcon } from '../../lib/general/types'

type Size = 'sm' | 'lg'

/**
 * `sm` is the rail's Quick access tile and `lg` the project card's icon square.
 * Each keeps its own plain ground, so a project with no look draws exactly what
 * it drew before projects had one.
 */
const SIZE: Record<Size, { box: string; plain: string; icon: number }> = {
  sm: { box: 'h-5 w-5 rounded font-mono text-[10px] font-bold', plain: 'border border-line text-muted', icon: 12 },
  lg: {
    box: 'h-12 w-12 rounded-xl font-display text-[14px] font-bold ring-1 ring-white/10',
    plain: 'bg-icon-tile text-icon-glyph',
    icon: 20,
  },
}

/**
 * A work project's mark: its color as the ground and its icon on it. The ground
 * is the color's swatch, else the size's plain ground. The glyph is the icon,
 * else `fallbackIcon` (a card passes its project kind's icon), else the project's
 * first letter. So a color alone draws the fallback icon or letter on the swatch,
 * an icon alone draws it on the plain ground, and neither draws today's tile.
 *
 * `active` is the rail's current page: a plain tile takes the current-page
 * colors, and a colored one keeps its color.
 */
export function ProjectMark({
  color,
  icon,
  name,
  size = 'lg',
  active = false,
  fallbackIcon,
}: {
  color?: ProjectColor | null
  icon?: ProjectIcon | null
  name: string
  size?: Size
  active?: boolean
  fallbackIcon?: IconName
}) {
  const s = SIZE[size]
  const tile = color ? colorTile(color) : null
  const ground = tile
    ? (tile.className ?? '')
    : active && size === 'sm'
      ? 'bg-nav-active text-nav-active-ink'
      : s.plain
  const glyph: IconName | undefined = icon ?? fallbackIcon
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${s.box} ${ground}`} style={tile?.style}>
      {glyph ? <Icon name={glyph} size={s.icon} /> : name.trim().charAt(0).toUpperCase() || 'P'}
    </span>
  )
}
