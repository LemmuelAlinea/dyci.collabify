import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { DUR } from '../../lib/motion'
import { ToastContext } from './Toast'
import type { Tone } from './Toast'

type Toast = { id: number; tone: Tone; message: string; closing?: boolean }

// Each kind reads its own slot, which Settings → Appearance can recolor; the
// defaults in index.css are the same tints these classes used to hard-code.
const STYLES: Record<Tone, { icon: IconName; cls: string }> = {
  success: {
    icon: 'checkCircle',
    cls: 'border-toast-success-line bg-toast-success text-toast-success-ink',
  },
  error: {
    icon: 'alert',
    cls: 'border-toast-error-line bg-toast-error text-toast-error-ink',
  },
  info: {
    icon: 'info',
    cls: 'border-toast-info-line bg-toast-info text-toast-info-ink',
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, message }])
    // Two phases. The first marks the toast closed so the transition has
    // something to play; the second removes it once that transition is over.
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, closing: true } : x)))
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), DUR.overlay)
    }, 4200)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-70 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-state={t.closing ? 'closed' : 'open'}
            className={`motion-toast pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-xl border px-4 py-3 text-[14px] shadow-lift ${STYLES[t.tone].cls}`}
          >
            <Icon name={STYLES[t.tone].icon} size={17} className="mt-px shrink-0" />
            <span className="min-w-0">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
