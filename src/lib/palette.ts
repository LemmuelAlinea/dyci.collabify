/**
 * A person's own colours, from Settings → Appearance.
 *
 * They pick one colour per slot — a banner, a status, the sidebar icons — and
 * this turns that pick into the CSS variables `src/styles/index.css` already
 * reads: a whole 50…950 ramp for a status, a text colour that stays readable on
 * a banner. The variables are set inline on <html>, which beats the defaults in
 * both `:root` and `.dark`, and cached in localStorage so `public/theme.js` can
 * put them back before the first paint.
 *
 * Pure except for `applyPalette` and the cache helpers at the bottom.
 */

export type Mode = 'light' | 'dark'

/** The slots that take a colour. */
export const HEX_KEYS = [
  'banner',
  'banner2',
  'bannerAccent',
  'success',
  'warning',
  'danger',
  'pending',
  'navIcon',
  'navActive',
  'progress',
  'badge',
  'iconTile',
  'iconGlyph',
  'btnCreate',
  'btnAction',
  'btnDanger',
] as const

export type PickKey = (typeof HEX_KEYS)[number]

/**
 * How a banner is filled: `glow` is the product's own (a colour with a soft
 * accent glow and a faint grid), `solid` is the colour alone, `gradient` runs
 * from `banner` on the left to `banner2` on the right.
 */
export const BANNER_STYLES = ['glow', 'solid', 'gradient'] as const
export type BannerStyle = (typeof BANNER_STYLES)[number]

export type Picks = Partial<Record<PickKey, string>> & {
  bannerStyle?: BannerStyle
  /** Dark mode only: 0 is the product's navy grounds, 100 is black. */
  depth?: number
}
export type PaletteColors = Partial<Record<Mode, Picks>>

/** Every key a mode can hold, for comparing palettes. */
export const PICK_KEYS = [...HEX_KEYS, 'bannerStyle', 'depth'] as const

/**
 * What each slot looks like untouched, as the nearest hex. Only for showing a
 * swatch in the editor: an untouched slot sets no variable at all, so the
 * stylesheet's exact value is what renders.
 */
export const DEFAULT_PICKS: Record<Mode, Record<PickKey, string>> = {
  light: {
    banner: '#080b21',
    bannerAccent: '#f7c74a',
    success: '#00bc7d',
    warning: '#f0b429',
    danger: '#fb2c36',
    pending: '#59627f',
    navIcon: '#59627f',
    navActive: '#26327a',
    progress: '#00bc7d',
    badge: '#f0b429',
    banner2: '#26327a',
    iconTile: '#080b21',
    iconGlyph: '#f7c74a',
    btnCreate: '#f0b429',
    btnAction: '#fef7e6',
    btnDanger: '#fef7e6',
  },
  dark: {
    banner: '#080b21',
    bannerAccent: '#f7c74a',
    success: '#00bc7d',
    warning: '#f0b429',
    danger: '#fb2c36',
    pending: '#a8b0cd',
    navIcon: '#a8b0cd',
    navActive: '#f0b429',
    progress: '#00bc7d',
    badge: '#f0b429',
    banner2: '#26327a',
    iconTile: '#080b21',
    iconGlyph: '#f7c74a',
    btnCreate: '#f0b429',
    btnAction: '#fef7e6',
    btnDanger: '#fef7e6',
  },
}

const HEX = /^#[0-9a-f]{6}$/

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** Lower-case `#rrggbb`, from `#RGB`, `#rrggbb` or without the `#`; null if neither. */
export function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase()
  if (!v.startsWith('#')) v = `#${v}`
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return HEX.test(v) ? v : null
}

