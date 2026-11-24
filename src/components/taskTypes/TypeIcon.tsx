import { useContext } from 'react'
import { ThemeContext } from '../../context/ThemeContext'
import { TYPE_ICON_GLYPH } from '../../lib/taskTypes/icons'
import { typeLook } from '../../lib/taskTypes/look'
import type { TaskTypeEntry } from '../../lib/taskTypes/typeSet'
import { Icon } from '../ui/Icon'

/** Light or dark, as the page is drawn; light outside a ThemeProvider. */
export function useTypeMode(): 'light' | 'dark' {
  return useContext(ThemeContext)?.resolved ?? 'light'
}

const GLYPH: Record<16 | 20 | 28 | 36, number> = { 16: 11, 20: 13, 28: 16, 36: 20 }

/** A type's icon on its tinted tile. A removed type is gray. */
export function TypeIcon({ entry, size = 20 }: { entry: TaskTypeEntry & { removed?: boolean }; size?: 16 | 20 | 28 | 36 }) {
  const mode = useTypeMode()
  const look = entry.removed ? null : typeLook(entry.color, mode)
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${size >= 28 ? 'rounded-lg' : 'rounded-md'} ${look ? '' : 'surface-sunken text-muted'}`}
      style={{ width: size, height: size, ...(look ? { background: look.ground, color: look.glyph } : {}) }}
    >
      <Icon name={TYPE_ICON_GLYPH[entry.icon]} size={GLYPH[size]} />
    </span>
  )
}
