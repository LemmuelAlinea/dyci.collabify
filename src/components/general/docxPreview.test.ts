// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const blobs = new Map<string, Blob>()
vi.mock('../../lib/api/general', () => ({
  projectFileBlob: vi.fn(async (path: string) => blobs.get(path)),
  projectFileUrl: vi.fn(async () => 'https://example.test/file'),
}))

import {
  DOCX_OPTIONS,
  DocxPreview,
  FRAME_CSP,
  frameDocument,
  keepAnchorsInside,
  localFaces,
  renderDocx,
  sanitizePreview,
  sanitizeStyles,
  wordFontCss,
} from './DocxPreview'

async function docx(text: string) {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }] })
  return Packer.toBlob(doc)
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 300)) })

describe('renderDocx', () => {
  it('draws a page section with the text', async () => {
    const pages = document.createElement('div')
    await renderDocx(await docx('Chapter One'), pages, document.createElement('div'))
    const section = pages.querySelector('section.docx')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('Chapter One')
  })

  it("keeps docx-preview's own style elements as they are, for the frame", async () => {
    const styles = document.createElement('div')
    await renderDocx(await docx('Chapter One'), document.createElement('div'), styles)
    const text = [...styles.querySelectorAll('style')].map((s) => s.textContent).join(' ')
    expect(text).toContain('.docx-wrapper')
  })
})

describe('DocxPreview', () => {
  it('ends a corrupt file in the note with Download, not a spinner', async () => {
    blobs.set('bad', new Blob(['not a zip']))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(DocxPreview, { storagePath: 'bad', label: 'bad.docx' })) })
    await settle()
    expect(host.textContent).toContain('opened elsewhere')
    expect(host.textContent).not.toContain('Drawing the pages')
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Download'))).toBe(true)
    await act(async () => root.unmount())
  })

  it('recovers when the path changes after a failure, and shows only the new text', async () => {
    blobs.set('bad', new Blob(['not a zip']))
    blobs.set('a', await docx('Alpha text'))
    blobs.set('b', await docx('Beta text'))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const show = (p: string) => act(async () => { root.render(createElement(DocxPreview, { storagePath: p, label: `${p}.docx` })) })
    await show('bad')
    await settle()
    await show('a')
    await show('b')
    await settle()
    const frames = host.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0].getAttribute('srcdoc')).toContain('Beta text')
    expect(frames[0].getAttribute('srcdoc')).not.toContain('Alpha text')
    expect(host.textContent).not.toContain('opened elsewhere')
    await act(async () => root.unmount())
  })
})

describe('localFaces', () => {
  it('names the exact face per weight and style', () => {
    expect(localFaces('Times New Roman', '700', 'normal')).toContain('Times New Roman Bold')
    expect(localFaces('Times New Roman', '400', 'italic')).toContain('Times New Roman Italic')
    expect(localFaces('Calibri', '700', 'italic')).toContain('Calibri Bold Italic')
  })
})

describe('sanitizePreview', () => {
  function tree(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    sanitizePreview(root)
    return root
  }

  it('removes iframes, scripts and other active elements', () => {
    const root = tree(
      '<p>Text</p><iframe srcdoc="<script>alert(1)</script>"></iframe><script>alert(1)</script>' +
        '<object data="x"></object><embed src="x"><form action="x"></form><base href="https://evil.test/">' +
        '<meta http-equiv="refresh" content="0"><link rel="stylesheet" href="x">',
    )
    expect(root.querySelector('iframe, script, object, embed, form, base, meta, link')).toBeNull()
    expect(root.textContent).toContain('Text')
  })

  it('removes a javascript: link but keeps its text', () => {
    const root = tree('<a href="javascript:alert(1)">Click</a><a href=" JaVaScRiPt:alert(1)">Two</a>')
    const links = root.querySelectorAll('a')
    expect(links[0].hasAttribute('href')).toBe(false)
    expect(links[1].hasAttribute('href')).toBe(false)
    expect(root.textContent).toBe('ClickTwo')
  })

  it('removes every on* attribute', () => {
    const root = tree('<p onclick="alert(1)" onmouseover="alert(2)" class="x">Hi</p><img src="data:image/png;base64,AA" onerror="alert(3)">')
    expect(root.querySelector('p')!.getAttributeNames()).toEqual(['class'])
    expect(root.querySelector('img')!.hasAttribute('onerror')).toBe(false)
  })

  it('keeps an https link and opens it in a new tab without an opener', () => {
    const a = tree('<a href="https://example.test/page">Site</a>').querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.test/page')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('keeps mailto and in-document links, the latter in place', () => {
    const root = tree('<a href="mailto:ana@example.test">Mail</a><a href="#_Toc1">Contents</a>')
    const [mail, toc] = [...root.querySelectorAll('a')]
    expect(mail.getAttribute('href')).toBe('mailto:ana@example.test')
    expect(toc.getAttribute('href')).toBe('#_Toc1')
    expect(toc.hasAttribute('target')).toBe(false)
  })

  it('keeps a data:image picture and drops any other source', () => {
    const root = tree('<img src="data:image/png;base64,AAAA"><img src="blob:https://app.test/1"><img src="https://tracker.test/p.gif"><img src="data:text/html,x">')
    const imgs = [...root.querySelectorAll('img')]
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(imgs[1].hasAttribute('src')).toBe(false)
    expect(imgs[2].hasAttribute('src')).toBe(false)
    expect(imgs[3].hasAttribute('src')).toBe(false)
  })

  it('removes raw-text elements that would keep markup through serialization', () => {
    const root = tree('<xmp>&lt;/xmp&gt;</xmp><noembed>x</noembed><noframes>x</noframes><textarea>x</textarea><p>kept</p>')
    expect(root.querySelector('xmp, noembed, noframes, textarea')).toBeNull()
    expect(root.textContent).toBe('kept')
  })
})

