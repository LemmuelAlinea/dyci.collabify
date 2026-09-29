import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { DUR } from '../../lib/motion'
import { ToastContext } from './Toast'
import type { Tone } from './Toast'

type Toast = { id: number; tone: Tone; message: string; closing?: boolean }

const STYLES: Record<Tone, { icon: IconName; cls: string }> = {
  success: {
    icon: 'checkCircle',
    cls: 'border-success-200 bg-success-50 text-success-900 dark:border-success-500/40 dark:bg-success-950 dark:text-success-100',
  },
  error: {
    icon: 'alert',
    cls: 'border-danger-200 bg-danger-50 text-danger-900 dark:border-danger-500/40 dark:bg-danger-950 dark:text-danger-100',
  },
  info: {
    icon: 'info',
    cls: 'border-navy-200 bg-navy-50 text-navy-900 dark:border-navy-400/40 dark:bg-navy-800 dark:text-navy-50',
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
