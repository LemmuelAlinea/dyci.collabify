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

import { DOCX_OPTIONS, DocxPreview, localFaces, renderDocx, sanitizePreview, sanitizeStyles } from './DocxPreview'

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
    expect(host.textContent).toContain('Beta text')
    expect(host.textContent).not.toContain('Alpha text')
    expect(host.textContent).not.toContain('Drawing the pages')
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
    expect(imgs[1].getAttribute('src')).toBe('blob:https://app.test/1')
    expect(imgs[2].hasAttribute('src')).toBe(false)
    expect(imgs[3].hasAttribute('src')).toBe(false)
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

describe('DOCX_OPTIONS', () => {
  it('turns off embedded HTML (altChunk) rendering', () => {
    expect(DOCX_OPTIONS.renderAltChunks).toBe(false)
  })
})
