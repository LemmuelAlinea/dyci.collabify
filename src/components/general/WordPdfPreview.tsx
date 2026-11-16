import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { wordPdfUrl } from '../../lib/api/wordPdf'
import type { WordPdf } from '../../lib/api/wordPdf'
import { authErrorMessage } from '../../lib/authError'
import { LazyPdfPreview as PdfPreview } from './LazyPdfPreview'

/** A kept PDF answers in a second or two; past this, the server is making one. */
const MAKING_AFTER_MS = 5000

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
  const [pdf, setPdf] = useState<WordPdf | null>(null)
  const [making, setMaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [showSimple, setShowSimple] = useState(false)

  useEffect(() => {
    if (showSimple) return
    let alive = true
    setPdf(null)
    setError(null)
    setMaking(false)
    const slow = window.setTimeout(() => {
      if (alive) setMaking(true)
    }, MAKING_AFTER_MS)
    wordPdfUrl(storagePath)
      .then((answer) => {
        if (alive) setPdf(answer)
      })
      .catch((err) => {
        if (alive) setError(authErrorMessage(err, 'Could not make the PDF preview. Try again, or download the file.'))
      })
      .finally(() => window.clearTimeout(slow))
    return () => {
      alive = false
      window.clearTimeout(slow)
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
      ) : pdf ? (
        <PdfPreview url={pdf.url} size={pdf.size} label={label} fill={fill} />
      ) : (
        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-1 rounded-xl border border-line bg-[var(--surface-sunken)] px-4 text-center text-[13px] text-muted">
          <span className="flex items-center gap-2">
            <Spinner size={15} />
            {making ? 'Making the PDF preview…' : 'Opening the PDF preview…'}
          </span>
          {making && (
            <span className="text-[12px] text-faint">The first look at a long file can take up to a minute.</span>
          )}
        </div>
      )}
    </div>
  )
}
