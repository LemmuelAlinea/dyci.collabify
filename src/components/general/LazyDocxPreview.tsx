import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import { Spinner } from '../ui/Icon'

// docx-preview and the font twins load only when somebody opens a Word file.
const DocxPreview = lazy(() => import('./DocxPreview').then((m) => ({ default: m.DocxPreview })))

export function LazyDocxPreview(props: ComponentProps<typeof DocxPreview>) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[18rem] items-center justify-center gap-2 rounded-xl border border-line bg-[var(--surface-sunken)] text-[13px] text-muted">
          <Spinner size={14} />
          Opening the document…
        </div>
      }
    >
      <DocxPreview {...props} />
    </Suspense>
  )
}
