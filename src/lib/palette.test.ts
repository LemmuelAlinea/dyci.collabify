import { describe, expect, it } from 'vitest'
import {
  HEX_KEYS,
  bannerReadable,
  PALETTE_VARS,
  STOPS,
  cleanColors,
  contrast,
  inkFor,
  luminance,
  normalizeHex,
  ramp,
  toCssVars,
  withContrast,
} from './palette'
import { PRESETS } from './palettePresets'

describe('ramp', () => {
  it('keeps the pick at its anchor and gets darker down the stops', () => {
    for (const hex of ['#00bc7d', '#fb2c36', '#f0b429', '#7048e8', '#ffe066']) {
      const r = ramp(hex)
      expect(r[500]).toBe(hex)
      const lum = STOPS.filter((s) => s !== 500).map((s) => luminance(r[s]))
      for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeLessThanOrEqual(lum[i - 1] + 1e-9)
    }
  })

  it('anchors wherever it is told to', () => {
    expect(ramp('#f0b429', 400)[400]).toBe('#f0b429')
  })

  it('keeps the text stops readable, even for a pale pick', () => {
    for (const hex of ['#ffe066', '#c3fae8', '#00bc7d', '#101010']) {
      const r = ramp(hex)
      expect(contrast(r[700], '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(r[300], '#10152f')).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('inkFor', () => {
  it('flips between cream and near-black around mid-grey', () => {
    expect(inkFor('#000000')).toBe('#fef7e6')
    expect(inkFor('#080b21')).toBe('#fef7e6')
    expect(inkFor('#ffffff')).toBe('#10162e')
    expect(inkFor('#ffe066')).toBe('#10162e')
  })

  it('always gives at least 4.5:1', () => {
    for (const bg of ['#777777', '#808080', '#26327a', '#f0b429', '#3ddc84']) {
      expect(contrast(inkFor(bg), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('withContrast', () => {
  it('leaves a colour that already passes alone', () => {
    expect(withContrast('#000000', '#ffffff', 4.5)).toBe('#000000')
  })

  it('darkens on a light ground and lightens on a dark one', () => {
    const onWhite = withContrast('#ffe066', '#ffffff', 3)
    expect(contrast(onWhite, '#ffffff')).toBeGreaterThanOrEqual(3)
    const onNavy = withContrast('#26327a', '#10152f', 3)
    expect(contrast(onNavy, '#10152f')).toBeGreaterThanOrEqual(3)
    expect(luminance(onNavy)).toBeGreaterThan(luminance('#26327a'))
  })
})

describe('toCssVars', () => {
  it('sets nothing for untouched slots', () => {
    expect(toCssVars({}, 'light')).toEqual({})
    expect(toCssVars(undefined, 'dark')).toEqual({})
  })

  it('covers every slot, and only variables the page knows to clear', () => {
    const all = { ...Object.fromEntries(HEX_KEYS.map((k) => [k, '#3366cc'])), bannerStyle: 'gradient' as const, depth: 60 }
    for (const mode of ['light', 'dark'] as const) {
      const vars = toCssVars(all, mode)
      for (const name of Object.keys(vars)) expect(PALETTE_VARS).toContain(name)
      expect(vars['--color-success-500']).toBe('#3366cc')
      expect(vars['--color-warning-400']).toBe('#3366cc')
      expect(vars['--banner']).toBe('#3366cc')
      expect(vars['--progress']).toBe('#3366cc')
      expect(vars['--icon-tile']).toBe('#3366cc')
      expect(vars['--pending-soft']).toContain('#3366cc')
      // Depth is dark mode's alone.
      expect(Object.keys(vars).length).toBe(PALETTE_VARS.length - (mode === 'light' ? 5 : 0))
    }
  })

  it('paints a gradient banner, turns off the glow, and reads on both ends', () => {
    const vars = toCssVars({ bannerStyle: 'gradient', banner: '#000000', banner2: '#26327a' }, 'light')
    expect(vars['--banner-image']).toBe('linear-gradient(90deg, #000000, #26327a)')
    expect(vars['--banner-deco']).toBe('hidden')
    const ink = vars['--banner-ink']
    expect(Math.min(contrast(ink, '#000000'), contrast(ink, '#26327a'))).toBeGreaterThanOrEqual(4.5)
  })

  it('owns up when no text colour reads across a gradient', () => {
    expect(bannerReadable({ bannerStyle: 'gradient', banner: '#000000', banner2: '#ffe066' }, 'light')).toBe(false)
    expect(bannerReadable({ bannerStyle: 'gradient', banner: '#000000', banner2: '#26327a' }, 'light')).toBe(true)
    expect(bannerReadable({}, 'dark')).toBe(true)
  })

  it('turns off the glow for a solid banner, even in the default colour', () => {
    const vars = toCssVars({ bannerStyle: 'solid' }, 'dark')
    expect(vars['--banner-deco']).toBe('hidden')
    expect(vars['--banner']).toBe('#080b21')
    expect(vars['--banner-image']).toBeUndefined()
  })

  it('takes dark mode to black at full depth and leaves light mode alone', () => {
    expect(toCssVars({ depth: 100 }, 'dark')['--u-page']).toBe('#000000')
    expect(toCssVars({ depth: 100 }, 'dark')['--u-depth']).toBe('1')
    expect(toCssVars({ depth: 35 }, 'dark')['--u-depth']).toBe('0.35')
    expect(toCssVars({ depth: 100 }, 'light')['--u-page']).toBeUndefined()
    const half = toCssVars({ depth: 50 }, 'dark')['--u-surface']
    expect(luminance(half)).toBeLessThan(luminance('#10152f'))
    expect(luminance(half)).toBeGreaterThan(luminance('#0b0b0d'))
  })

  it('keeps a card icon visible on its tile', () => {
    const vars = toCssVars({ iconTile: '#ffffff', iconGlyph: '#fff3bf' }, 'light')
    expect(contrast(vars['--icon-glyph'], '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('turns banner text dark on a light banner', () => {
    const vars = toCssVars({ banner: '#fff3bf' }, 'light')
    expect(vars['--banner-ink']).toBe('#10162e')
    expect(contrast(vars['--banner-accent'], '#fff3bf')).toBeGreaterThanOrEqual(3)
  })

  it('keeps banner buttons readable on whatever banner is showing', () => {
    const vars = toCssVars({ btnCreate: '#ffffff', btnAction: '#26327a', btnDanger: '#fb2c36' }, 'dark')
    expect(vars['--btn-create-ink']).toBe('#10162e')
    expect(contrast(vars['--btn-action'], '#080b21')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(vars['--btn-danger'], '#080b21')).toBeGreaterThanOrEqual(4.5)
    const light = toCssVars({ banner: '#fff3bf', btnAction: '#fff3bf' }, 'light')
    expect(contrast(light['--btn-action'], '#fff3bf')).toBeGreaterThanOrEqual(4.5)
    // Untouched, the outlined ones follow the banner text through the stylesheet.
    expect(toCssVars({ banner: '#fff3bf' }, 'light')['--btn-action']).toBeUndefined()
  })

  it('puts a white badge on dark ink and keeps a pale nav colour visible', () => {
    const vars = toCssVars({ badge: '#ffffff', navActive: '#fafafa' }, 'light')
    expect(vars['--badge-ink']).toBe('#10162e')
    expect(contrast(vars['--nav-active'], '#f4f6fb')).toBeGreaterThanOrEqual(3)
  })
})

describe('cleanColors and normalizeHex', () => {
  it('drops unknown keys, modes and malformed values', () => {
    expect(
      cleanColors({
        light: { banner: '#123456', page: '#ffffff', success: 'red', danger: '#ABCDEF' },
        sepia: { banner: '#000000' },
        dark: 'nope',
      }),
    ).toEqual({ light: { banner: '#123456' } })
    expect(cleanColors(null)).toEqual({})
    expect(
      cleanColors({
        light: { bannerStyle: 'gradient', depth: 40 },
        dark: { bannerStyle: 'plaid', depth: 40.5 },
      }),
    ).toEqual({ light: { bannerStyle: 'gradient' } })
    expect(cleanColors({ dark: { bannerStyle: 'glow', depth: 70 } })).toEqual({ dark: { depth: 70 } })
  })

  it('reads the ways people type a colour', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('  1a2b3c ')).toBe('#1a2b3c')
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('blue')).toBeNull()
  })
})

describe('presets', () => {
  it('hold only valid colours and have unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    for (const p of PRESETS) expect(cleanColors(p.colors)).toEqual(p.colors)
  })
})
