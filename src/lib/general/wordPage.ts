/**
 * Page size and fonts for Word files.
 *
 * A Word file is stored as HTML (`general_blobs.content`). Its page size rides
 * along as an empty marker in front of the body — `<div data-page="a4"></div>`
 * — and Letter, the default, writes no marker, so files from before this have
 * exactly the HTML they always had.
 */

export type PageSizeId = 'letter' | 'a4' | 'legal' | 'long'

/** Pixels at 96 per inch, for the screen; twips (1440 per inch) for the .docx. */
export const PAGE_SIZES: Record<PageSizeId, { label: string; width: number; height: number; twipsW: number; twipsH: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', width: 816, height: 1056, twipsW: 12240, twipsH: 15840 },
  a4: { label: 'A4 (21 × 29.7 cm)', width: 794, height: 1123, twipsW: 11906, twipsH: 16838 },
  legal: { label: 'Legal (8.5 × 14 in)', width: 816, height: 1344, twipsW: 12240, twipsH: 20160 },
  long: { label: 'Long (8.5 × 13 in)', width: 816, height: 1248, twipsW: 12240, twipsH: 18720 },
}

/** One inch, Word's default margin on every side. */
export const PAGE_MARGIN = 96

const MARKER = /^\s*<div data-page="(letter|a4|legal|long)"><\/div>/

export function readPageSetting(html: string): { page: PageSizeId; body: string } {
  const m = html.match(MARKER)
  if (!m) return { page: 'letter', body: html }
  return { page: m[1] as PageSizeId, body: html.slice(m[0].length) }
}

export function writePageSetting(page: PageSizeId, body: string) {
  return page === 'letter' ? body : `<div data-page="${page}"></div>${body}`
}

/** The page size closest to a .docx section's width and height, in twips. */
export function pageSizeFromTwips(w: number, h: number): PageSizeId {
  let best: PageSizeId = 'letter'
  let gap = Infinity
  for (const [id, s] of Object.entries(PAGE_SIZES) as [PageSizeId, (typeof PAGE_SIZES)[PageSizeId]][]) {
    const d = Math.abs(s.twipsW - Math.min(w, h)) + Math.abs(s.twipsH - Math.max(w, h))
    if (d < gap) {
      gap = d
      best = id
    }
  }
  return best
}

/*
 * Fonts. Office's own fonts are not on most phones and tablets, so each comes
 * with a metric-compatible stand-in served by the site (Carlito for Calibri and
 * so on): the same letter widths, so a page breaks in the same place.
 */
export const WORD_FONTS: { name: string; stack: string }[] = [
  { name: 'Calibri', stack: 'Calibri, Carlito, sans-serif' },
  { name: 'Arial', stack: 'Arial, Arimo, Helvetica, sans-serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", Tinos, Times, serif' },
  { name: 'Cambria', stack: 'Cambria, Caladea, Georgia, serif' },
  { name: 'Georgia', stack: 'Georgia, Tinos, serif' },
  { name: 'Verdana', stack: 'Verdana, Arimo, sans-serif' },
  { name: 'Tahoma', stack: 'Tahoma, Arimo, sans-serif' },
  { name: 'Garamond', stack: 'Garamond, Caladea, serif' },
  { name: 'Century Gothic', stack: '"Century Gothic", Arimo, sans-serif' },
  { name: 'Courier New', stack: '"Courier New", Cousine, monospace' },
]

export const DEFAULT_FONT = WORD_FONTS[0]

/** The first family in a CSS font stack, unquoted: what Word calls the font. */
export function fontName(stack: string | null | undefined) {
  if (!stack) return ''
  return stack.split(',')[0].trim().replace(/^["']|["']$/g, '')
}

/** A font name from a .docx, as a stack this site can draw. */
export function fontStack(name: string) {
  const known = WORD_FONTS.find((f) => f.name.toLowerCase() === name.toLowerCase())
  if (known) return known.stack
  const quoted = /\s/.test(name) ? `"${name}"` : name
  return `${quoted}, ${/mono|courier|consol/i.test(name) ? 'monospace' : /serif|roman|garamond|book|cambria/i.test(name) ? 'serif' : 'sans-serif'}`
}

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

/*
 * Document colours. These are what lands in somebody's file, not interface
 * colours, so they are Word's own palette rather than this site's tokens.
 */
export const TEXT_COLORS = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050',
  '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
]

/** Word's highlighter colours, by the name a .docx uses for each. */
export const HIGHLIGHTS: { name: string; hex: string }[] = [
  { name: 'yellow', hex: '#ffff00' },
  { name: 'green', hex: '#00ff00' },
  { name: 'cyan', hex: '#00ffff' },
  { name: 'magenta', hex: '#ff00ff' },
  { name: 'blue', hex: '#0000ff' },
  { name: 'red', hex: '#ff0000' },
  { name: 'darkBlue', hex: '#000080' },
  { name: 'darkCyan', hex: '#008080' },
  { name: 'darkGreen', hex: '#008000' },
  { name: 'darkMagenta', hex: '#800080' },
  { name: 'darkRed', hex: '#800000' },
  { name: 'darkYellow', hex: '#808000' },
  { name: 'darkGray', hex: '#808080' },
  { name: 'lightGray', hex: '#c0c0c0' },
  { name: 'black', hex: '#000000' },
]

/** CSS colour (hex or rgb()) as six hex digits, or null. */
export function hexOf(color: string | null | undefined): string | null {
  if (!color) return null
  const c = color.trim().toLowerCase()
  const short = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/)
  if (short) return short.slice(1).map((d) => d + d).join('')
  const long = c.match(/^#([0-9a-f]{6})$/)
  if (long) return long[1]
  const rgb = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  return null
}
