import { lazy, Suspense, useState } from 'react'
import type { ComponentProps } from 'react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { isComparableExcel, isExcelPath, isPreviewableWord } from '../../lib/general/files'
import { officeViewerReachable } from '../../lib/general/officeViewer'
import { OfficeViewer } from './OfficeViewer'
import { WordPdfPreview } from './WordPdfPreview'

// docx-preview and the font twins load only when somebody opens the simple preview.
const DocxPreview = lazy(() => import('./DocxPreview').then((m) => ({ default: m.DocxPreview })))
// The sheet grid loads only when somebody opens an Excel file's simple preview.
const ExcelPreview = lazy(() => import('./ExcelPreview'))

const loading = (what: string) => (
  <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line bg-[var(--surface-sunken)] text-[13px] text-muted">
    <Spinner size={14} />
    Opening the {what}…
  </div>
)

/**
 * A Word or Excel file (by its label's extension). A Word file shows as the PDF
 * the server makes of it, with the in-app page view as the simple preview for a
 * .docx. An Excel file is drawn by Microsoft's Office viewer where Microsoft can
 * reach it (the live site), else by the read-only sheet view for a .xlsx or
 * .xlsm; a .xls has no simple preview. Either way the download is the exact file.
 */
export function LazyDocxPreview(props: ComponentProps<typeof DocxPreview>) {
  if (!isExcelPath(props.label)) {
    return (
      <WordPdfPreview
        {...props}
        simple={isPreviewableWord(props.label) ? <Suspense fallback={loading('document')}><DocxPreview {...props} /></Suspense> : undefined}
      />
    )
  }
  return <ExcelFilePreview {...props} />
}

function ExcelFilePreview(props: ComponentProps<typeof DocxPreview>) {
  const reachable = officeViewerReachable(window.location.hostname)
  const [simple, setSimple] = useState(!reachable)
  const hasSimple = isComparableExcel(props.label)

  if (!simple) {
    return <OfficeViewer {...props} app="Excel" onSimple={hasSimple ? () => setSimple(true) : undefined} />
  }
  if (!hasSimple) return null

  return (
    <div className="space-y-2">
      {reachable && (
        <Button size="sm" variant="ghost" onClick={() => setSimple(false)}>
          Show it as Excel draws it
        </Button>
      )}
      <Suspense fallback={loading('spreadsheet')}>
        <ExcelPreview {...props} />
      </Suspense>
    </div>
  )
}
