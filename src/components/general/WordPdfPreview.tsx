import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { wordPdfUrl } from '../../lib/api/wordPdf'
import { authErrorMessage } from '../../lib/authError'
import { LazyPdfPreview as PdfPreview } from './LazyPdfPreview'

/**
 * A Word file shown as the PDF the server makes of it, so pages, headers, text
 * boxes and page breaks look as they do in Word. The file itself stays the
 * uploaded .docx; the PDF is only what people see. `simple` is the in-app page
 * view, offered when the PDF cannot be made (a .docx only).
 */
export function WordPdfPreview({
  storagePath,
  label,
  fill = false,
  simple,
}: {
  storagePath: string
  label: string
  fill?: boolean
  simple?: ReactNode
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [showSimple, setShowSimple] = useState(false)

  useEffect(() => {
    if (showSimple) return
    let alive = true
    setUrl(null)
    setError(null)
    wordPdfUrl(storagePath)
      .then((link) => {
        if (alive) setUrl(link)
      })
      .catch((err) => {
        if (alive) setError(authErrorMessage(err, 'Could not make the PDF preview. Try again, or download the file.'))
      })
    return () => {
      alive = false
    }
  }, [storagePath, attempt, showSimple])

  if (showSimple && simple) {
    return (
      <div className="space-y-2">
        <Button size="sm" variant="ghost" onClick={() => setShowSimple(false)}>
          Show it as a PDF
        </Button>
        {simple}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-muted">Shown as a PDF of this file. Download gets the original Word file.</p>
        {simple && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowSimple(true)}>
            Use the simple preview
          </Button>
        )}
      </div>
      <p className="text-[12px] text-faint">
        From Google Docs, download it as Microsoft Word (.docx) before uploading. Converting it to a Google Doc and
        back can change the formatting.
      </p>
      {error ? (
        <Alert tone="error">
          <span>{error}</span>{' '}
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Alert>
      ) : url ? (
        <PdfPreview url={url} label={label} fill={fill} />
      ) : (
        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-1 rounded-xl border border-line bg-[var(--surface-sunken)] px-4 text-center text-[13px] text-muted">
          <span className="flex items-center gap-2">
            <Spinner size={15} />
            Making the PDF preview…
          </span>
          <span className="text-[12px] text-faint">The first look at a long file can take up to a minute.</span>
        </div>
      )}
    </div>
  )
}
