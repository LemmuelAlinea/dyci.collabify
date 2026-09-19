/**
 * Word and Excel files, in and out.
 *
 * Every library here loads through `import()` at the moment somebody opens a
 * file that needs it. Together they are larger than the whole rest of the app,
 * and a student opening the task board should not pay for a spreadsheet reader.
 *
 * **Conversion is lossy and the interface has to say so.** A .docx arrives as
 * HTML: its words, headings, lists, tables and links survive; its page layout,
 * fonts, footnotes, tracked changes and images do not. A .xlsx arrives as cell
 * text: values and formula text survive; formatting, charts and macros do not.
 * That trade is what makes the file reviewable, which is why it is here at all.
 */
import { parseWorkbook, serializeWorkbook, trimTrailing } from './sheet'
import type { Workbook } from './sheet'

export const OFFICE_WARNING =
  'The words, headings, tables and numbers come across. Page layout, fonts, images, charts and macros do not — the file becomes one this site can show, compare and review.'

/* ------------------------------------------------------------------- word */

/** A .docx as HTML, plus anything the converter could not carry over. */
export async function docxToHtml(file: File): Promise<{ html: string; warnings: string[] }> {
  const mammoth = await import('mammoth')
  const buffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return {
    html: result.value || '<p></p>',
    warnings: (result.messages ?? []).map((m) => m.message),
  }
}

type DocxRun = { text: string; bold?: boolean; italics?: boolean; underline?: Record<string, never> }

/**
 * HTML back to a .docx.
 *
 * Walks the nodes rather than matching text, so nested markup keeps its
 * formatting and an unexpected tag degrades to its words instead of appearing
 * as angle brackets in somebody's thesis.
 */
export async function htmlToDocx(html: string, title: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } =
    await import('docx')

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

  const runsOf = (node: Node, style: DocxRun = { text: '' }): DocxRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      return text ? [{ ...style, text }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as HTMLElement
    const next: DocxRun = { ...style }
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italics = true
    if (tag === 'u') next.underline = {}
    if (tag === 'br') return [{ ...style, text: '\n' }]
    return [...el.childNodes].flatMap((child) => runsOf(child, next))
  }

  const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
    h5: HeadingLevel.HEADING_5,
    h6: HeadingLevel.HEADING_6,
  }

  const blocks: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []

  const paragraph = (
    node: Node,
    options: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; bullet?: number; numbered?: boolean } = {},
  ) => {
    const runs = runsOf(node).map((r) => new TextRun(r))
    return new Paragraph({
      children: runs.length ? runs : [new TextRun('')],
      heading: options.heading,
      bullet: options.bullet !== undefined ? { level: options.bullet } : undefined,
    })
  }

  const walk = (node: Node, depth = 0) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (HEADINGS[tag]) return blocks.push(paragraph(el, { heading: HEADINGS[tag] }))
    if (tag === 'p') return blocks.push(paragraph(el))
    if (tag === 'li') return blocks.push(paragraph(el, { bullet: Math.min(depth, 4) }))
    if (tag === 'ul' || tag === 'ol') {
      return [...el.children].forEach((child) => walk(child, depth + 1))
    }
    if (tag === 'table') {
      const rows = [...el.querySelectorAll('tr')].map(
        (tr) =>
          new TableRow({
            children: [...tr.children].map(
              (cell) => new TableCell({ children: [paragraph(cell)] }),
            ),
          }),
      )
      if (rows.length) blocks.push(new Table({ rows }))
      return
    }
    // Anything unrecognised: keep its words, drop its shape.
    if (el.children.length) return [...el.childNodes].forEach((child) => walk(child, depth))
    if ((el.textContent ?? '').trim()) blocks.push(paragraph(el))
  }

  ;[...doc.body.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) {
      blocks.push(new Paragraph({ children: [new TextRun(node.textContent as string)] }))
    } else {
      walk(node)
    }
  })

  if (blocks.length === 0) blocks.push(new Paragraph({ children: [new TextRun('')] }))

  const out = new Document({ title, sections: [{ children: blocks }] })
  return Packer.toBlob(out)
}

/* ------------------------------------------------------------------ excel */

/** A .xlsx as the cell text this site stores. */
export async function xlsxToWorkbook(file: File): Promise<Workbook> {
  const ExcelJS = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer())

  const sheets = book.worksheets.map((ws, i) => {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = cellText(cell.value)
      })
      rows[rowNumber - 1] = [...cells].map((c) => c ?? '')
    })
    return {
      name: ws.name || `Sheet ${i + 1}`,
      rows: trimTrailing(rows.map((r) => (r ?? []).map((c) => c ?? ''))),
    }
  })

  return parseWorkbook(serializeWorkbook({ sheets: sheets.length ? sheets : [{ name: 'Sheet 1', rows: [] }] }))
}

/**
 * One cell as the text somebody typed.
 *
 * A formula keeps its formula, not the cached answer — that is what a reviewer
 * needs to see, and it is what goes back out again unchanged.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.formula === 'string') return `=${v.formula}`
    if (typeof v.text === 'string') return v.text
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((part) => part.text ?? '').join('')
    }
    if ('result' in v) return String(v.result ?? '')
    if (typeof v.hyperlink === 'string') return v.hyperlink
    return ''
  }
  return String(value)
}

export async function workbookToXlsx(workbook: Workbook): Promise<Blob> {
  const ExcelJS = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.created = new Date()

  for (const sheet of workbook.sheets) {
    const ws = book.addWorksheet(sheet.name.slice(0, 31) || 'Sheet 1')
    trimTrailing(sheet.rows).forEach((row, r) => {
      row.forEach((text, c) => {
        if (text === '') return
        const cell = ws.getCell(r + 1, c + 1)
        if (text.startsWith('=')) cell.value = { formula: text.slice(1) }
        else if (text !== '' && !Number.isNaN(Number(text))) cell.value = Number(text)
        else cell.value = text
      })
    })
  }

  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/* ---------------------------------------------------------------- reading */

export async function readAsText(file: File) {
  return file.text()
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
