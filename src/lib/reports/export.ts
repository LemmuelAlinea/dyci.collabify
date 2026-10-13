import { downloadCsv, reportFilename, toCsv } from '../report'
import type { Workbook, Sheet } from '../general/sheet'
import { cellExport, cellText, columnHeader, deltaText, tableBlocks } from './doc'
import type { Block, ReportDoc } from './doc'
import { formatPoints } from '../scoreMath'

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

/**
 * A CSV cell. Excel and Sheets read a leading = + - or @ as a formula, and peer
 * comments are exported. A leading tab or carriage return is stripped on import
 * and can expose one, so it is guarded too.
 */
function csvSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? ` ${s}` : s
}

/**
 * A change on the Excel cover, in words. The writer turns numeric text into a
 * number, and "+5" would land as 5, losing its sign; words stay text.
 */
function deltaWords(d: number): string {
  if (d === 0) return 'no change'
  return `${d > 0 ? 'up' : 'down'} ${formatPoints(Math.abs(d))}`
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
    if (b.kind !== 'kpis') continue
    for (const k of b.items) {
      const delta = k.delta === null || k.delta === undefined ? '' : deltaWords(k.delta)
      cover.push([gridText(k.label), kpiText(k.value), gridText(k.unit ?? ''), gridText(delta)])
    }
    if (b.compareLabel) cover.push([gridText(`Changes are against ${b.compareLabel}`)])
  }
  const extras: string[][] = []
  for (const b of doc.blocks) {
    if (b.kind === 'note' || b.kind === 'paragraph') extras.push([gridText(b.text)])
    else if (b.kind === 'chart') extras.push([gridText(`${b.title}: ${b.summary}`)])
    else if (b.kind === 'table' && b.note) extras.push([gridText(`${b.title}: ${b.note}`)])
  }
  if (extras.length) cover.push([''], ...extras)
  if (doc.footer.lines.length) cover.push([''], ...doc.footer.lines.map((l) => [gridText(l)]))

  const sheets: Sheet[] = [{ name: sheetName('Report', used), rows: cover }]
  for (const t of tableBlocks(doc)) {
    const rows = [
      t.columns.map((c) => gridText(columnHeader(c))),
      ...t.rows.map((row) => t.columns.map((col, i) => gridText(cellExport(row[i] ?? null, col)))),
    ]
    const cols: Record<string, number> = {}
    t.columns.forEach((_, i) => {
      const longest = Math.max(...rows.map((r) => r[i].length))
      cols[String(i)] = Math.min(420, Math.max(64, longest * 7 + 16))
    })
    sheets.push({ name: sheetName(t.title, used), rows, cols, freeze: { rows: 1, cols: 0 } })
  }
  return { sheets }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'kpis': {
      const rows = b.items
        .map((k) => {
          const delta = k.delta !== null && k.delta !== undefined ? ` (${deltaText(k.delta)})` : ''
          return `<tr><td>${esc(k.label)}</td><td>${esc(String(k.value))}${k.unit ? ` ${esc(k.unit)}` : ''}${delta}</td></tr>`
        })
        .join('')
      return `<table><tbody>${rows}</tbody></table>${b.compareLabel ? `<p>Changes are against ${esc(b.compareLabel)}</p>` : ''}`
    }
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

/**
 * A file name without its extension. The class line ("QM · Quantitative
 * methods · BSIT 3A") adds its first and last parts, so two sections' reports
 * for the same dates or project never share a name.
 */
export function reportBase(kind: string, subject: string, classLine = '') {
  const parts = classLine.split('·').map((s) => s.trim()).filter(Boolean)
  const cls = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : (parts[0] ?? '')
  return reportFilename(cls ? `${kind} ${cls}` : kind, subject).replace(/\.csv$/, '')
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
