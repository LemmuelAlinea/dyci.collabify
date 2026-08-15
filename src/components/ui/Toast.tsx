import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

type Tone = 'success' | 'error' | 'info'
type Toast = { id: number; tone: Tone; message: string }

const ToastContext = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null)

const STYLES: Record<Tone, { icon: IconName; cls: string }> = {
  success: {
    icon: 'checkCircle',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950 dark:text-emerald-100',
  },
  error: {
    icon: 'alert',
    cls: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-950 dark:text-red-100',
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
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
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
            className={`pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-xl border px-4 py-3 text-[14px] shadow-lift ${STYLES[t.tone].cls}`}
          >
            <Icon name={STYLES[t.tone].icon} size={17} className="mt-px shrink-0" />
            <span className="min-w-0">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
