import { describe, expect, it } from 'vitest'
import { contrast, groundFor, mix } from '../palette'
import { TYPE_SWATCHES } from './colors'
import { bannerGlyph, typeLook } from './look'

const HARD = ['#ffff00', '#000000', '#777777', '#ffffff']

describe('TYPE_SWATCHES', () => {
  it('holds the 13 named colors as lowercase hex', () => {
    expect(TYPE_SWATCHES.map((s) => s.name)).toEqual([
      'Blue', 'Red', 'Cyan', 'Purple', 'Green', 'Amber', 'Teal', 'Magenta', 'Indigo', 'Orange', 'Slate', 'Ochre', 'Violet',
    ])
    for (const s of TYPE_SWATCHES) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(TYPE_SWATCHES[0].hex).toBe('#2563eb')
  })
})

describe('typeLook', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`reads at 4.5:1 on every ${mode} ground`, () => {
      const grounds = [groundFor(mode, 0), groundFor(mode, 100)].flatMap((g) => [g.surface, g.sunken, g.raised])
      for (const color of [...TYPE_SWATCHES.map((s) => s.hex), ...HARD]) {
        const look = typeLook(color, mode)
        for (const g of grounds) {
          const under = mix(g, color, 0.14)
          expect(contrast(look.ink, under), `${color} ink on ${g}`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(look.glyph, under), `${color} glyph on ${g}`).toBeGreaterThanOrEqual(3)
        }
        expect(look.ground).toBe(`${color}24`)
      }
    })
  }
})

describe('bannerGlyph', () => {
  it('reads at 3:1 on the banner', () => {
    for (const banner of ['#10162e', '#f6f1e3', '#2563eb']) {
      for (const color of [...TYPE_SWATCHES.map((s) => s.hex), ...HARD]) {
        expect(contrast(bannerGlyph(color, banner), banner), `${color} on ${banner}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
