import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Spinner } from '../ui/Icon'
import { projectFileBlob } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { xlsxToWorkbook } from '../../lib/general/office'
import type { Workbook } from '../../lib/general/sheet'
import ExcelEditor from './ExcelEditor'

/**
 * The simple preview of a .xlsx or .xlsm: the in-app sheet view, read-only,
 * built from the stored bytes. The bytes themselves are never rewritten.
 */
export default function ExcelPreview({
  storagePath,
  label,
  fill = false,
}: {
  storagePath: string
  label: string
  fill?: boolean
}) {
  const [book, setBook] = useState<Workbook | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setBook(null)
    setError(null)
    projectFileBlob(storagePath)
      .then(
        (blob) =>
          xlsxToWorkbook(new File([blob], label)).catch(() => {
            throw new Error('Could not read this file. Download it to open it in Excel.')
          }),
        (err: unknown) => {
          throw new Error(authErrorMessage(err, 'Could not load this file. Try again in a moment.'))
        },
      )
      .then((next) => {
        if (alive) setBook(next)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [storagePath, label])

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">A simplified view. Download to see it exactly as Excel shows it.</p>
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : book ? (
        <ExcelEditor key={storagePath} workbook={book} onChange={() => {}} readOnly fill={fill} />
      ) : (
        <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line surface-sunken text-[13px] text-muted">
          <Spinner size={14} />
          Opening the spreadsheet…
        </div>
      )}
    </div>
  )
}
