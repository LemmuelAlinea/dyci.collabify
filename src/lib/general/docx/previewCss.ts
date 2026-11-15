/**
 * The CSS a drawn Word file brings with it, made safe to put on the page.
 *
 * docx-preview builds its <style> text from the file's style names and values
 * without escaping them, so a crafted file can close a rule and write its own
 * (`x{}*{background:url(https://…)}`), and VML shapes carry their CSS straight
 * into a style attribute. Every sheet is parsed and rebuilt from what survives:
 * style rules whose every selector names one of the preview's own classes,
 * scoped under the preview box; @font-face from the file itself; no other
 * at-rule. In what is kept, and in every inline style, a declaration that could
 * fetch anything outside the file, or pin itself over the page, is dropped.
 */

export type Decl = { prop: string; value: string; important: boolean }
export type Rule = { kind: 'style'; selector: string; decls: Decl[] } | { kind: 'font-face'; decls: Decl[] }

/** The preview box every kept rule is scoped under; :where() keeps the file's own specificity. */
export const PREVIEW_SCOPE = ':where(.docx-preview)'

// The app's own faces: a file's @font-face may not take their names.
const APP_FAMILIES = new Set(['instrument sans', 'jetbrains mono', 'outfit'])

const SAFE_URL = /^(data:|blob:)/i
// A class docx-preview gives its own elements: .docx, .docx-wrapper, .docx_heading1, .docx-num-1-0.
const OWN_CLASS = /\.docx(?:[-_][\w-]*)?(?![\w-])/
// Functions that fetch with a bare string, or draw from elsewhere on the page.
const FETCHING = /(?:^|[^\w-])(?:-webkit-)?(?:image-set|image|cross-fade|element|paint|src)\s*\(/i
const PROP = /^(?:--[\w-]+|-?[a-z][a-z-]*)$/i

/** The value with every quoted string emptied, so what is left is outside strings; null when a string never closes. */
function outsideStrings(value: string): string | null {
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < value.length && value[j] !== c) j += value[j] === '\\' ? 2 : 1
      if (j >= value.length) return null
      out += `${c}${c}`
      i = j
    } else {
      out += c
    }
  }
  return out
}

/** Every url(…) in the value points into the file itself (data: or blob:). */
export function urlsSafe(value: string) {
  const re = /url\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const rest = value.slice(m.index + 4).trimStart()
    let url: string
    if (rest[0] === '"' || rest[0] === "'") {
      const end = rest.indexOf(rest[0], 1)
      if (end < 0) return false
      url = rest.slice(1, end)
    } else {
      const end = rest.indexOf(')')
      if (end < 0) return false
      url = rest.slice(0, end).trim()
    }
    if (!SAFE_URL.test(url)) return false
  }
  return true
}

/** Whether one declaration may stay. */
export function declSafe(d: Decl) {
  if (!PROP.test(d.prop)) return false
  const bare = outsideStrings(d.value)
  // An escape outside a string can spell url( or image-set( past these checks; a
  // top-level `;` would end the declaration early (a data: url keeps its own inside parentheses).
  if (bare === null || /[\\{}<@]/.test(bare) || splitTop(bare, ';').length > 1) return false
  if (FETCHING.test(bare) || !urlsSafe(d.value)) return false
  if (d.prop.toLowerCase() === 'position' && /fixed|sticky/i.test(d.value)) return false
  return true
}

/** Splits at `sep` outside strings, brackets and parentheses. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      i = j
    } else if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** `a: b; c: d !important` as declarations. */
