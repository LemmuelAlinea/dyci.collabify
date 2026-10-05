/**
 * Word and Excel files, in and out.
 *
 * Every library here loads through `import()` at the moment somebody opens a
 * file that needs it. Together they are larger than the whole rest of the app,
 * and a student opening the task board should not pay for a spreadsheet reader.
 *
 * **Conversion is lossy and the interface has to say so.** A .docx arrives as
 * HTML: its words, headings, lists, tables, links, fonts, colours, alignment,
 * pictures and page size survive (`docx/read.ts`); headers, footers,
 * footnotes and tracked changes do not. A .xlsx arrives as cell text: values
 * and formula text survive; formatting, charts and macros do not. That trade
 * is what makes the file reviewable, which is why it is here at all.
 */
import { parseWorkbook, serializeWorkbook, trimTrailing } from './sheet'
import type { Workbook } from './sheet'

export const OFFICE_WARNING =
  'Word files keep their fonts, colours, alignment, lists, tables, pictures and page size; headers, footers, footnotes, comments and tracked changes do not come across. Excel files keep their numbers and formulas; charts and macros do not.'

/* ------------------------------------------------------------------- word */

export { htmlToDocx } from './docx/write'

/**
 * A .docx as HTML for the Word editor, plus anything that could not come across.
 *
 * Read with the site's own reader (`docx/read.ts`), which keeps fonts,
 * colours, alignment, spacing, lists, tables, pictures and the page size.
 * Pictures are uploaded into the project as they are found; without a
 * project to put them in they are left out. A file the reader cannot follow
 * falls back to mammoth, which keeps the words and the plain structure.
 */
export async function docxToHtml(file: File, projectId?: string): Promise<{ html: string; warnings: string[] }> {
  const buffer = await file.arrayBuffer()
  try {
    const { readDocxBytes } = await import('./docx/read')
    const read = readDocxBytes(new Uint8Array(buffer))
    let html = read.html
    const warnings: string[] = []
    if (read.pictures.length) {
      const { uploadDocImage } = await import('../api/general')
      const paths = new Map<string, string>()
      for (const pic of read.pictures) {
        if (!projectId) break
        try {
          const ext = pic.mime === 'image/png' ? 'png' : pic.mime === 'image/gif' ? 'gif' : pic.mime === 'image/bmp' ? 'bmp' : 'jpg'
          paths.set(pic.target, await uploadDocImage(projectId, new Blob([pic.data as Uint8Array<ArrayBuffer>], { type: pic.mime }), ext))
        } catch {
          warnings.push(`A picture (${pic.target.split('/').pop()}) could not be added.`)
        }
      }
      html = html.replace(/<img data-docx-image="([^"]*)"([^>]*)>/g, (_m, target: string, rest: string) => {
        const path = paths.get(target.replace(/&amp;/g, '&'))
        return path ? `<img data-path="${path}"${rest}>` : ''
      })
    }
    return { html, warnings }
  } catch {
    const mammoth = await import('mammoth')
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
    return {
      html: result.value || '<p></p>',
      warnings: (result.messages ?? []).map((m) => m.message),
    }
  }
}

/* ------------------------------------------------------------------ excel */

/** A spreadsheet as the cell text this site stores. */
export async function xlsxToWorkbook(file: File): Promise<Workbook> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return parseWorkbook(serializeWorkbook({ sheets: [{ name: sheetName(file.name), rows: parseCsv(await file.text()) }] }))
  }

  try {
    return await xlsxToWorkbookWithExcelJs(file)
  } catch {
    return xlsxToWorkbookWithReader(file)
  }
}

async function xlsxToWorkbookWithExcelJs(file: File): Promise<Workbook> {
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

async function xlsxToWorkbookWithReader(file: File): Promise<Workbook> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = (await readXlsxFile(file)).map((sheet, i) => ({
    name: sheet.sheet || `Sheet ${i + 1}`,
    rows: trimTrailing(sheet.data.map((row) => row.map(cellText))),
  }))
  return parseWorkbook(serializeWorkbook({ sheets: sheets.length ? sheets : [{ name: 'Sheet 1', rows: [] }] }))
}

function sheetName(name: string) {
  const base = name.replace(/\.[^.]+$/, '').trim()
  return (base || 'Sheet 1').slice(0, 31)
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }

  row.push(cell)
  rows.push(row)
  return trimTrailing(rows)
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