/** Drops unknown keys and malformed values, the same rule the database enforces. */
export function cleanColors(raw: unknown): PaletteColors {
  const out: PaletteColors = {}
  if (!raw || typeof raw !== 'object') return out
  for (const mode of ['light', 'dark'] as const) {
    const src = (raw as Record<string, unknown>)[mode]
    if (!src || typeof src !== 'object') continue
    const from = src as Record<string, unknown>
    const picks: Picks = {}
    for (const key of HEX_KEYS) {
      const v = from[key]
      if (isHex(v)) picks[key] = v
    }
    const style = from.bannerStyle
    if (typeof style === 'string' && style !== 'glow' && (BANNER_STYLES as readonly string[]).includes(style)) {
      picks.bannerStyle = style as BannerStyle
    }
    const depth = from.depth
    if (mode === 'dark' && Number.isInteger(depth) && (depth as number) > 0 && (depth as number) <= 100) {
      picks.depth = depth as number
    }
    if (Object.keys(picks).length) out[mode] = picks
  }
  return out
}

// ---------------------------------------------------------------- colour maths

type RGB = [number, number, number]
type OKLCH = [number, number, number]

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function rgbToOklch([r, g, b]: RGB): OKLCH {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(a, bb)
  const H = (Math.atan2(bb, a) * 180) / Math.PI
  return [L, C, H < 0 ? H + 360 : H]
}

/** Linear sRGB, unclamped — out of [0, 1] means out of gamut. */
function oklchToLinear([L, C, H]: OKLCH): RGB {
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Nearest sRGB colour, found by giving up chroma rather than shifting the hue. */
function oklchToHex([L, C, H]: OKLCH): string {
  let c = C
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear([L, c, H])
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) break
    c *= 0.93
  }
  return rgbToHex(oklchToLinear([L, c, H]).map(fromLinear) as RGB)
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

type Ground = { page: string; surface: string; sunken: string; raised: string }

/** The app's own grounds, from the `.app-ui` blocks. */
const BASE_GROUND: Record<Mode, Ground> = {
  light: { page: '#ffffff', surface: '#ffffff', sunken: '#f4f6fb', raised: '#ffffff' },
  dark: { page: '#0a0e24', surface: '#10152f', sunken: '#161c3c', raised: '#1a2145' },
}
/** Where dark mode's depth slider ends: black, with the layers still telling apart. */
const BLACK_GROUND: Ground = { page: '#000000', surface: '#0b0b0d', sunken: '#131316', raised: '#18181c' }

function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)]
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB)
}

/** The grounds for a mode, with dark mode's depth (0–100) applied. */
export function groundFor(mode: Mode, depth = 0): Ground {
  const base = BASE_GROUND[mode]
  if (mode === 'light' || !depth) return base
  const t = Math.min(100, Math.max(0, depth)) / 100
  return {
    page: mix(base.page, BLACK_GROUND.page, t),
    surface: mix(base.surface, BLACK_GROUND.surface, t),
    sunken: mix(base.sunken, BLACK_GROUND.sunken, t),
    raised: mix(base.raised, BLACK_GROUND.raised, t),
  }
}

const GROUND = BASE_GROUND

/**
 * The grounds as variables, for the editor's previews: they show the mode
 * being edited, which need not be the mode the page is in, so they cannot lean
 * on `.dark` the way everything else does. Mirrors `.app-ui` / `.dark .app-ui`.
 */
export function previewGround(mode: Mode, depth = 0): Record<string, string> {
  const g = groundFor(mode, depth)
  const ink =
    mode === 'light'
      ? { '--ink': '#10162e', '--ink-muted': '#59627f', '--ink-faint': '#6b738f', '--line': 'rgb(16 22 55 / 0.12)' }
      : { '--ink': '#eef1fa', '--ink-muted': '#a8b0cd', '--ink-faint': '#8890ad', '--line': 'rgb(255 255 255 / 0.11)' }
  return {
    '--page': g.page,
    '--surface': g.surface,
    '--surface-sunken': g.sunken,
    '--surface-raised': g.raised,
    ...ink,
  }
}

const LIGHT_INK = '#fef7e6'
const DARK_INK = '#10162e'

