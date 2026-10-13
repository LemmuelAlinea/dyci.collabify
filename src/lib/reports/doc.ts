import type { Tone, WeekRow } from '../analyticsMath'
import { manilaDay } from '../analyticsMath'
import { formatPoints } from '../scoreMath'

/**
 * One report as data. A builder turns loaded rows into this; the screen, the
 * printer, Excel, Word and CSV all read the same object, so a report is written
 * once and never drifts between its outputs.
 */

export type ColumnType = 'text' | 'number' | 'percent' | 'date' | 'datetime' | 'score' | 'status'

export type Column = {
  key: string
  label: string
  type: ColumnType
  /** For a score column: what it is out of. */
  outOf?: number
  /** For a number column: fixed places on screen, print and Word. Exports keep full precision. */
  decimals?: number
}

export type RichCell = { value: string | number | null; tag?: string; tone?: Tone }
export type Cell = string | number | null | RichCell

export type Kpi = { label: string; value: number | string; unit?: string; delta?: number | null }

export type BarsChart = { kind: 'bars'; rows: { label: string; value: number }[]; max: number; unit?: string }
export type WeekBarsChart = { kind: 'weekBars'; rows: WeekRow[] }
export type ChartSpec = BarsChart | WeekBarsChart

export type TableBlock = {
  kind: 'table'
  id: string
  title: string
  columns: Column[]
  rows: Cell[][]
  note?: string
  /** Rows drawn on screen and in print. Exports always carry every row. */
  cap?: number
}

export type Block =
  | { kind: 'kpis'; items: Kpi[]; compareLabel?: string }
  | { kind: 'heading'; text: string; level: 2 | 3 }
  | { kind: 'paragraph'; text: string }
  | TableBlock
  | { kind: 'chart'; id: string; title: string; chart: ChartSpec; summary: string }
  | { kind: 'note'; tone: 'info' | 'warning'; text: string }

export type ReportDoc = {
  header: {
    title: string
    subtitle: string
    classLine: string
    rangeLabel: string | null
    madeAt: string
    confidential?: string
  }
  blocks: Block[]
  footer: { lines: string[]; signatures: { role: string; name?: string }[] }
}

export function cellValue(c: Cell): string | number | null {
  return c !== null && typeof c === 'object' ? c.value : c
}

const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })
const MOMENT = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A bare day is a Manila day; anything else is a moment. */
const asDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+08:00`) : new Date(v))
const toNumber = (v: string | number) => (typeof v === 'number' ? v : Number(v))
const invalid = (d: Date) => Number.isNaN(d.getTime())

export function cellText(c: Cell, col: Column): string {
  const v = cellValue(c)
  if (v === null || v === '') return '—'
  switch (col.type) {
    case 'number':
      if (!Number.isFinite(toNumber(v))) return String(v)
      return col.decimals !== undefined ? toNumber(v).toFixed(col.decimals) : formatPoints(toNumber(v))
    case 'percent':
      return Number.isFinite(toNumber(v)) ? `${toNumber(v).toFixed(1)}%` : String(v)
    case 'score': {
      if (!Number.isFinite(toNumber(v))) return String(v)
      const s = formatPoints(toNumber(v))
      return col.outOf ? `${s} / ${col.outOf}` : s
    }
    case 'date':
    case 'datetime': {
      const d = asDate(String(v))
      if (invalid(d)) return String(v)
      return (col.type === 'date' ? DAY : MOMENT).format(d)
    }
    default:
      return String(v)
  }
}

/** What a spreadsheet or CSV gets: numbers as numbers, days as YYYY-MM-DD. */
export function cellExport(c: Cell, col: Column): string | number | null {
  const v = cellValue(c)
  if (v === null || v === '') return null
  switch (col.type) {
    case 'number':
    case 'score':
      return Number.isFinite(toNumber(v)) ? toNumber(v) : String(v)
    case 'percent':
      return Number.isFinite(toNumber(v)) ? Math.round(toNumber(v) * 10) / 10 : String(v)
    case 'date':
    case 'datetime': {
      const d = asDate(String(v))
      if (invalid(d)) return String(v)
      return col.type === 'date' ? manilaDay(d) : `${manilaDay(d)} ${CLOCK.format(d)}`
    }
    default:
      return String(v)
  }
}

export function columnHeader(col: Column): string {
  if (col.type === 'score' && col.outOf) return `${col.label} (of ${col.outOf})`
  if (col.type === 'percent') return `${col.label} (%)`
  return col.label
}

/** A change against the previous period: signed, never a ratio. */
export function deltaText(d: number): string {
  if (d === 0) return '±0'
  const v = formatPoints(Math.abs(d))
  return d > 0 ? `+${v}` : `−${v}`
}

export function tableBlocks(doc: ReportDoc): TableBlock[] {
  return doc.blocks.filter((b): b is TableBlock => b.kind === 'table')
}