export function parseDecls(text: string): Decl[] {
  const decls: Decl[] = []
  for (const raw of splitTop(text, ';')) {
    const colon = raw.indexOf(':')
    if (colon < 0) continue
    const prop = raw.slice(0, colon).trim()
    let value = raw.slice(colon + 1).trim()
    const important = /!\s*important\s*$/i.test(value)
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim()
    if (prop && value) decls.push({ prop, value, important })
  }
  return decls
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ')

/**
 * The fallback parser, for a browser without constructable style sheets:
 * top-level `prelude { body }` blocks. A block with a brace inside its body
 * (nesting, an @media) is dropped whole, as is anything unbalanced.
 */
export function parseSheetText(text: string): Rule[] {
  const src = stripComments(text)
  const rules: Rule[] = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open < 0) break
    const prelude = src.slice(i, open).trim()
    // Find the matching close, outside strings.
    let depth = 1
    let j = open + 1
    let nested = false
    while (j < src.length && depth > 0) {
      const c = src[j]
      if (c === '"' || c === "'") {
        let k = j + 1
        while (k < src.length && src[k] !== c) k += src[k] === '\\' ? 2 : 1
        j = k
      } else if (c === '{') {
        depth += 1
        nested = true
      } else if (c === '}') depth -= 1
      j += 1
    }
    if (depth > 0) break
    const body = src.slice(open + 1, j - 1)
    // A statement at-rule before the block (`@import x; p {…}`) leaves its text in the prelude.
    const last = prelude.slice(prelude.lastIndexOf(';') + 1).trim()
    if (!nested && last) {
      if (/^@font-face$/i.test(last)) rules.push({ kind: 'font-face', decls: parseDecls(body) })
      else if (!last.startsWith('@')) rules.push({ kind: 'style', selector: last, decls: parseDecls(body) })
    }
    i = j
  }
  return rules
}

/** The browser's own parser, through a constructable style sheet; null where there is none. */
export function parseSheetCssom(text: string): Rule[] | null {
  if (typeof CSSStyleSheet === 'undefined' || typeof CSSStyleSheet.prototype.replaceSync !== 'function') return null
  const sheet = new CSSStyleSheet()
  try {
    sheet.replaceSync(text)
  } catch {
    return []
  }
  const rules: Rule[] = []
  for (const r of Array.from(sheet.cssRules)) {
    // 1: a style rule; 5: @font-face. Nested rules and every other at-rule are left out.
    const style = (r as CSSStyleRule).style
    if (!style) continue
    if (r.type === 1) rules.push({ kind: 'style', selector: (r as CSSStyleRule).selectorText, decls: parseDecls(style.cssText) })
    else if (r.type === 5) rules.push({ kind: 'font-face', decls: parseDecls(style.cssText) })
  }
  return rules
}

const serializeDecls = (decls: Decl[]) =>
  decls.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''};`).join(' ')

/** A selector list scoped under the preview box, or null when any part could reach outside it. */
export function scopeSelector(selector: string): string | null {
  if (/[{};@\\<"']/.test(selector)) return null
  const parts = splitTop(selector, ',').map((s) => s.trim())
  if (parts.length === 0 || parts.some((p) => !p || !OWN_CLASS.test(p))) return null
  return parts.map((p) => `${PREVIEW_SCOPE} ${p}`).join(', ')
}

/** Rebuilds parsed rules into sheet text, keeping only what is safe. */
export function rebuildSheet(rules: Rule[]): string {
  const out: string[] = []
  for (const rule of rules) {
    const decls = rule.decls.filter(declSafe)
    if (rule.kind === 'font-face') {
      const family = decls.find((d) => d.prop.toLowerCase() === 'font-family')?.value.replace(/["']/g, '').trim().toLowerCase()
      const src = decls.find((d) => d.prop.toLowerCase() === 'src')
      // Kept only with its font inside the file, and never under one of the app's own names.
      if (!family || APP_FAMILIES.has(family) || !src || !/url\(/i.test(src.value)) continue
      out.push(`@font-face { ${serializeDecls(decls)} }`)
      continue
    }
    const selector = scopeSelector(rule.selector)
    if (!selector || decls.length === 0) continue
    out.push(`${selector} { ${serializeDecls(decls)} }`)
  }
  return out.join('\n')
}

/** A <style> element's text made safe; `cssom: false` forces the fallback parser. */
export function safeSheetText(text: string, cssom = true): string {
  const rules = (cssom ? parseSheetCssom(text) : null) ?? parseSheetText(text)
  return rebuildSheet(rules)
}

/** Drops every inline declaration that could fetch from outside the file or pin itself over the page. */
export function sanitizeInlineStyle(el: Element) {
  const raw = el.getAttribute('style')
  if (raw === null) return
  const kept = parseDecls(stripComments(raw)).filter(declSafe)
  if (kept.length === 0) el.removeAttribute('style')
  else el.setAttribute('style', serializeDecls(kept))
}
