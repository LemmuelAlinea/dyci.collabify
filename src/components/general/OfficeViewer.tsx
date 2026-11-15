import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { projectFileUrl } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { officeViewerUrl } from '../../lib/general/officeViewer'

/**
 * A Word file drawn by Microsoft's own Office viewer, so headers, text boxes,
 * page borders, page numbers and page breaks look as they do in Word.
 * Microsoft fetches the file through a signed link that expires in 10 minutes.
 */
export function OfficeViewer({
  storagePath,
  label,
  fill = false,
  onSimple,
}: {
  storagePath: string
  label: string
  fill?: boolean
  /** Switch to the in-app preview instead. */
  onSimple: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setError(null)
    setLoaded(false)
    projectFileUrl(storagePath)
      .then((url) => {
        if (alive) setSrc(officeViewerUrl(url))
      })
      .catch((err) => {
        if (alive) setError(authErrorMessage(err, 'Could not open the file for the viewer.'))
      })
    return () => {
      alive = false
    }
  }, [storagePath])

  async function download() {
    try {
      window.open(await projectFileUrl(storagePath, label), '_blank', 'noopener')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not prepare that download.'))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-muted">Shown by Microsoft's Office viewer, as Word draws it.</p>
        <Button size="sm" variant="outline" onClick={() => void download()}>
          <Icon name="download" size={14} />
          Download
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onSimple}>
          Use the simple preview
        </Button>
      </div>
      <p className="text-[12px] text-faint">
        From Google Docs, download it as Microsoft Word (.docx) before uploading. Converting it to a Google Doc
        and back can change the formatting.
      </p>
      {error && <Alert tone="error">{error} Try the simple preview, or download the file.</Alert>}
      <div
        className={`relative overflow-hidden rounded-xl border border-line bg-[var(--surface-sunken)] ${
          fill ? 'h-[calc((100dvh/var(--zoom,1))-14rem)]' : 'h-[calc(75vh/var(--zoom,1))]'
        } min-h-[24rem]`}
      >
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted">
            <Spinner size={15} />
            Opening it in the Office viewer…
          </div>
        )}
        {src && (
          <iframe
            key={src}
            title={label}
            src={src}
            onLoad={() => setLoaded(true)}
            referrerPolicy="no-referrer"
            // The viewer loads the document by posting a form inside its own frame.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            className="relative block h-full w-full border-0"
          />
        )}
      </div>
    </div>
  )
}
