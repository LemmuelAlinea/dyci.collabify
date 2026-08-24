#!/usr/bin/env node
// Buttons that show an icon and nothing else must say what they do.
//
//   node scripts/a11y-names.mjs
//
// A button whose only child is <Icon/> is announced as "button" and nothing
// more, which on a page of nine of them leaves a screen-reader user guessing.
// It needs aria-label, aria-labelledby or title.
//
// The parsing is deliberate rather than a regex over the whole tag: `onClick={
// () => x}` contains a `>`, so the obvious pattern ends the opening tag in the
// middle of an arrow function and reads the rest as the body.

import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BACKSLASH = String.fromCharCode(92)

// The `>` that really ends a JSX opening tag: not inside a string, not the one
// in an arrow function, not nested in a {...} expression.
function tagEnd(src, from) {
  let depth = 0
  let quote = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote && src[i - 1] !== BACKSLASH) quote = null
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
    } else if (c === '>' && depth === 0 && src[i - 1] !== '=') {
      return i
    }
  }
  return -1
}

function closeTag(src, from, tag) {
  const open = new RegExp('<' + tag + '\\b', 'g')
  const close = new RegExp('</' + tag + '>', 'g')
  let depth = 1
  let i = from
  while (depth > 0) {
    open.lastIndex = i
    close.lastIndex = i
    const o = open.exec(src)
    const c = close.exec(src)
    if (!c) return -1
    if (o && o.index < c.index) {
      depth++
      i = o.index + 1
    } else {
      depth--
      i = c.index + 1
      if (depth === 0) return c.index
    }
  }
  return -1
}

const files = execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8' })
  .trim()
  .split('\n')

let hits = 0
for (const f of files) {
  // `git ls-files` still lists a file that has been deleted but not yet staged,
  // which is an ordinary state to be in mid-change. Skipping beats crashing:
  // a checker that falls over during normal work is a checker people turn off.
  if (!existsSync(f)) continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/<button\b/g)) {
    const gt = tagEnd(src, m.index)
    if (gt < 0) continue
    if (src[gt - 1] === '/') continue
    const attrs = src.slice(m.index, gt)
    if (/aria-label|aria-labelledby|title=/.test(attrs)) continue

    const end = closeTag(src, gt, 'button')
    if (end < 0) continue
    const body = src.slice(gt + 1, end)

    // Strip only what renders no text: the icon elements themselves. Anything
    // left — a child <span>, a {variable}, a ternary — is a label. Treating
    // `{v}` as empty is what made the first version of this cry wolf on
    // fourteen buttons that were all correctly named.
    const hasIcon = /<(Icon|Spinner|Avatar|LogoMark)\b/.test(body)
    const rest = body
      .replace(/<(Icon|Spinner|Avatar|LogoMark)\b[^>]*\/>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!rest && hasIcon) {
      console.log(`${f}:${src.slice(0, m.index).split('\n').length}`)
      hits++
    }
  }
}
console.log(`\n${hits} icon-only buttons with no accessible name`)
