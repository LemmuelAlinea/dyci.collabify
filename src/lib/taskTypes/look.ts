// src/lib/taskTypes/look.ts
/**
 * How a type's color is drawn so it reads: a faint tint for the ground, and the color itself moved
 * lighter or darker until the name reads at 4.5:1 (the glyph at 3:1) on that tint over every ground
 * of the mode, at any dark-mode depth. A free hex such as #ffff00 still reads.
 */
import { groundFor, mix, withContrast, withContrastAll } from '../palette'
import type { Mode } from '../palette'

/** The tint's strength: 0x24 of 0xff, about 14%. */
const TINT = 0x24 / 0xff

const cache = new Map<string, { ground: string; ink: string; glyph: string }>()

function groundsUnder(color: string, mode: Mode): string[] {
  return [groundFor(mode, 0), groundFor(mode, 100)]
    .flatMap((g) => [g.surface, g.sunken, g.raised])
    .map((g) => mix(g, color, TINT))
}

export function typeLook(color: string, mode: Mode): { ground: string; ink: string; glyph: string } {
  const key = `${mode}${color}`
  const hit = cache.get(key)
  if (hit) return hit
  const under = groundsUnder(color, mode)
  const look = { ground: `${color}24`, ink: withContrastAll(color, under, 4.5), glyph: withContrastAll(color, under, 3) }
  cache.set(key, look)
  return look
}

/** The icon's color on the task dialog's banner, where the name keeps the banner's own ink. */
export function bannerGlyph(color: string, banner: string): string {
  return withContrast(color, banner, 3)
}
