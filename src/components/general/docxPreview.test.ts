// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { renderDocx } from './DocxPreview'

describe('renderDocx', () => {
  it('draws a page section with the text', async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun('Chapter One')] })] }],
    })
    const blob = await Packer.toBlob(doc)
    const pages = document.createElement('div')
    const styles = document.createElement('div')
    await renderDocx(blob, pages, styles)
    const section = pages.querySelector('section.docx')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('Chapter One')
  })
})
