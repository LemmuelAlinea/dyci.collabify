import { TYPE_ICON_GLYPH } from '../../lib/taskTypes/icons'
import { bannerGlyph, typeLook } from '../../lib/taskTypes/look'
import type { ResolvedType } from '../../lib/taskTypes/typeSet'
import { Icon } from '../ui/Icon'
import { useTypeMode } from './TypeIcon'

/** The banner's darkest ground, for when the page has no banner color to read. */
const BANNER_GROUND = '#10162e'

function bannerColor(): string {
  if (typeof document === 'undefined') return BANNER_GROUND
  const value = getComputedStyle(document.documentElement).getPropertyValue('--banner').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : BANNER_GROUND
}

/**
 * A task's type: its icon and name on a tint of its color, the description as the tooltip. On the
 * banner (the task dialog's header) the name keeps the banner's own ink and only the icon takes the
 * color. A type the project no longer has is gray.
 */
export function TypeChip({ entry, size = 'sm', onBanner = false }: { entry: ResolvedType; size?: 'sm' | 'md'; onBanner?: boolean }) {
  const mode = useTypeMode()
  const look = entry.removed || onBanner ? null : typeLook(entry.color, mode)
  const glyphColor = onBanner && !entry.removed ? bannerGlyph(entry.color, bannerColor()) : undefined
  const base = size === 'md' ? 'gap-1.5 px-2 py-1 text-[12px]' : 'gap-1 px-1.5 py-0.5 text-[11px]'
  const tone = onBanner ? 'bg-banner-ink/12 text-banner-ink' : entry.removed ? 'surface-sunken text-muted' : ''
  return (
    <span
      data-type-chip=""
      data-ink={look?.ink}
      title={entry.removed ? 'No longer one of this project\'s types' : entry.description || undefined}
      className={`inline-flex max-w-full shrink-0 items-center rounded-md font-medium ${base} ${tone}`}
      style={look ? { background: look.ground, color: look.ink } : undefined}
    >
      <Icon
        name={TYPE_ICON_GLYPH[entry.icon]}
        size={size === 'md' ? 13 : 12}
        className="shrink-0"
        style={look ? { color: look.glyph } : glyphColor ? { color: glyphColor } : undefined}
      />
      <span className="truncate">{entry.name}</span>
    </span>
  )
}
