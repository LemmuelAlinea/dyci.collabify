import { downloadCsv, reportFilename, toCsv } from '../report'
import type { Workbook, Sheet } from '../general/sheet'
import { cellExport, cellText, columnHeader, tableBlocks } from './doc'
import type { Block, ReportDoc } from './doc'

/** Neither end may be an apostrophe; Excel and ExcelJS refuse the sheet otherwise. */
const trimQuotes = (s: string) => s.replace(/^['\s]+|['\s]+$/g, '')

/**
 * Excel sheet names: at most 31 characters, none of []:*?/\, no apostrophe at
 * either end, unique ignoring case, and never "History", which Excel reserves.
 */
export function sheetName(title: string, used: Set<string>): string {
  const base = trimQuotes(trimQuotes(title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ')).slice(0, 31)) || 'Sheet'
  let name = base
  let n = 2
  while (used.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
    const suffix = ` (${n++})`
    name = base.slice(0, 31 - suffix.length).trimEnd() + suffix
    // The suffix ends in ")", so the cut never leaves an apostrophe at the end.
  }
  used.add(name.toLowerCase())
  return name
}

/** A grid cell. The writer turns numeric text into a number, and "=…" into a formula — so text never starts with "=". */
function gridText(v: string | number | null): string {
  if (v === null) return ''
  if (typeof v === 'number') return String(v)
  return v.startsWith('=') ? ` ${v}` : v
}

const kpiText = (v: number | string) => (typeof v === 'number' ? String(v) : gridText(v))

/** A CSV cell. Excel and Sheets read a leading = + - or @ as a formula, and peer comments are exported. */
function csvSafe(s: string): string {
  return /^[=+\-@]/.test(s) ? ` ${s}` : s
}

export function docToWorkbook(doc: ReportDoc): Workbook {
  const used = new Set<string>()
  const h = doc.header
  const cover: string[][] = [
    [gridText(h.title)],
    [gridText(h.subtitle)],
    [gridText(h.classLine)],
    ...(h.rangeLabel ? [[gridText(h.rangeLabel)]] : []),
    [gridText(`Made ${h.madeAt}`)],
    ...(h.confidential ? [[gridText(h.confidential)]] : []),
    [''],
  ]
  for (const b of doc.blocks) {
    if (b.kind === 'kpis') for (const k of b.items) cover.push([gridText(k.label), kpiText(k.value), gridText(k.unit ?? '')])
  }
  if (doc.footer.lines.length) cover.push([''], ...doc.footer.lines.map((l) => [gridText(l)]))

  const sheets: Sheet[] = [{ name: sheetName('Report', used), rows: cover }]
  for (const t of tableBlocks(doc)) {
    sheets.push({
      name: sheetName(t.title, used),
      rows: [
        t.columns.map((c) => gridText(columnHeader(c))),
        ...t.rows.map((row) => t.columns.map((col, i) => gridText(cellExport(row[i] ?? null, col)))),
      ],
      freeze: { rows: 1, cols: 0 },
    })
  }
  return { sheets }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'kpis':
      return `<table><tbody>${b.items
        .map((k) => `<tr><td>${esc(k.label)}</td><td>${esc(String(k.value))}${k.unit ? ` ${esc(k.unit)}` : ''}</td></tr>`)
        .join('')}</tbody></table>`
    case 'heading':
      return `<h${b.level}>${esc(b.text)}</h${b.level}>`
    case 'paragraph':
      return `<p>${esc(b.text)}</p>`
    case 'note':
      return `<p><em>${esc(b.text)}</em></p>`
    case 'chart':
      return `<h3>${esc(b.title)}</h3><p>${esc(b.summary)}</p>`
    case 'table': {
      const head = b.columns.map((c) => `<th>${esc(columnHeader(c))}</th>`).join('')
      const body = b.rows
        .map(
          (row) =>
            `<tr>${b.columns
              .map((c, i) => {
                const cell = row[i] ?? null
                const tag = cell !== null && typeof cell === 'object' && cell.tag ? ` (${cell.tag})` : ''
                return `<td>${esc(cellText(cell, c) + tag)}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')
      return `<h3>${esc(b.title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${
        b.note ? `<p>${esc(b.note)}</p>` : ''
      }`
    }
  }
}

/** Word-ready HTML. Charts become their summary sentence; every row is included. */
export function docToHtml(doc: ReportDoc): string {
  const h = doc.header
  const head = [
    `<h1>${esc(h.title)}</h1>`,
    `<p>${esc(h.subtitle)}</p>`,
    `<p>${esc(h.classLine)}${h.rangeLabel ? ` · ${esc(h.rangeLabel)}` : ''}</p>`,
    `<p>Made ${esc(h.madeAt)}</p>`,
    h.confidential ? `<p><strong>${esc(h.confidential)}</strong></p>` : '',
  ].join('')
  const foot = [
    ...doc.footer.lines.map((l) => `<p>${esc(l)}</p>`),
    ...doc.footer.signatures.map((s) => `<p>${esc(s.role)}: ${s.name ? esc(s.name) : '____________________'}</p>`),
  ].join('')
  return head + doc.blocks.map(blockHtml).join('') + foot
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table'

/** One CSV per table. Duplicate table titles get -2, -3. */
export function docCsvFiles(doc: ReportDoc, base: string) {
  const seen = new Map<string, number>()
  return tableBlocks(doc).map((t) => {
    const s = slug(t.title)
    const n = (seen.get(s) ?? 0) + 1
    seen.set(s, n)
    return {
      name: `${base}-${n === 1 ? s : `${s}-${n}`}.csv`,
      label: t.title,
      csv: toCsv(
        t.columns.map((c) => csvSafe(columnHeader(c))),
        t.rows.map((row) =>
          t.columns.map((col, i) => {
            const v = cellExport(row[i] ?? null, col)
            return typeof v === 'string' ? csvSafe(v) : v
          }),
        ),
      ),
    }
  })
}

export function reportBase(kind: string, subject: string) {
  return reportFilename(kind, subject).replace(/\.csv$/, '')
}

export async function exportXlsx(doc: ReportDoc, base: string) {
  const { workbookToXlsx, downloadBlob } = await import('../general/office')
  downloadBlob(await workbookToXlsx(docToWorkbook(doc)), `${base}.xlsx`)
}

export async function exportDocx(doc: ReportDoc, base: string) {
  const { htmlToDocx, downloadBlob } = await import('../general/office')
  downloadBlob(await htmlToDocx(docToHtml(doc), doc.header.title), `${base}.docx`)
}

export function exportCsv(file: { name: string; csv: string }) {
  downloadCsv(file.name, file.csv)
}
