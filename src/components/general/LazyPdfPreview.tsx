import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import { Spinner } from '../ui/Icon'

// pdf.js is most of a megabyte; only somebody opening a PDF should fetch it.
const PdfPreview = lazy(() => import('./PdfPreview').then((m) => ({ default: m.PdfPreview })))

export function LazyPdfPreview(props: ComponentProps<typeof PdfPreview>) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line bg-[var(--surface-sunken)] text-[13px] text-muted">
          <Spinner size={14} />
          Opening the PDF…
        </div>
      }
    >
      <PdfPreview {...props} />
    </Suspense>
  )
}
