#!/usr/bin/env node
// Contrast ratios computed from the tokens in src/styles/index.css.
//
//   node scripts/contrast.mjs
//
// WCAG 2.1: 4.5:1 for body text, 3:1 for large text (>=18.66px bold or 24px)
// and for the boundary of a user-interface component. Both themes are checked,
// because a pair that passes in light can fail in dark and the tokens are
// defined in one block precisely so that is easy to miss.

import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/index.css', 'utf8')

function vars(block) {
  const out = {}
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

// Match the block openers exactly: `.dark` also appears in the @custom-variant
// line on line 3, and slicing from there returns nothing.
//
// There are four scopes, not two. The signed-in app redefines the same tokens
// under `.app-ui`, and the slice for `dark` used to run all the way to
// `@layer utilities` — which swallowed both app blocks, so the numbers printed
// under "dark" were really the app's, and the app's own pairs were never
// checked at all. A checker reporting on the wrong block is worse than no
// checker: it passes while the thing it names is broken.
const at = (needle) => {
  const i = css.indexOf(needle)
  if (i < 0) throw new Error(`contrast.mjs: cannot find the block opener ${needle}`)
  return i
}
const theme = vars(css.slice(at('@theme'), at('@layer base')))
const light = vars(css.slice(at(':root {'), at('.dark {')))
const dark = vars(css.slice(at('.dark {'), at('.app-ui {')))
const appLight = vars(css.slice(at('.app-ui {'), at('.dark .app-ui {')))
const appDark = vars(css.slice(at('.dark .app-ui {'), at('.app-ui .btn {')))

function rgb(value, scope) {
  let v = (value || '').trim()
  // one level of indirection: --ring: var(--color-navy-500)
  const ref = v.match(/^var\((--[\w-]+)\)$/)
  if (ref) v = scope[ref[1]] ?? theme[ref[1]] ?? ''
  let m = v.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  return null
}

/** Flatten a translucent colour onto its background — the line tokens are rgba. */
function over(fg, bg) {
  const a = fg[3] ?? 1
  if (a >= 1) return fg
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [label, foreground token, background token, required ratio]
const PAIRS = [
  ['body text on the page', '--ink', '--page', 4.5],
  ['body text on a card', '--ink', '--surface', 4.5],
  ['body text on a sunken panel', '--ink', '--surface-sunken', 4.5],
  ['muted text on a card', '--ink-muted', '--surface', 4.5],
  ['muted text on the page', '--ink-muted', '--page', 4.5],
  ['muted text on a sunken panel', '--ink-muted', '--surface-sunken', 4.5],
  ['faint text on a card', '--ink-faint', '--surface', 4.5],
  ['faint text on the page', '--ink-faint', '--page', 4.5],
  ['focus ring against the page', '--ring', '--page', 3],
  ['focus ring against a card', '--ring', '--surface', 3],
  ['control border on a card', '--control-line', '--surface', 3],
  ['control border on a sunken panel', '--control-line', '--surface-sunken', 3],
  ['control border on the page', '--control-line', '--page', 3],
  // Decorative only — WCAG 1.4.11 covers the boundary of a control, not a rule
  // between two paragraphs, so these are reported without a threshold.
  ['divider against a card (decorative)', '--line-strong', '--surface', 0],
  ['hairline against a card (decorative)', '--line', '--surface', 0],
]

let failures = 0
for (const [name, scope] of [
  ['light', light],
  ['dark', dark],
  ['app · light', appLight],
  ['app · dark', appDark],
]) {
  console.log(`\n${name}`)
  for (const [label, fgTok, bgTok, need] of PAIRS) {
    const bg = rgb(scope[bgTok], scope)
    let fg = rgb(scope[fgTok], scope)
    if (!bg || !fg) {
      console.log(`  ?     ${label} — token missing`)
      continue
    }
    fg = over(fg, bg)
    const r = ratio(fg, bg)
    const ok = r >= need
    if (!ok) failures++
    console.log(
      need === 0
        ? `  --    ${r.toFixed(2)}:1  ${label}`
        : `  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2)}:1  (needs ${need})  ${label}`,
    )
  }
}

// The one pair that is not a token against a token: the accent, which carries
// dark text by design wherever it is used as a fill.
const amber = rgb(theme['--color-amber-400'], theme)
const navy900 = rgb(theme['--color-navy-900'], theme)
console.log(
  `\nboth\n  ${ratio(navy900, amber) >= 4.5 ? 'pass' : 'FAIL'}  ` +
    `${ratio(navy900, amber).toFixed(2)}:1  (needs 4.5)  navy-900 on the amber-400 accent`,
)
if (ratio(navy900, amber) < 4.5) failures++

console.log(`\n${failures} failing pair${failures === 1 ? '' : 's'}.`)
process.exit(failures > 0 ? 1 : 0)