describe('sanitizeStyles', () => {
  it('keeps only style elements', () => {
    const box = document.createElement('div')
    box.innerHTML = '<style>.a{}</style><script>alert(1)</script><p>x</p><style>.b{}</style>'
    sanitizeStyles(box)
    expect([...box.childNodes].map((n) => n.nodeName)).toEqual(['STYLE', 'STYLE'])
  })
})

describe('sanitizePreview style elements', () => {

  it('removes a style element from the pages', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>x</p><style>*{display:none}</style>'
    sanitizePreview(root)
    expect(root.querySelector('style')).toBeNull()
  })
})

describe('DOCX_OPTIONS', () => {
  it('turns off embedded HTML (altChunk) rendering', () => {
    expect(DOCX_OPTIONS.renderAltChunks).toBe(false)
  })
})

describe('frameDocument', () => {
  function parts(stylesHtml: string, pagesHtml: string) {
    const styles = document.createElement('div')
    styles.innerHTML = stylesHtml
    const pages = document.createElement('div')
    pages.innerHTML = pagesHtml
    return frameDocument(styles, pages, 'rgb(238, 240, 244)')
  }

  it('puts the Content-Security-Policy first in the head', () => {
    const html = parts('<style>.docx{}</style>', '<p>x</p>')
    expect(html.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`)).toBe(true)
    expect(FRAME_CSP).toContain("default-src 'none'")
    expect(FRAME_CSP).toContain('img-src data:;')
    expect(FRAME_CSP).not.toContain('blob:')
  })

  it('keeps the order: policy, the file styles, the font twins, the paper, then the pages', () => {
    const html = parts('<style>.docx { color: black; }</style>', '<section class="docx">Page</section>')
    const at = (needle: string) => html.indexOf(needle)
    expect(at('Content-Security-Policy')).toBeLessThan(at('.docx { color: black; }'))
    expect(at('.docx { color: black; }')).toBeLessThan(at('@font-face'))
    expect(at('@font-face')).toBeLessThan(at('section.docx { background: #ffffff'))
    expect(at('section.docx { background: #ffffff')).toBeLessThan(at('<body>'))
    expect(html).toContain('<section class="docx">Page</section>')
  })

  it('cannot be ended early from inside a style', () => {
    const html = parts('<style>p.docx_a{}</style><meta http-equiv=refresh content=0></style>', '')
    expect(html).not.toContain('</style><meta')
    expect(html).not.toMatch(/<meta http-equiv=.?refresh/i)
  })
})

describe('wordFontCss', () => {
  it("names each twin as Word's font, with the installed face first", () => {
    const css = wordFontCss()
    expect(css).toContain('font-family: "Times New Roman"')
    expect(css).toContain('local("Times New Roman")')
    expect(css.indexOf('local("Calibri")')).toBeLessThan(css.indexOf('woff2', css.indexOf('local("Calibri")')))
  })
})

describe('keepAnchorsInside', () => {
  function frameDoc() {
    const doc = document.implementation.createHTMLDocument('frame')
    doc.body.innerHTML =
      '<a id="toc" href="#_Toc1"><span>Chapter 1</span></a><a id="mark" href="#Figure%201">Figure</a>' +
      '<a id="web" href="https://example.test/x">Site</a><a id="mail" href="mailto:ana@example.test">Mail</a>' +
      '<a id="gone" href="#missing">Gone</a><p id="_Toc1">Chapter 1</p><a name="Figure 1"></a>'
    const scrollTo = vi.fn()
    keepAnchorsInside(doc, scrollTo)
    const click = (el: Element) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      return e
    }
    return { doc, scrollTo, click }
  }

  it('keeps an in-file link in the frame and scrolls to its target', () => {
    const { doc, scrollTo, click } = frameDoc()
    const e = click(doc.querySelector('#toc span')!)
    expect(e.defaultPrevented).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith(doc.getElementById('_Toc1'))
  })

  it('finds a bookmark by its name', () => {
    const { doc, scrollTo, click } = frameDoc()
    expect(click(doc.getElementById('mark')!).defaultPrevented).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith(doc.getElementsByName('Figure 1')[0])
  })

  it('keeps a link to a missing target from navigating, without scrolling', () => {
    const { doc, scrollTo, click } = frameDoc()
    expect(click(doc.getElementById('gone')!).defaultPrevented).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves web and mail links alone', () => {
    const { doc, scrollTo, click } = frameDoc()
    expect(click(doc.getElementById('web')!).defaultPrevented).toBe(false)
    expect(click(doc.getElementById('mail')!).defaultPrevented).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('comments', () => {
  it('removes comment nodes from the pages', () => {
    const root = document.createElement('div')
    root.innerHTML = '<!--docxjs comment--><section class="docx"><p>Text<!-- a note --></p></section>'
    sanitizePreview(root)
    expect(root.innerHTML).toBe('<section class="docx"><p>Text</p></section>')
  })

  it('pins Word comments off in the renderer', () => {
    expect(DOCX_OPTIONS.renderComments).toBe(false)
  })
})
