import { createContext, useContext } from 'react'

export type Tone = 'success' | 'error' | 'info'

/** Filled by ToastProvider (./ToastProvider.tsx), which draws the toasts. */
export const ToastContext = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
