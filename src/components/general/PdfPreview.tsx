import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { Alert } from '../ui/Alert'
import { Spinner } from '../ui/Icon'
import { projectFileBlob } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

type LoadedPdf = {
  document: pdfjs.PDFDocumentProxy
  pages: number[]
}

export function PdfPreview({
  storagePath,
  label,
}: {
  storagePath: string
  label: string
}) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let task: pdfjs.PDFDocumentLoadingTask | null = null
    setLoaded(null)
    setError(null)
    void (async () => {
      try {
        const blob = await projectFileBlob(storagePath)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        task = pdfjs.getDocument({ data: bytes })
        const document = await task.promise
        if (!alive) {
          await document.destroy()
          return
        }
        setLoaded({
          document,
          pages: Array.from({ length: document.numPages }, (_, i) => i + 1),
        })
      } catch (err) {
        if (alive) setError(authErrorMessage(err, 'Could not load the PDF preview.'))
      }
    })()
    return () => {
      alive = false
      void task?.destroy()
      setLoaded((current) => {
        void current?.document.destroy()
        return null
      })
    }
  }, [storagePath])

  if (error) return <Alert tone="error">{error}</Alert>

  if (!loaded) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line bg-[var(--surface-sunken)] text-[13px] text-muted">
        <Spinner size={15} />
        Loading PDF…
      </div>
    )
  }

  return (
    <div
      aria-label={label}
      className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-neutral-100 p-3 dark:bg-neutral-950"
    >
      <div className="mx-auto flex max-w-full flex-col items-center gap-3">
        {loaded.pages.map((pageNumber) => (
          <PdfPage key={pageNumber} document={loaded.document} pageNumber={pageNumber} />
        ))}
      </div>
    </div>
  )
}

function PdfPage({
  document,
  pageNumber,
}: {
  document: pdfjs.PDFDocumentProxy
  pageNumber: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let alive = true
    let renderTask: pdfjs.RenderTask | null = null
    void (async () => {
      const page = await document.getPage(pageNumber)
      if (!alive) return
      const viewport = page.getViewport({ scale: 1.35 })
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
    })().catch(() => {})
    return () => {
      alive = false
      renderTask?.cancel()
    }
  }, [document, pageNumber])

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Page ${pageNumber}`}
      className="max-w-full rounded bg-white shadow-sm"
    />
  )
}
