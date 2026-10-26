import {
  BULK_MAX_ROWS,
  normalizeBulkUser,
} from '../../supabase/functions/_shared/bulkAccounts'
import type { BulkUser } from '../../supabase/functions/_shared/bulkAccounts'

export type BulkPreviewRow = {
  row: number
  email: string
  user?: BulkUser
  error?: string
}

export const BULK_HEADERS = ['first_name', 'middle_name', 'last_name', 'email', 'role'] as const

/** CSV with quoted commas, quotes and line breaks; rejects broken quoting. */
export function parseBulkCsv(source: string): BulkPreviewRow[] {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const records: { row: number; cells: string[] }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let closed = false
  let line = 1
  let row = 1

  function finish() {
    cells.push(cell)
    if (cells.some((part) => part.trim())) records.push({ row, cells })
    cells = []
    cell = ''
    closed = false
    row = line + 1
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
        closed = true
      } else {
        cell += ch
        if (ch === '\n') line++
      }
    } else if (ch === '"') {
      if (cell || closed) throw new Error(`Malformed CSV near line ${line}.`)
      quoted = true
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
      closed = false
    } else if (ch === '\n') {
      finish()
      line++
    } else if (closed && ch !== ' ' && ch !== '\t') {
      throw new Error(`Malformed CSV near line ${line}.`)
    } else if (!closed) {
      cell += ch
    }
  }
  if (quoted) throw new Error(`Unclosed quote near line ${row}.`)
  if (cell || cells.length) finish()
  if (!records.length) throw new Error('The CSV is empty.')

  const headers = records[0].cells.map((part) => part.trim().toLowerCase())
  if (new Set(headers).size !== headers.length) throw new Error('The CSV has duplicate columns.')
  const unexpected = headers.find((header) => !(BULK_HEADERS as readonly string[]).includes(header))
  if (unexpected) throw new Error(`Unexpected ${unexpected} column.`)
  for (const required of ['first_name', 'last_name', 'email', 'role']) {
    if (!headers.includes(required)) throw new Error(`Missing ${required} column.`)
  }
  if (records.length - 1 > BULK_MAX_ROWS) throw new Error('Use at most 100 users per CSV.')

  const seen = new Set<string>()
  return records.slice(1).map(({ row: rowNumber, cells: values }) => {
    if (values.length !== headers.length) {
      return { row: rowNumber, email: '', error: 'Column count does not match the header.' }
    }
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index]]))
    const normalized = normalizeBulkUser(raw)
    const email = String(raw.email ?? '').trim().toLowerCase()
    if (!normalized.user) return { row: rowNumber, email, error: normalized.error }
    if (seen.has(normalized.user.email)) {
      return { row: rowNumber, email, error: 'Duplicate email in this CSV.' }
    }
    seen.add(normalized.user.email)
    return { row: rowNumber, email, user: normalized.user }
  })
}
