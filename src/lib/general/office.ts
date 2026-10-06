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
 * footnotes and tracked changes do not. A .xlsx arrives as cell text — values
 * and formula text — with its fonts, fills, alignment, number formats, borders,
 * widths, merges and frozen panes; charts, images and macros do not. That trade
 * is what makes the file reviewable, which is why it is here at all.
 */
import { parseWorkbook, serializeWorkbook, trimTrailing } from './sheet'
import type { Sheet, Workbook } from './sheet'
import type { BorderLine, CellBorder, CellStyle, Merge } from './sheetFormat'

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

  const sheets = book.worksheets.map((ws, i): Sheet => {
    const rows: string[][] = []
    const styles: Record<string, CellStyle> = {}
    const borders: CellBorder[] = []
    const heights: Record<string, number> = {}
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = cellText(cell.value)
        const st = styleFromExcel(cell)
        if (Object.keys(st).length) styles[`${rowNumber - 1}:${colNumber - 1}`] = st
        const border = borderFromExcel(cell.border, rowNumber - 1, colNumber - 1)
        if (border) borders.push(border)
      })
      rows[rowNumber - 1] = [...cells].map((c) => c ?? '')
      if (row.height) heights[String(rowNumber - 1)] = Math.round((row.height * 4) / 3)
    })
    const cols: Record<string, number> = {}
    ws.columns?.forEach((col, c) => {
      if (col?.width) cols[String(c)] = Math.round(col.width * 7 + 5)
    })
    const merges = ((ws.model as { merges?: string[] }).merges ?? []).map(mergeFromRef).filter((m): m is Merge => m !== null)
    // ExcelJS repeats a merged range's first cell over the rest; to Excel those cells are empty.
    for (const m of merges) {
      for (let r = m.r; r < m.r + m.rs; r++) {
        for (let c = m.c; c < m.c + m.cs; c++) {
          if (r === m.r && c === m.c) continue
          if (rows[r]?.[c] !== undefined) rows[r][c] = ''
          delete styles[`${r}:${c}`]
        }
      }
    }
    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined
    return {
      name: ws.name || `Sheet ${i + 1}`,
      rows: trimTrailing(rows.map((r) => (r ?? []).map((c) => c ?? ''))),
      styles,
      cols,
      heights,
      merges,
      freeze: view?.state === 'frozen' ? { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 } : undefined,
      borders,
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

type ExcelCell = import('exceljs').Cell
type ExcelBorders = Partial<import('exceljs').Borders>

/** "FFC00000" (or "C00000") as "#c00000"; theme and indexed colours have no argb and are skipped. */
const fromArgb = (argb: string | undefined) =>
  argb && /^([0-9a-f]{2})?[0-9a-f]{6}$/i.test(argb) ? `#${argb.slice(-6).toLowerCase()}` : undefined

const toArgb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`

function styleFromExcel(cell: ExcelCell): CellStyle {
  const st: CellStyle = {}
  const font = cell.font ?? {}
  if (font.bold) st.bold = true
  if (font.italic) st.italic = true
  if (font.underline) st.underline = true
  if (font.strike) st.strike = true
  if (font.name && font.name !== 'Calibri') st.font = font.name
  if (font.size && font.size !== 11) st.size = font.size
  const color = fromArgb(font.color?.argb)
  if (color && color !== '#000000') st.color = color
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined
  const bg = fill?.type === 'pattern' && fill.pattern === 'solid' ? fromArgb(fill.fgColor?.argb) : undefined
  if (bg) st.fill = bg
  const a = cell.alignment ?? {}
  if (a.horizontal === 'left' || a.horizontal === 'center' || a.horizontal === 'right') st.align = a.horizontal
  if (a.vertical === 'top' || a.vertical === 'bottom' || a.vertical === 'middle') st.valign = a.vertical
  if (a.wrapText) st.wrap = true
  if (cell.numFmt && cell.numFmt !== 'General') st.format = cell.numFmt
  return st
}

function styleToExcel(cell: ExcelCell, st: CellStyle) {
  if (st.bold || st.italic || st.underline || st.strike || st.font || st.size || st.color) {
    cell.font = {
      bold: st.bold,
      italic: st.italic,
      underline: st.underline,
      strike: st.strike,
      name: st.font,
      size: st.size,
      color: st.color ? { argb: toArgb(st.color) } : undefined,
    }
  }
  if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(st.fill) } }
  if (st.align || st.valign || st.wrap) {
    cell.alignment = { horizontal: st.align, vertical: st.valign, wrapText: st.wrap }
  }
  if (st.format) cell.numFmt = st.format
}

const EXCEL_LINES: Record<string, BorderLine['style']> = {
  thin: 'thin',
  hair: 'thin',
  medium: 'medium',
  thick: 'thick',
  dotted: 'dotted',
  double: 'double',
  dashed: 'dashed',
  mediumDashed: 'dashed',
  dashDot: 'dashed',
  mediumDashDot: 'dashed',
  dashDotDot: 'dashed',
  mediumDashDotDot: 'dashed',
  slantDashDot: 'dashed',
}

function borderFromExcel(border: ExcelBorders | undefined, r: number, c: number): CellBorder | null {
  if (!border) return null
  const out: CellBorder = { r, c }
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const line = border[side]
    const style = line?.style ? EXCEL_LINES[line.style] : undefined
    if (style) out[side] = { style, color: fromArgb(line?.color?.argb) ?? '#000000' }
  }
  return out.top || out.bottom || out.left || out.right ? out : null
}

/** "B2:D3" as a merged range. */
function mergeFromRef(ref: string): Merge | null {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i)
  if (!m) return null
  const col = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const r1 = Number(m[2]) - 1
  const c1 = col(m[1])
  const merge = { r: r1, c: c1, rs: Number(m[4]) - r1, cs: col(m[3]) - c1 + 1 }
  return merge.rs >= 1 && merge.cs >= 1 && merge.rs * merge.cs > 1 ? merge : null
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
    const f = sheet.freeze
    const ws = book.addWorksheet(sheet.name.slice(0, 31) || 'Sheet 1', {
      views: f ? [{ state: 'frozen', xSplit: f.cols, ySplit: f.rows }] : undefined,
    })
    trimTrailing(sheet.rows).forEach((row, r) => {
      row.forEach((text, c) => {
        if (text === '') return
        const cell = ws.getCell(r + 1, c + 1)
        if (text.startsWith('=')) cell.value = { formula: text.slice(1) }
        else if (text !== '' && !Number.isNaN(Number(text))) cell.value = Number(text)
        else cell.value = text
      })
    })
    for (const [key, st] of Object.entries(sheet.styles ?? {})) {
      const [r, c] = key.split(':').map(Number)
      styleToExcel(ws.getCell(r + 1, c + 1), st)
    }
    const side = (line?: BorderLine) => (line ? { style: line.style, color: { argb: toArgb(line.color) } } : undefined)
    for (const b of sheet.borders ?? []) {
      ws.getCell(b.r + 1, b.c + 1).border = { top: side(b.top), bottom: side(b.bottom), left: side(b.left), right: side(b.right) }
    }
    for (const [c, px] of Object.entries(sheet.cols ?? {})) ws.getColumn(Number(c) + 1).width = Math.max(1, (px - 5) / 7)
    for (const [r, px] of Object.entries(sheet.heights ?? {})) ws.getRow(Number(r) + 1).height = px * 0.75
    for (const m of sheet.merges ?? []) ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs)
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
