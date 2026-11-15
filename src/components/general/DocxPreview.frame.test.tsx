// @vitest-environment happy-dom
// The frame's structure. happy-dom does not enforce Content-Security-Policy or
// sandbox flags, so these check what the browser is handed; the browser does the rest.
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ fail: false }))

// Bypass A from the re-review: a string cut by a raw newline hides live CSS after it.
const CRAFTED_STYLE = "color: 'a\n; background: u\\72l(https://evil.test/p); position: fixed; inset: 0; x: '"

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_blob: Blob, body: HTMLElement, styles: HTMLElement) => {
    if (m.fail) throw new Error('not a zip')
    const style = document.createElement('style')
    style.textContent = '*{background:url(https://evil.test/s)} .docx-wrapper{}'
    styles.append(style, document.createElement('p'))
    body.innerHTML =
      '<div class="docx-wrapper"><section class="docx" style="width: 612pt">' +
      '<p onclick="alert(1)">Chapter text</p><script>alert(2)</script><iframe src="https://evil.test/f"></iframe>' +
      '<a href="https://example.test/x">Site</a><a href="javascript:alert(3)">Bad</a>' +
      '<svg><rect></rect></svg></section></div>'
    body.querySelector('rect')!.setAttribute('style', CRAFTED_STYLE)
  }),
}))
vi.mock('../../lib/api/general', () => ({
  projectFileBlob: vi.fn(async () => new Blob(['x'])),
  projectFileUrl: vi.fn(async () => 'https://example.test/file'),
}))

import { DocxPreview, FRAME_CSP } from './DocxPreview'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  m.fail = false
})

async function show() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<DocxPreview storagePath="p/files/a.docx" label="a.docx" />))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  return host.querySelector('iframe')
}

it('draws the pages in a sandboxed frame without scripts, its policy first', async () => {
  const frame = (await show())!
  expect(frame).not.toBeNull()
  const sandbox = frame.getAttribute('sandbox') ?? ''
  expect(sandbox.split(/\s+/).sort()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-same-origin'])
  expect(sandbox).not.toContain('allow-scripts')
  expect(sandbox).not.toContain('allow-top-navigation')
  const html = frame.getAttribute('srcdoc') ?? ''
  expect(html.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`)).toBe(true)
})

it('strips script, iframe, on* and unsafe links before the frame gets them', async () => {
  const html = (await show())!.getAttribute('srcdoc') ?? ''
  expect(html).toContain('Chapter text')
  expect(html).not.toMatch(/<script|<iframe|onclick|javascript:/i)
  expect(html).toContain('href="https://example.test/x" target="_blank" rel="noopener noreferrer"')
  // The style container's stray <p> does not travel either.
  expect(html).not.toContain('<p></p>')
})

it('keeps a crafted inline style and the file CSS inside the frame document, never the app document', async () => {
  const frame = (await show())!
  const html = frame.getAttribute('srcdoc') ?? ''
  expect(html).toContain('evil.test/p')
  expect(html).toContain('evil.test/s')
  // In the app document they exist only as the frame's srcdoc text.
  const styled = [...document.querySelectorAll('[style]')].map((el) => el.getAttribute('style') ?? '')
  expect(styled.some((s) => s.includes('evil.test'))).toBe(false)
  const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '')
  expect(sheets.some((s) => s.includes('evil.test'))).toBe(false)
  expect(document.querySelector('rect')).toBeNull()
})

it('shows the note with Download when the file cannot be drawn', async () => {
  m.fail = true
  const frame = await show()
  expect(frame).toBeNull()
  expect(host.textContent).toContain('opened elsewhere')
  expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Download'))).toBe(true)
})
