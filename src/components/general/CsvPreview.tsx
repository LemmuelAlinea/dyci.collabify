import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { uploadProjectFile } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { workbookToXlsx } from '../../lib/general/office'
import { officeViewerReachable } from '../../lib/general/officeViewer'
import type { Workbook } from '../../lib/general/sheet'
import ExcelEditor from './ExcelEditor'
import { OfficeViewer } from './OfficeViewer'

export function CsvPreview({
  projectId,
  label,
  workbook,
  fill,
  onEdit,
}: {
  projectId?: string
  label: string
  workbook: Workbook
  fill: boolean
  onEdit?: () => void
}) {
  const reachable = officeViewerReachable(window.location.hostname)
  const [simple, setSimple] = useState(!reachable || !projectId)
  const [storagePath, setStoragePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (simple || !projectId || storagePath) return
    let alive = true
    const xlsxName = label.replace(/\.csv$/i, '.xlsx')
    workbookToXlsx(workbook, { preserveText: true })
      .then((blob) => uploadProjectFile(projectId, new File([blob], xlsxName, { type: blob.type })))
      .then((path) => {
        if (alive) setStoragePath(path)
      })
      .catch((err) => {
        if (!alive) return
        setError(authErrorMessage(err, 'Could not open this CSV in Microsoft Excel.'))
        setSimple(true)
      })
    return () => {
      alive = false
    }
  }, [simple, projectId, storagePath, label, workbook])

  return (
    <div className="space-y-2">
      {onEdit && <Button size="sm" variant="outline" onClick={onEdit}>Edit CSV</Button>}
      {error && <Alert tone="info">{error} Showing the spreadsheet here instead.</Alert>}
      {simple ? (
        <>
          {reachable && projectId && (
            <Button size="sm" variant="ghost" onClick={() => { setError(null); setSimple(false) }}>
              Show in Microsoft Excel
            </Button>
          )}
          <ExcelEditor workbook={workbook} onChange={() => {}} readOnly fill={fill} />
        </>
      ) : storagePath ? (
        <>
          <p className="text-[12px] text-muted">Converted from CSV for Microsoft's Excel viewer.</p>
          <OfficeViewer
            storagePath={storagePath}
            label={label.replace(/\.csv$/i, '.xlsx')}
            fill={fill}
            app="Excel"
            onSimple={() => setSimple(true)}
            note=""
          />
        </>
      ) : (
        <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line surface-sunken text-[13px] text-muted">
          <Spinner size={14} />
          Preparing the CSV for Microsoft Excel…
        </div>
      )}
    </div>
  )
}
