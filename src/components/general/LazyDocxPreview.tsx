import { lazy, Suspense, useState } from 'react'
import type { ComponentProps } from 'react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { officeViewerReachable } from '../../lib/general/officeViewer'
import { OfficeViewer } from './OfficeViewer'

// docx-preview and the font twins load only when somebody opens the simple preview.
const DocxPreview = lazy(() => import('./DocxPreview').then((m) => ({ default: m.DocxPreview })))

/**
 * A Word file, drawn by Microsoft's Office viewer where Microsoft can reach the
 * file (the live site), else by the in-app preview. Either way the download is
 * the exact file.
 */
export function LazyDocxPreview(props: ComponentProps<typeof DocxPreview>) {
  const reachable = officeViewerReachable(window.location.hostname)
  const [simple, setSimple] = useState(!reachable)

  if (!simple) return <OfficeViewer {...props} onSimple={() => setSimple(true)} />

  return (
    <div className="space-y-2">
      {reachable && (
        <Button size="sm" variant="ghost" onClick={() => setSimple(false)}>
          Show it as Word draws it
        </Button>
      )}
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
    </div>
  )
}
