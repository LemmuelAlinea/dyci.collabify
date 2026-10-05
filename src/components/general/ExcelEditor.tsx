import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Workbook as FortuneWorkbook } from '@fortune-sheet/react'
import type { WorkbookInstance } from '@fortune-sheet/react'
import { locale, update as formatValue } from '@fortune-sheet/core'
import type { Sheet as FortuneSheet } from '@fortune-sheet/core'
import '@fortune-sheet/react/dist/index.css'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { draftFormula } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { columnName } from '../../lib/general/sheet'
import type { Workbook } from '../../lib/general/sheet'
import { calculateWorkbook } from '../../lib/general/sheetCalc'
import type { CellValue } from '../../lib/general/sheetCalc'
import { EXCEL_SIZE, fromFortune, toFortune } from '../../lib/general/sheetFortune'
import './excel.css'

/*
 * Only what the stored workbook keeps (`sheetFormat.ts`). Images, comments,
 * links, filters, conditional formats, charts and hidden rows would look saved
 * and then vanish on the next open, so they are not offered.
 */
const TOOLBAR = [
  'undo', 'redo', 'format-painter', 'clear-format', '|',
  'currency-format', 'percentage-format', 'number-decrease', 'number-increase', 'format', '|',
  'font', '|', 'font-size', '|',
  'bold', 'italic', 'strike-through', 'underline', '|',
  'font-color', 'background', 'border', 'merge-cell', '|',
  'horizontal-align', 'vertical-align', 'text-wrap', '|',
  'freeze', 'quick-formula', 'search',
]
const CELL_MENU = [
  'copy', 'paste', '|', 'insert-row', 'insert-column', 'delete-row', 'delete-column', 'delete-cell',
  'set-row-height', 'set-column-width', '|', 'clear', 'sort', 'orderAZ', 'orderZA',
]
const HEADER_MENU = [
  'copy', 'paste', '|', 'insert-row', 'insert-column', 'delete-row', 'delete-column',
  'set-row-height', 'set-column-width', '|', 'clear', 'sort', 'orderAZ', 'orderZA',
]
const TAB_MENU = ['delete', 'copy', 'rename', '|', 'move']

/*
 * The grid draws a cell with no font in the first font of its list, which is
 * Times New Roman; Excel's is Calibri. Its font picker stores names, not
 * positions, so the list can be Excel's own.
 */
const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Courier New', 'Garamond', 'Century Gothic']
{
  const en = locale({ lang: 'en' } as Parameters<typeof locale>[0]) as { fontarray: string[]; fontjson: Record<string, number> }
  en.fontarray.splice(0, en.fontarray.length, ...FONTS)
  en.fontjson = Object.fromEntries(FONTS.map((f, i) => [f.toLowerCase(), i]))
}

