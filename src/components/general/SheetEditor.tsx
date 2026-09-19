import { useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { columnName, SHEET_LIMIT } from '../../lib/general/sheet'
import type { Workbook } from '../../lib/general/sheet'

/**
 * A spreadsheet, as a grid of text.
 *
 * Nothing is evaluated: a cell holding `=B2*12` keeps those characters, and
 * Excel works the sum out when the file is opened there. Pretending to be a
 * calculator would mean two answers to every formula and no way to tell which
 * one the school's copy will show.
 */
export function SheetEditor({
  workbook,
  onChange,
  readOnly = false,
}: {
  workbook: Workbook
  onChange: (next: Workbook) => void
  readOnly?: boolean
}) {
  const [active, setActive] = useState(0)
  const sheet = workbook.sheets[Math.min(active, workbook.sheets.length - 1)]
  if (!sheet) return null

  const columns = Math.max(3, ...sheet.rows.map((r) => r.length))

  function write(row: number, column: number, text: string) {
    const sheets = workbook.sheets.map((s, i) => {
      if (i !== active) return s
      const rows = s.rows.map((r) => [...r])
      while (rows.length <= row) rows.push([])
      const line = rows[row]
      while (line.length <= column) line.push('')
      line[column] = text.slice(0, SHEET_LIMIT.cell)
      return { ...s, rows }
    })
    onChange({ sheets })
  }

  function addRow() {
    onChange({
      sheets: workbook.sheets.map((s, i) =>
        i === active ? { ...s, rows: [...s.rows, new Array(columns).fill('')] } : s,
      ),
    })
  }

  function addColumn() {
    onChange({
      sheets: workbook.sheets.map((s, i) =>
        i === active ? { ...s, rows: s.rows.map((r) => [...r, '']) } : s,
      ),
    })
  }

  function addSheet() {
    onChange({
      sheets: [
        ...workbook.sheets,
        { name: `Sheet ${workbook.sheets.length + 1}`, rows: [['', '', '']] },
      ],
    })
    setActive(workbook.sheets.length)
  }

  return (
    <div className="space-y-2">
      {workbook.sheets.length > 1 && (
        <div className="surface-sunken flex flex-wrap gap-1 rounded-lg p-0.5" role="group" aria-label="Sheets">
          {workbook.sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              aria-current={i === active ? 'true' : undefined}
              onClick={() => setActive(i)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                i === active ? 'surface text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[55vh] overflow-auto rounded-xl border border-line">
        <table className="border-collapse text-[12px]">
          <caption className="sr-only">{sheet.name}</caption>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-10 border-r border-b border-line surface-sunken" />
              {Array.from({ length: columns }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  className="sticky top-0 z-10 min-w-[7rem] border-r border-b border-line surface-sunken px-2 py-1 font-mono text-[11px] font-medium text-faint"
                >
                  {columnName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-b border-line surface-sunken px-2 py-1 text-right font-mono text-[11px] font-medium text-faint"
                >
                  {r + 1}
                </th>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c} className="border-r border-b border-line p-0">
                    <input
                      aria-label={`${sheet.name} ${columnName(c)}${r + 1}`}
                      value={row[c] ?? ''}
                      readOnly={readOnly}
                      maxLength={SHEET_LIMIT.cell}
                      onChange={(e) => write(r, c, e.target.value)}
                      className="w-full bg-transparent px-2 py-1 text-ink outline-none focus:bg-[var(--surface-sunken)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={addRow} disabled={sheet.rows.length >= SHEET_LIMIT.rows}>
            <Icon name="plus" size={13} />
            Row
          </Button>
          <Button size="sm" variant="ghost" onClick={addColumn} disabled={columns >= SHEET_LIMIT.columns}>
            <Icon name="plus" size={13} />
            Column
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={addSheet}
            disabled={workbook.sheets.length >= SHEET_LIMIT.sheets}
          >
            <Icon name="plus" size={13} />
            Sheet
          </Button>
          <p className="ml-auto self-center text-[11px] text-faint">
            A cell starting with = keeps its formula for Excel to work out.
          </p>
        </div>
      )}
    </div>
  )
}