/**
 * Cream or near-black, whichever reads better on `bg`. On a mid-grey neither
 * reaches 4.5:1, so it falls back to pure white or black — one of those two
 * always does (the worst case is 4.58:1).
 */
export function inkFor(bg: string): string {
  const light = contrast(LIGHT_INK, bg)
  const dark = contrast(DARK_INK, bg)
  if (Math.max(light, dark) >= 4.5) return light >= dark ? LIGHT_INK : DARK_INK
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000'
}

/**
 * Moves `fg` lighter or darker, keeping its hue, until it reaches `ratio`
 * against `bg`. Picks the direction with room to get there.
 */
export function withContrast(fg: string, bg: string, ratio: number): string {
  if (contrast(fg, bg) >= ratio) return fg
  const [L, C, H] = rgbToOklch(hexToRgb(fg))
  const up = luminance(bg) < 0.18
  let best = fg
  for (let step = 1; step <= 50; step++) {
    const l = Math.min(1, Math.max(0, L + (up ? 1 : -1) * step * 0.02))
    best = oklchToHex([l, C, H])
    if (contrast(best, bg) >= ratio) return best
  }
  return best
}

// ---------------------------------------------------------------- ramps

export const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
type Stop = (typeof STOPS)[number]

/** Lightness and relative chroma per stop, read off Tailwind's emerald ramp. */
const CURVE: Record<Stop, [number, number]> = {
  50: [0.979, 0.12],
  100: [0.95, 0.31],
  200: [0.905, 0.55],
  300: [0.845, 0.84],
  400: [0.765, 1.04],
  500: [0.696, 1],
  600: [0.596, 0.85],
  700: [0.508, 0.69],
  800: [0.432, 0.56],
  900: [0.378, 0.45],
  950: [0.262, 0.3],
}

/**
 * A full ramp around one colour. The pick itself sits at `anchor` exactly, so
 * the bars and dots that use that stop show what was chosen; the rest follow
 * the product's usual lightness curve in the pick's hue. The text stops (700 on
 * a light tint, 300 on a dark one) are pushed until they read at 4.5:1.
 */
export function ramp(hex: string, anchor: Stop = 500): Record<Stop, string> {
  const [, C, H] = rgbToOklch(hexToRgb(hex))
  const out = {} as Record<Stop, string>
  for (const stop of STOPS) {
    const [l, rel] = CURVE[stop]
    out[stop] = stop === anchor ? hex : oklchToHex([l, C * rel, H])
  }
  out[700] = withContrast(out[700], '#ffffff', 4.5)
  out[800] = withContrast(out[800], '#ffffff', 4.5)
  out[300] = withContrast(out[300], GROUND.dark.surface, 4.5)
  out[200] = withContrast(out[200], GROUND.dark.surface, 4.5)
  return out
}

// ---------------------------------------------------------------- variables

/** Every variable a palette can set, so switching palettes clears the old one. */
export const PALETTE_VARS: readonly string[] = [
  ...(['success', 'warning', 'danger'] as const).flatMap((r) =>
    STOPS.map((s) => `--color-${r}-${s}`),
  ),
  '--banner',
  '--banner-image',
  '--banner-deco',
  '--banner-cell',
  '--banner-ink',
  '--banner-accent',
  '--banner-glow',
  '--banner-edge',
  '--pending-soft',
  '--pending-ink',
  '--nav-icon',
  '--nav-active',
  '--nav-active-ink',
  '--nav-marker',
  '--progress',
  '--badge',
  '--badge-ink',
  '--icon-tile',
  '--icon-glyph',
  '--btn-create',
  '--btn-create-ink',
  '--btn-action',
  '--btn-danger',
  '--u-page',
  '--u-surface',
  '--u-sunken',
  '--u-raised',
  '--u-depth',
]

