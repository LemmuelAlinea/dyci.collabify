import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/**
 * A message about what just happened.
 *
 * `onRetry` exists because every page in this product already catches its fetch
 * failures and renders one of these — and none of them offered a way out. A
 * student whose wifi dropped for a second read "could not load your classes"
 * and had no option but to find the browser's reload button. The loader is
 * already a callback on every page; this puts a button on it.
 */
export function Alert({
  tone = 'info',
  children,
  onRetry,
}: {
  tone?: 'info' | 'success' | 'error'
  children: ReactNode
  onRetry?: () => void | Promise<void>
}) {
  const map = {
    info: {
      icon: 'info' as IconName,
      cls: 'border-navy-200 bg-navy-50 text-navy-700 dark:border-navy-500/40 dark:bg-navy-500/12 dark:text-navy-100',
    },
    success: {
      icon: 'checkCircle' as IconName,
      cls: 'border-success-200 bg-success-50 text-success-800 dark:border-success-500/40 dark:bg-success-500/12 dark:text-success-200',
    },
    error: {
      icon: 'alert' as IconName,
      cls: 'border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-500/40 dark:bg-danger-500/12 dark:text-danger-200',
    },
  }[tone]

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${map.cls}`}
    >
      <Icon name={map.icon} size={17} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onRetry && (
        <button
          type="button"
          onClick={() => void onRetry()}
          className="shrink-0 rounded-lg border border-current/25 px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-current/10"
        >
          Try again
        </button>
      )}
    </div>
  )
}
