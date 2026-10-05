import { useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { draftFormula } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
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
  projectId,
  fill = false,
}: {
  workbook: Workbook
  onChange: (next: Workbook) => void
  readOnly?: boolean
  /** Set to offer the formula helper, which asks on behalf of this project. */
  projectId?: string
  /** Full screen: take the window's height instead of stopping at 55%. */
  fill?: boolean
}) {
  const [active, setActive] = useState(0)
  // The last cell somebody was in: where a drafted formula goes.
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const [helping, setHelping] = useState(false)
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

      <div className={`overflow-auto rounded-xl border border-line ${fill ? 'h-[calc(100dvh-17rem)]' : 'max-h-[55vh]'}`}>
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
                      onFocus={() => setCell({ r, c })}
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
          {projectId && (
            <Button size="sm" variant="ghost" onClick={() => setHelping((v) => !v)} aria-expanded={helping}>
              <Icon name="spark" size={13} />
              Formula help
            </Button>
          )}
          <p className="ml-auto self-center text-[11px] text-faint">
            A cell starting with = keeps its formula for Excel to work out.
          </p>
        </div>
      )}

      {!readOnly && projectId && helping && (
        <FormulaHelper
          projectId={projectId}
          rows={sheet.rows}
          cell={cell}
          onPut={(formula) => cell && write(cell.r, cell.c, formula)}
        />
      )}
    </div>
  )
}

/**
 * Describe the sum, get the formula. It reads the header row and a few rows
 * under it so the formula names real columns, and it is only ever a
 * suggestion to put in a cell: nothing is calculated here.
 */
function FormulaHelper({
  projectId,
  rows,
  cell,
  onPut,
}: {
  projectId: string
  rows: string[][]
  cell: { r: number; c: number } | null
  onPut: (formula: string) => void
}) {
  const [want, setWant] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ formula: string; explanation: string } | null>(null)
  const where = cell ? `${columnName(cell.c)}${cell.r + 1}` : null

  async function run() {
    if (want.trim().length < 4) return setError('Say what the formula should work out.')
    setBusy(true)
    setError(null)
    try {
      const res = await draftFormula(projectId, {
        description: want,
        headers: rows[0] ?? [],
        sample: rows.slice(1, 6),
        cell: where ?? undefined,
      })
      if (res.result !== 'ok') setError(res.message)
      else setResult({ formula: res.formula, explanation: res.explanation })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not write a formula. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Input
            value={want}
            onChange={(e) => setWant(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
            maxLength={500}
            aria-label="What the formula should work out"
            placeholder="Total of Amount where Status is Paid"
            className="!h-10 !text-[13px]"
          />
        </div>
        <Button size="sm" variant="outline" loading={busy} onClick={() => void run()}>
          Write formula
        </Button>
      </div>
      {error && <p className="text-[12px] text-danger-700 dark:text-danger-300">{error}</p>}
      {result && (
        <div className="space-y-1.5">
          {result.formula ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md surface-sunken px-2 py-1 font-mono text-[12px] text-ink">
                {result.formula}
              </code>
              <Button size="sm" variant="ghost" disabled={!where} onClick={() => onPut(result.formula)}>
                {where ? `Put in ${where}` : 'Click a cell first'}
              </Button>
            </div>
          ) : null}
          <p className="text-[12px] text-muted">{result.explanation}</p>
        </div>
      )}
    </div>
  )
}
