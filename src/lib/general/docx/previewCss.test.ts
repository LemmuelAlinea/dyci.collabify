// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { declSafe, parseSheetCssom, safeSheetText, sanitizeInlineStyle, scopeSelector, urlsSafe } from './previewCss'

const DATA_FONT = 'data:font/woff2;base64,AAAA'

// Both parsers, so a browser without constructable sheets gets the same result.
describe.each([
  ['the browser parser', true],
  ['the fallback parser', false],
])('safeSheetText with %s', (_name, cssom) => {
  const safe = (text: string) => safeSheetText(text, cssom)

  it('runs where the browser parser exists, so both paths are covered', () => {
    expect(parseSheetCssom('.docx{}')).not.toBeNull()
  })

  it('keeps a normal .docx rule, scoped under the preview box', () => {
    const out = safe('.docx p { margin: 0pt; min-height: 1em; }')
    expect(out).toContain(':where(.docx-preview) .docx p {')
    expect(out).toContain('min-height: 1em')
  })

  it("keeps docx-preview's own rule shapes", () => {
    const out = safe(
      '.docx-wrapper>section.docx { background: white; }\n' +
        'p.docx_heading1 span { font-weight: bold; }\n' +
        '.docx p, p.docx_normal { color: black; }\n' +
        'p.docx-num-1-0:before { content: "1."; counter-increment: docx-num-1-0; }\n' +
        '.docx { --docx-accent1-color: #4472c4; }',
    )
    expect(out).toContain('section.docx')
    expect(out).toContain('p.docx_heading1 span')
    expect(out).toContain(':where(.docx-preview) .docx p, :where(.docx-preview) p.docx_normal')
    expect(out).toContain('docx-num-1-0')
    expect(out).toContain('--docx-accent1-color')
  })

  it('drops a selector that breaks out of its rule', () => {
    const out = safe('p.docx_x{}*{background:url(https://evil.test/p)}body{display:none}')
    expect(out).not.toContain('evil.test')
    expect(out).not.toMatch(/(^|[\s,}])\*\s*\{/)
    expect(out).not.toContain('body')
  })

  it('drops a list with any part outside the preview', () => {
    expect(safe('.docx p, body { color: red; }')).toBe('')
  })

  it('removes a remote url() from a kept rule and keeps the rest', () => {
    const out = safe('.docx p { color: red; background-image: url("https://evil.test/a.png"); }')
    expect(out).toContain('color: red')
    expect(out).not.toContain('evil.test')
    expect(out).not.toContain('url(')
  })

  it('removes position fixed and sticky', () => {
    const out = safe('.docx p { position: fixed; top: 0; } .docx span { position: sticky; } section.docx { position: relative; }')
    expect(out).not.toMatch(/fixed|sticky/)
    expect(out).toContain('position: relative')
  })

  it('keeps a font-face from the file and drops a remote one', () => {
    expect(safe(`@font-face { font-family: 'Book Face'; src: url(${DATA_FONT}); }`)).toContain('@font-face')
    expect(safe("@font-face { font-family: 'Book Face'; src: url(https://evil.test/f.woff2); }")).toBe('')
  })

  it("never lets a font take one of the app's own names", () => {
    expect(safe(`@font-face { font-family: 'Instrument Sans'; src: url(${DATA_FONT}); }`)).toBe('')
  })

  it('drops @import, @media and other at-rules', () => {
    const out = safe('@import url(https://evil.test/x.css); @media print { .docx { color: red; } } .docx { color: black; }')
    expect(out).not.toContain('@import')
    expect(out).not.toContain('@media')
    expect(out).not.toContain('evil.test')
    expect(out).toContain('color: black')
  })
})

describe('scopeSelector', () => {
  it('needs one of the preview classes in every part', () => {
    expect(scopeSelector('p.docx_a')).toBe(':where(.docx-preview) p.docx_a')
    expect(scopeSelector('p.docxfoo')).toBeNull()
    expect(scopeSelector('.docx p, div')).toBeNull()
    expect(scopeSelector('.docx p { }')).toBeNull()
  })
})

describe('declSafe and urlsSafe', () => {
  const d = (prop: string, value: string) => declSafe({ prop, value, important: false })
  it('passes data: and blob: urls and refuses the rest', () => {
    expect(urlsSafe('url(data:image/png;base64,AA)')).toBe(true)
    expect(urlsSafe("url('blob:https://app.test/1')")).toBe(true)
    expect(urlsSafe('url(https://evil.test/a)')).toBe(false)
    expect(urlsSafe('url(//evil.test/a)')).toBe(false)
    expect(urlsSafe('url(https://evil.test/a')).toBe(false)
  })
  it('refuses fetching functions, escapes and broken strings', () => {
    expect(d('background', 'image-set("https://evil.test/a.png" 1x)')).toBe(false)
    expect(d('background', '-webkit-image-set("https://evil.test/a.png" 1x)')).toBe(false)
    expect(d('background', 'u\\72l(https://evil.test/a)')).toBe(false)
    expect(d('content', '"open')).toBe(false)
    expect(d('content', '"\\9"')).toBe(true)
    expect(d('b\\61ckground', 'red')).toBe(false)
  })
})

describe('sanitizeInlineStyle', () => {
  function styled(style: string) {
    const el = document.createElement('div')
    el.setAttribute('style', style)
    sanitizeInlineStyle(el)
    return el
  }
  it('removes a remote url() and position fixed, and keeps the rest', () => {
    const el = styled('width: 10pt; background: url(https://evil.test/p.png); position: fixed; color: red')
    const out = el.getAttribute('style') ?? ''
    expect(out).toContain('width: 10pt')
    expect(out).toContain('color: red')
    expect(out).not.toContain('evil.test')
    expect(out).not.toContain('fixed')
  })
  it('drops the attribute when nothing is left', () => {
    expect(styled('position: fixed').hasAttribute('style')).toBe(false)
  })
})