/** The text colour that reads best on every one of `grounds` at once. */
function inkForAll(grounds: string[]): string {
  const worst = (ink: string) => Math.min(...grounds.map((g) => contrast(ink, g)))
  const preferred = worst(LIGHT_INK) >= worst(DARK_INK) ? LIGHT_INK : DARK_INK
  if (worst(preferred) >= 4.5) return preferred
  return [LIGHT_INK, DARK_INK, '#ffffff', '#000000'].reduce((a, b) => (worst(b) > worst(a) ? b : a))
}

/**
 * Whether banner text can reach 4.5:1 across the whole banner. A gradient
 * between two far-apart colours (black to yellow) has no text colour that
 * reads on both ends, and the editor says so rather than pretending.
 */
export function bannerReadable(picks: Picks, mode: Mode): boolean {
  const d = DEFAULT_PICKS[mode]
  const first = picks.banner ?? d.banner
  const grounds = picks.bannerStyle === 'gradient' ? [first, picks.banner2 ?? d.banner2] : [first]
  const ink = inkForAll(grounds)
  return Math.min(...grounds.map((g) => contrast(ink, g))) >= 4.5
}

/** Pushes `fg` until it reads at `ratio` on the worse of `grounds`. */
function withContrastAll(fg: string, grounds: string[], ratio: number): string {
  let out = fg
  for (let i = 0; i < 3; i++) {
    const worst = grounds.reduce((a, b) => (contrast(out, b) < contrast(out, a) ? b : a))
    if (contrast(out, worst) >= ratio) break
    out = withContrast(out, worst, ratio)
  }
  return out
}

/** The variables for one mode's picks. Slots left untouched set nothing. */
export function toCssVars(picks: Picks | undefined, mode: Mode): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!picks) return vars
  const d = DEFAULT_PICKS[mode]
  const g = groundFor(mode, mode === 'dark' ? picks.depth : 0)

  for (const [key, anchor] of [
    ['success', 500],
    ['warning', 400],
    ['danger', 500],
  ] as const) {
    const pick = picks[key]
    if (!isHex(pick)) continue
    const r = ramp(pick, anchor)
    for (const s of STOPS) vars[`--color-${key}-${s}`] = r[s]
  }

  // ---- banners
  const style = picks.bannerStyle ?? 'glow'
  const first = picks.banner ?? d.banner
  const grounds = style === 'gradient' ? [first, picks.banner2 ?? d.banner2] : [first]
  if (style !== 'glow' || isHex(picks.banner) || isHex(picks.bannerAccent)) {
    vars['--banner'] = first
    vars['--banner-ink'] = inkForAll(grounds)
    // The accent is checked against whatever banner is showing, picked or not:
    // a new banner can make the old accent unreadable.
    const accent = withContrastAll(picks.bannerAccent ?? d.bannerAccent, grounds, 3)
    vars['--banner-accent'] = accent
    vars['--banner-glow'] = accent
    // Outlines on the page in the banner's colour: 3:1 against the page (WCAG
    // 1.4.11), so a banner as dark as the page still leaves a visible edge.
    vars['--banner-edge'] = withContrast(first, g.page, 3)
  }
  if (style !== 'glow') vars['--banner-deco'] = 'hidden'
  if (style === 'gradient') {
    vars['--banner-image'] = `linear-gradient(90deg, ${grounds[0]}, ${grounds[1]})`
    vars['--banner-cell'] = `color-mix(in oklab, ${vars['--banner-ink']} 7%, transparent)`
  }

  // ---- statuses
  if (isHex(picks.pending)) {
    vars['--pending-soft'] = `color-mix(in oklab, ${picks.pending} 16%, transparent)`
    vars['--pending-ink'] = withContrast(picks.pending, mode === 'light' ? '#ffffff' : g.surface, 4.5)
  }

  // ---- sidebar. Icons are graphics, not text: 3:1 is the bar (WCAG 1.4.11).
  if (isHex(picks.navIcon)) vars['--nav-icon'] = withContrast(picks.navIcon, g.surface, 3)
  if (isHex(picks.navActive)) {
    const active = withContrast(picks.navActive, g.sunken, 3)
    vars['--nav-active'] = active
    vars['--nav-active-ink'] = inkFor(active)
    vars['--nav-marker'] = active
  }

  // ---- progress, badges, card icons
  if (isHex(picks.progress)) vars['--progress'] = picks.progress
  if (isHex(picks.badge)) {
    vars['--badge'] = picks.badge
    vars['--badge-ink'] = inkFor(picks.badge)
  }
  if (isHex(picks.iconTile) || isHex(picks.iconGlyph)) {
    const tile = picks.iconTile ?? d.iconTile
    vars['--icon-tile'] = tile
    vars['--icon-glyph'] = withContrast(picks.iconGlyph ?? d.iconGlyph, tile, 3)
  }

  // ---- banner buttons. Outlined ones are text on the banner, so 4.5:1 against
  // every colour the banner shows; a filled one carries its own readable text.
  if (isHex(picks.btnCreate)) {
    vars['--btn-create'] = picks.btnCreate
    vars['--btn-create-ink'] = inkFor(picks.btnCreate)
  }
  if (isHex(picks.btnAction)) vars['--btn-action'] = withContrastAll(picks.btnAction, grounds, 4.5)
  if (isHex(picks.btnDanger)) vars['--btn-danger'] = withContrastAll(picks.btnDanger, grounds, 4.5)

  // ---- background depth, dark mode only
  if (mode === 'dark' && picks.depth) {
    vars['--u-page'] = g.page
    vars['--u-surface'] = g.surface
    vars['--u-sunken'] = g.sunken
    vars['--u-raised'] = g.raised
    // 0–1, for what the grounds alone cannot say: how bright a dialog's edge
    // has to be to stand off a page this dark (`.dialog-panel`).
    vars['--u-depth'] = String(Math.min(100, Math.max(0, picks.depth)) / 100)
  }
  return vars
}

