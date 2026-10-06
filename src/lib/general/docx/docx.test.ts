// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { readDocxBytes } from './read'
import { htmlToDocx } from './write'
import { readPageSetting } from '../wordPage'

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
)

async function roundTrip(html: string) {
  const blob = await htmlToDocx(html, 'Test', { loadPicture: async () => new Blob([PNG], { type: 'image/png' }) })
  return readDocxBytes(new Uint8Array(await blob.arrayBuffer()))
}

describe('Word files out and back in', () => {
  it('keeps fonts, sizes, colours, highlight and emphasis', async () => {
    const { html } = await roundTrip(
      '<p><span style="font-family: Georgia, Tinos, serif; font-size: 14pt; color: #c00000">Red Georgia</span> ' +
        '<strong>bold</strong> <em>italic</em> <u>under</u> <s>gone</s> ' +
        '<mark data-color="#ffff00" style="background-color: #ffff00">marked</mark></p>',
    )
    expect(html).toContain('font-family: Georgia')
    expect(html).toContain('font-size: 14pt')
    expect(html).toContain('color: #c00000')
    expect(html).toMatch(/<strong>[^<]*bold/)
    expect(html).toMatch(/<em>[^<]*italic/)
    expect(html).toMatch(/<u>[^<]*under/)
    expect(html).toMatch(/<s>[^<]*gone/)
    expect(html).toContain('data-color="#ffff00"')
  })

  it('keeps alignment, justify, line spacing and indent', async () => {
    const { html } = await roundTrip(
      '<p style="text-align: center">Middle</p>' +
        '<p style="text-align: justify; line-height: 1.5">Both edges</p>' +
        '<p style="margin-left: 96px">Indented twice</p>',
    )
    expect(html).toMatch(/text-align: center[^>]*>Middle/)
    expect(html).toMatch(/text-align: justify; line-height: 1\.5[^>]*>Both edges/)
    expect(html).toMatch(/margin-left: 96px[^>]*>Indented twice/)
  })

  it('keeps headings, bullet and numbered lists', async () => {
    const { html } = await roundTrip(
      '<h1>Chapter</h1><h2>Part</h2>' +
        '<ul><li><p>Dot one</p></li><li><p>Dot two</p></li></ul>' +
        '<ol><li><p>First</p><ol><li><p>Inner</p></li></ol></li><li><p>Second</p></li></ol>',
    )
    expect(html).toContain('<h1>Chapter</h1>')
    expect(html).toContain('<h2>Part</h2>')
    expect(html).toMatch(/<ul><li><p>Dot one<\/p><\/li><li><p>Dot two<\/p><\/li><\/ul>/)
    expect(html).toMatch(/<ol><li><p>First<\/p><ol><li><p>Inner<\/p><\/li><\/ol><\/li><li><p>Second<\/p><\/li><\/ol>/)
  })

  it('keeps tables, merged cells, page breaks, pictures and the page size', async () => {
    const { html, page, pictures } = await roundTrip(
      '<div data-page="a4"></div>' +
        '<table><tbody><tr><th colspan="2" style="background-color: #1f3763"><p>Wide</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>' +
        '<p>Before</p><div data-page-break=""></div><p>After</p>' +
        '<img data-path="p/files/doc-images/x.png" width="120" height="60">',
    )
    expect(page).toBe('a4')
    expect(readPageSetting(html).page).toBe('a4')
    expect(html).toContain('colspan="2" style="background-color: #1f3763"><p>Wide</p>')
    expect(html).toMatch(/<td><p>A<\/p><\/td><td><p>B<\/p><\/td>/)
    expect(html).toMatch(/Before<\/p><div data-page-break=""><\/div><p>After/)
    expect(pictures).toHaveLength(1)
    expect(html).toMatch(/<img data-docx-image="word\/media\/[^"]+" width="120" height="60">/)
  })

  it('reads Letter when a file says nothing about its page', async () => {
    const { page } = await roundTrip('<p>Plain</p>')
    expect(page).toBe('letter')
  })
})
