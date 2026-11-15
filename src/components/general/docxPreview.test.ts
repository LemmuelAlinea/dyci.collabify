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

import { DocxPreview, localFaces, renderDocx } from './DocxPreview'

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