// ---------------------------------------------------------------- the page

const CACHE_KEY = 'collabify.palette'

/** Both modes' variables, ready for `theme.js`, plus the picks they came from. */
type Cache = Record<Mode, Record<string, string>> & { picks?: PaletteColors }

function readCache(): Cache | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Cache) : null
  } catch {
    return null
  }
}

function setVars(vars: Record<string, string>) {
  const style = document.documentElement.style
  for (const name of PALETTE_VARS) style.removeProperty(name)
  for (const [name, value] of Object.entries(vars)) {
    if (PALETTE_VARS.includes(name)) style.setProperty(name, value)
  }
}

/**
 * Makes `colors` the ones in use on this device: sets the current mode's
 * variables and caches both modes for `public/theme.js`.
 */
export function applyPalette(colors: PaletteColors, resolved: Mode) {
  const cache: Cache = {
    light: toCssVars(colors.light, 'light'),
    dark: toCssVars(colors.dark, 'dark'),
    picks: colors,
  }
  try {
    if (Object.keys(cache.light).length || Object.keys(cache.dark).length) {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } else {
      window.localStorage.removeItem(CACHE_KEY)
    }
  } catch {
    // Private windows can refuse storage; the colours still apply to this page.
  }
  setVars(cache[resolved])
}

/** The picks last applied on this device, so a reload starts from them. */
export function readCachedPicks(): PaletteColors {
  if (typeof window === 'undefined') return {}
  return cleanColors(readCache()?.picks)
}

/** Whether two palettes set the same colours, ignoring key order. */
export function samePalette(a: PaletteColors, b: PaletteColors): boolean {
  const flat = (c: PaletteColors) => {
    const clean = cleanColors(c)
    return (['light', 'dark'] as const)
      .flatMap((m) => PICK_KEYS.map((k) => `${m}.${k}=${clean[m]?.[k] ?? ''}`))
      .join('|')
  }
  return flat(a) === flat(b)
}
