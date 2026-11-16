import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
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
  pageSize: { width: number; height: number }
}

export function PdfPreview({
  storagePath,
  label,
  fill = false,
}: {
  storagePath: string
  label: string
  /** Full screen: take the window's height instead of stopping at 70%. */
  fill?: boolean
}) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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
        const first = await document.getPage(1)
        if (!alive) return
        const viewport = first.getViewport({ scale: 1.35 })
        setLoaded({
          document,
          pages: Array.from({ length: document.numPages }, (_, i) => i + 1),
          pageSize: { width: viewport.width, height: viewport.height },
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
      ref={scrollRef}
      aria-label={label}
      className={`overflow-auto ${fill ? 'h-[calc((100dvh/var(--zoom,1))-11rem)]' : 'max-h-[calc(70vh/var(--zoom,1))]'} rounded-xl border border-line bg-neutral-100 p-3 dark:bg-neutral-950`}
    >
      <div className="mx-auto flex max-w-full flex-col items-center gap-3">
        {loaded.pages.map((pageNumber) => (
          <PdfPage key={pageNumber} document={loaded.document} pageNumber={pageNumber} pageSize={loaded.pageSize} scrollRoot={scrollRef} />
        ))}
      </div>
    </div>
  )
}

function PdfPage({
  document,
  pageNumber,
  pageSize,
  scrollRoot,
}: {
  document: pdfjs.PDFDocumentProxy
  pageNumber: number
  pageSize: { width: number; height: number }
  scrollRoot: RefObject<HTMLDivElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState(pageSize)

  useEffect(() => {
    const element = pageRef.current
    if (!element) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '600px 0px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollRoot])

  useEffect(() => {
    if (!visible) return
    let alive = true
    let renderTask: pdfjs.RenderTask | null = null
    void (async () => {
      const page = await document.getPage(pageNumber)
      if (!alive) return
      const viewport = page.getViewport({ scale: 1.35 })
      setSize({ width: viewport.width, height: viewport.height })
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
    })().catch(() => {})
    return () => {
      alive = false
      renderTask?.cancel()
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current.height = 0
      }
    }
  }, [document, pageNumber, visible])

  return (
    <div ref={pageRef} style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }} className="max-w-full shrink-0 rounded bg-white shadow-sm">
      <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} className="block h-full w-full rounded" />
    </div>
  )
}
