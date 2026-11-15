import { lazy, Suspense, useState } from 'react'
import type { ComponentProps } from 'react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { isComparableExcel, isExcelPath, officeAppName } from '../../lib/general/files'
import { officeViewerReachable } from '../../lib/general/officeViewer'
import { OfficeViewer } from './OfficeViewer'

// docx-preview and the font twins load only when somebody opens the simple preview.
const DocxPreview = lazy(() => import('./DocxPreview').then((m) => ({ default: m.DocxPreview })))
// The sheet grid loads only when somebody opens an Excel file's simple preview.
const ExcelPreview = lazy(() => import('./ExcelPreview'))

/**
 * A Word or Excel file (by its label's extension), drawn by Microsoft's Office
 * viewer where Microsoft can reach the file (the live site), else by the in-app
 * preview: the page view for a .docx, the read-only sheet view for a .xlsx or
 * .xlsm. A .xls has no simple preview. Either way the download is the exact file.
 */
export function LazyDocxPreview(props: ComponentProps<typeof DocxPreview>) {
  const reachable = officeViewerReachable(window.location.hostname)
  const [simple, setSimple] = useState(!reachable)
  const app = officeAppName(props.label)
  const excel = isExcelPath(props.label)
  const hasSimple = !excel || isComparableExcel(props.label)

  if (!simple) {
    return <OfficeViewer {...props} app={app} onSimple={hasSimple ? () => setSimple(true) : undefined} />
  }
  if (!hasSimple) return null

  return (
    <div className="space-y-2">
      {reachable && (
        <Button size="sm" variant="ghost" onClick={() => setSimple(false)}>
          Show it as {app} draws it
        </Button>
      )}
      <Suspense
        fallback={
          <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line bg-[var(--surface-sunken)] text-[13px] text-muted">
            <Spinner size={14} />
            Opening the {excel ? 'spreadsheet' : 'document'}…
          </div>
        }
      >
        {excel ? <ExcelPreview {...props} /> : <DocxPreview {...props} />}
      </Suspense>
    </div>
  )
}
