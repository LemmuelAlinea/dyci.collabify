// @vitest-environment happy-dom
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { docxParagraphs } from './text'

async function make(paras: Paragraph[]) {
  const blob = await Packer.toBlob(new Document({ sections: [{ children: paras }] }))
  return new Uint8Array(await blob.arrayBuffer())
}

describe('docxParagraphs', () => {
  it('gives one line per paragraph', async () => {
    const bytes = await make([new Paragraph('First'), new Paragraph('Second')])
    expect(docxParagraphs(bytes)).toBe('First\nSecond')
  })
  it('keeps a tab', async () => {
    const bytes = await make([new Paragraph({ children: [new TextRun('A'), new TextRun({ text: 'B', children: ['\t', 'B'] })] })])
    expect(docxParagraphs(bytes)).toContain('\t')
  })
  it('decodes entities', async () => {
    const bytes = await make([new Paragraph('Tom & Jerry')])
    expect(docxParagraphs(bytes)).toBe('Tom & Jerry')
  })
  it('gives an empty string for a broken file', () => {
    expect(docxParagraphs(Uint8Array.from([1, 2, 3, 4, 5]))).toBe('')
  })

  const raw = (body: string) =>
    zipSync({ 'word/document.xml': strToU8(`<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) })

  it('keeps a self-closed paragraph as an empty line', () => {
    const bytes = raw('<w:p w:rsidR="1"/><w:p><w:r><w:t>B</w:t></w:r></w:p>')
    expect(docxParagraphs(bytes)).toBe('\nB')
  })
  it('drops tracked deletions and field codes', () => {
    const bytes = raw(
      '<w:p><w:r><w:t>Keep</w:t></w:r><w:del><w:r><w:delText xml:space="preserve"> gone</w:delText></w:r></w:del>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r></w:p>',
    )
    expect(docxParagraphs(bytes)).toBe('Keep')
  })
})
