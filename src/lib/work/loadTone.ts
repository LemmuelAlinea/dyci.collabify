import type { HolderTone } from './useHolderHours'

/** A load against available hours: over is danger, 80% and up warning, no hours set pending. */
export function loadTone(load: number, available: number | null): HolderTone {
  if (available == null) return 'pending'
  const ratio = available > 0 ? load / available : load > 0 ? Infinity : 0
  return ratio > 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success'
}

/** The bar fill for each tone. */
export const LOAD_BAR: Record<HolderTone, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  pending: 'bg-pending-soft',
}
