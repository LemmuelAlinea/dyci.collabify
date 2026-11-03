import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Document, ImageRun, Packer, Paragraph } from 'docx'
import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'
import { readMemberImportFile, type RosterRow } from './memberImportFile'

// Use the real readers through their Node entry points in this Node-only suite.
vi.mock('mammoth', async () => {
  const real = await vi.importActual<typeof import('mammoth')>('mammoth')
  return { extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) => real.extractRawText({ buffer: Buffer.from(arrayBuffer) }) }
})
vi.mock('pdfjs-dist', async () => {
  const real = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return { ...real, GlobalWorkerOptions: { workerSrc: 'unused-in-node' }, getDocument: (input: { data: Uint8Array }) => real.getDocument({ ...input, useSystemFonts: true }) }
})

async function word(text: string[]) {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: text.map(t => new Paragraph(t)) }] }))
  return new File([new Uint8Array(bytes)], 'roster.docx')
}
function pdf(text?: string) {
  const doc = new jsPDF()
  if (text) doc.text(text, 10, 10)
  else doc.addImage({ imageData: { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }, format: 'RGBA', x: 10, y: 10, width: 20, height: 20 })
  return new File([doc.output('arraybuffer')], 'roster.pdf')
}
describe('readMemberImportFile', () => {
  it('distinguishes team, explicitly project-wide and unknown position scopes', () => {
    expectTypeOf<RosterRow['positions'][number]>().toEqualTypeOf<{ team: string; name: string; scope: 'team' | 'project' | 'unknown' }>()
  })
  it('labels Word paragraphs', async () => {
    expect(await readMemberImportFile(await word(['Ana Cruz — Design', 'Ben Lim — QA']))).toEqual({ fileName: 'roster.docx', text: '[Paragraph 1]\nAna Cruz — Design\n\n[Paragraph 2]\nBen Lim — QA' })
  })
  it('refuses a Word roster with text and an embedded PNG with PDF export guidance', async () => {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEA43qFxAAAAABJRU5ErkJggg==', 'base64')
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('Member roster'),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: image, transformation: { width: 100, height: 100 } })] }),
    ] }] }))
    await expect(readMemberImportFile(new File([new Uint8Array(bytes)], 'roster.docx'))).rejects.toThrow(/images.*Export.*PDF/)
  })
  it('refuses an Excel roster with text and an embedded PNG with PDF export guidance', async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Roster')
    sheet.getCell('A1').value = 'Member roster'
    const image = book.addImage({ base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEA43qFxAAAAABJRU5ErkJggg==', extension: 'png' })
    sheet.addImage(image, 'A2:C5')
    await expect(readMemberImportFile(new File([await book.xlsx.writeBuffer()], 'roster.xlsx'))).rejects.toThrow(/images.*Export.*PDF/)
  })
  it('labels every Excel sheet and source row', async () => {
    const book = new ExcelJS.Workbook()
    book.addWorksheet('Design').getCell('A2').value = 'Ana Cruz'
    book.addWorksheet('QA').getCell('A1').value = 'Ben Lim'
    const result = await readMemberImportFile(new File([await book.xlsx.writeBuffer()], 'roster.xlsx'))
    expect(result).toEqual({ fileName: 'roster.xlsx', text: '[Sheet: Design, row 2]\nAna Cruz\n\n[Sheet: QA, row 1]\nBen Lim' })
  })
  it('labels PDF pages', async () => {
    const result = await readMemberImportFile(pdf('Ana Cruz'))
    expect(result).toEqual({ fileName: 'roster.pdf', text: '[Page 1]\nAna Cruz' })
  })
  it('returns PDF bytes only when no text exists', async () => {
    const file = pdf()
    expect(await readMemberImportFile(file)).toEqual({ fileName: 'roster.pdf', pdfBase64: Buffer.from(await file.arrayBuffer()).toString('base64') })
  })
  it.each(['doc', 'xls', 'txt'])('refuses .%s', async ext => {
    await expect(readMemberImportFile(new File(['roster'], `roster.${ext}`))).rejects.toThrow(/docx.*xlsx.*PDF/i)
  })
  it('refuses files over 5 MB', async () => {
    await expect(readMemberImportFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'roster.pdf'))).rejects.toThrow(/5 MB/)
  })
  it('refuses text over 60000 characters without cutting', async () => {
    await expect(readMemberImportFile(await word(['a'.repeat(60001)]))).rejects.toThrow(/60,000/)
  })
  it('refuses spreadsheets the existing reader would cut', async () => {
    const book = new ExcelJS.Workbook()
    book.addWorksheet('Roster').getCell('A2001').value = 'Ana Cruz'
    await expect(readMemberImportFile(new File([await book.xlsx.writeBuffer()], 'roster.xlsx'))).rejects.toThrow(/too many/i)
  })
  it('sends the whole mixed text and image PDF rather than dropping a page', async () => {
    const doc = new jsPDF()
    doc.text('Ana Cruz', 10, 10)
    doc.addPage()
    doc.addImage({ imageData: { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }, format: 'RGBA', x: 10, y: 10, width: 20, height: 20 })
    const file = new File([doc.output('arraybuffer')], 'roster.pdf')
    expect(await readMemberImportFile(file)).toEqual({ fileName: file.name, pdfBase64: Buffer.from(await file.arrayBuffer()).toString('base64') })
  })
  it('sends a PDF with text and a roster image on the same page', async () => {
    const doc = new jsPDF()
    doc.text('Member roster — page 1', 10, 10)
    doc.addImage({ imageData: { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }, format: 'RGBA', x: 10, y: 20, width: 20, height: 20 })
    const file = new File([doc.output('arraybuffer')], 'roster.pdf')
    expect(await readMemberImportFile(file)).toEqual({ fileName: file.name, pdfBase64: Buffer.from(await file.arrayBuffer()).toString('base64') })
  })
  it('refuses overlong extracted PDF text before scanned-page fallback', async () => {
    const doc = new jsPDF()
    doc.setFontSize(1)
    for (let i = 0; i < 61; i++) doc.text('a'.repeat(1000), 1, 1 + i * 2)
    doc.addPage()
    doc.addImage({ imageData: { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }, format: 'RGBA', x: 10, y: 20, width: 20, height: 20 })
    await expect(readMemberImportFile(new File([doc.output('arraybuffer')], 'roster.pdf'))).rejects.toThrow(/60,000/)
  })
  it('refuses damaged input', async () => {
    await expect(readMemberImportFile(new File(['broken'], 'roster.docx'))).rejects.toThrow(/could not be opened/i)
  })
})