/** A value as the grid shows it under a number format ("0.00", "₱#,##0", dates…). */
function shown(value: CellValue, format: string) {
  if (typeof value === 'number') {
    try {
      return String(formatValue(format, value) ?? value)
    } catch {
      return String(value)
    }
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return value === null ? '' : String(value)
}

/**
 * A stored formula carries no result, and the grid does not work formulas out
 * when it loads. They are worked out here with the grid's own engine
 * (`sheetCalc.ts`), and each formula cell joins the sheet's calculation chain
 * so editing a cell it reads updates it.
 */
function withResults(sheets: FortuneSheet[], workbook: Workbook) {
  const results = calculateWorkbook(workbook)
  sheets.forEach((fs, s) => {
    const chain: { r: number; c: number; id: string }[] = []
    for (const at of fs.celldata ?? []) {
      const cell = at.v
      if (!cell) continue
      const format = cell.ct?.fa ?? 'General'
      if (cell.f) {
        const value = results.get(`${s}:${at.r}:${at.c}`) ?? null
        cell.v = value ?? undefined
        cell.m = shown(value, format)
        cell.ct = { fa: format, t: typeof value === 'number' ? 'n' : 'g' }
        chain.push({ r: at.r, c: at.c, id: fs.id as string })
      } else if (typeof cell.v === 'number' && format !== 'General') {
        cell.m = shown(cell.v, format)
      }
    }
    fs.calcChain = chain
  })
  return sheets
}

/**
 * An Excel file, in an Excel-like grid (Fortune-sheet): the ribbon, the
 * formula bar, formulas worked out as you type (SUM, IF, VLOOKUP and the
 * rest), number formats, fonts, fills, borders, merged cells, frozen panes,
 * column widths, sheet tabs, keyboard moves and copy and paste.
 *
 * `workbook` is read when the file opens; after that the grid owns the cells
 * and every change goes out through `onChange` as the stored workbook.
 */
export default function ExcelEditor({
  workbook,
  onChange,
  readOnly = false,
  fill = false,
  projectId,
}: {
  workbook: Workbook
  onChange: (next: Workbook) => void
  readOnly?: boolean
  fill?: boolean
  /** Set to offer the formula helper, which asks on behalf of this project. */
  projectId?: string
}) {
  const [data] = useState(() => withResults(toFortune(workbook), workbook))
  const grid = useRef<WorkbookInstance>(null)
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const [helping, setHelping] = useState(false)
  const [rows, setRows] = useState(workbook.sheets[0]?.rows ?? [])

  const latest = useRef({ onChange, readOnly })
  useEffect(() => {
    latest.current = { onChange, readOnly }
  })

  /*
   * The grid re-runs its own effects whenever `onChange` or `hooks` is a new
   * object, and each run reports a change — so both are made once, or every
   * render would trigger another without end.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // The grid reports every keystroke; the stored workbook is rebuilt once it settles.
  const changed = useCallback((sheets: FortuneSheet[]) => {
    if (latest.current.readOnly) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const next = fromFortune(sheets)
      latest.current.onChange(next)
      setRows(next.sheets[0]?.rows ?? [])
    }, 150)
  }, [])
  const hooks = useMemo(
    () => ({
      afterSelectionChange: (_sheet: string, selection: { row?: number[]; column?: number[]; row_focus?: number; column_focus?: number }) => {
        const r = selection.row_focus ?? selection.row?.[0]
        const c = selection.column_focus ?? selection.column?.[0]
        if (r !== undefined && c !== undefined) setCell((was) => (was?.r === r && was?.c === c ? was : { r, c }))
      },
    }),
    [],
  )

  return (
    <div className="space-y-2">
      <div
        className={`excel-frame overflow-hidden rounded-xl border border-line ${
          fill ? 'h-[calc(100dvh-17rem)] min-h-[18rem]' : 'h-[62vh] min-h-[22rem]'
        }`}
      >
        <FortuneWorkbook
          ref={grid}
          data={data}
          onChange={changed}
          allowEdit={!readOnly}
          showToolbar={!readOnly}
          showFormulaBar
          showSheetTabs
          lang="en"
          currency="₱"
          defaultFontSize={EXCEL_SIZE}
          toolbarItems={TOOLBAR}
          cellContextMenu={CELL_MENU}
          headerContextMenu={HEADER_MENU}
          sheetTabContextMenu={TAB_MENU}
          hooks={hooks}
        />
      </div>

      {!readOnly && projectId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setHelping((v) => !v)} aria-expanded={helping}>
            <Icon name="spark" size={13} />
            Formula help
          </Button>
          <p className="text-[11px] text-faint">
            Formulas work out as you type. The file keeps the formula, so Excel shows the same answer.
          </p>
        </div>
      )}

      {!readOnly && projectId && helping && (
        <FormulaHelper
          projectId={projectId}
          rows={rows}
          cell={cell}
          onPut={(formula) => {
            if (!cell) return
            grid.current?.setCellValue(cell.r, cell.c, formula)
          }}
        />
      )}
    </div>
  )
}

/**
 * Describe the sum, get the formula. It reads the header row and a few rows
 * under it so the formula names real columns; it is only ever a suggestion to
 * put in a cell.
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
