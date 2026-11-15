import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Spinner } from '../ui/Icon'
import { projectFileBlob } from '../../lib/api/general'
import { xlsxToWorkbook } from '../../lib/general/office'
import type { Workbook } from '../../lib/general/sheet'
import { sheetCellChanges } from '../../lib/general/sheetCellChanges'
import type { CellChange } from '../../lib/general/sheetCellChanges'

/** A storage path, null (nothing there), or a lookup that gives one. */
type Source = string | null | (() => Promise<string | null>)

const SHOWN = 200

async function workbookOf(source: Source): Promise<Workbook | null> {
  const path = typeof source === 'function' ? await source() : source
  if (!path) return null
  const blob = await projectFileBlob(path)
  return xlsxToWorkbook(new File([blob], path.split('/').pop() || 'file.xlsx'))
}

/** What changed between two Excel files, by their cells. Key it on the versions it compares. */
export function ExcelDiff({
  before,
  after,
  caption,
}: {
  before: Source
  after: Source
  caption: string
}) {
  const [changes, setChanges] = useState<CellChange[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setChanges(null)
    setFailed(false)
    void Promise.all([workbookOf(before), workbookOf(after)])
      .then(([b, a]) => alive && setChanges(sheetCellChanges(b, a)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // Runs once per mount: give the component a key that changes with its versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed) return <Alert tone="error">Could not read one of the versions. Download them to compare in Excel.</Alert>
  if (!changes) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Spinner size={14} />
        Reading the versions…
      </div>
    )
  }

  const shown = changes.slice(0, SHOWN)
  const sheets = [...new Set(shown.map((c) => c.sheet))]
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-ink">{caption}</p>
      {changes.length === 0 ? (
        <p className="text-[12px] text-muted">No cell values or formulas changed.</p>
      ) : (
        sheets.map((name) => (
          <div key={name} className="overflow-hidden rounded-lg border border-line">
            <p className="surface-sunken px-3 py-1.5 font-mono text-[12px] text-ink">{name}</p>
            <ul className="divide-y divide-line text-[12px]">
              {shown
                .filter((c) => c.sheet === name)
                .map((c) =>
                  c.cell === '' ? (
                    <li key="sheet" className="px-3 py-1.5 text-ink">
                      {c.after ? 'Sheet added' : 'Sheet removed'}
                    </li>
                  ) : (
                    <li key={c.cell} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                      <span className="w-12 shrink-0 font-mono text-muted">{c.cell}</span>
                      <span className="min-w-0 break-words rounded bg-danger-500/10 px-1.5 text-danger-800 dark:text-danger-200">
                        {c.before || 'empty'}
                      </span>
                      <span className="min-w-0 break-words rounded bg-success-500/10 px-1.5 text-success-800 dark:text-success-200">
                        {c.after || 'empty'}
                      </span>
                    </li>
                  ),
                )}
            </ul>
          </div>
        ))
      )}
      {changes.length > SHOWN && <p className="text-[12px] text-muted">and {changes.length - SHOWN} more</p>}
      <p className="text-[12px] text-muted">Compares cell values and formulas. Formatting and charts do not show here.</p>
    </div>
  )
}
