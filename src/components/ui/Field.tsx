import { useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const INPUT_BASE =
  'w-full rounded-xl border border-[var(--control-line)] bg-[var(--surface)] text-ink ' +
  'placeholder:text-[var(--ink-faint)] transition-[border-color,box-shadow] duration-200 ' +
  'hover:border-[var(--line-strong)] focus:border-navy-400 ' +
  'focus:ring-4 focus:ring-navy-500/12 disabled:opacity-60'

type FieldProps = {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
          {label}
          {optional && <span className="ml-1.5 text-[12px] text-faint">optional</span>}
        </label>
        {hint}
      </div>
      {children(id)}
      {error && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-red-600 dark:text-red-400">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { icon?: IconName }

export function Input({ icon, className = '', ...rest }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <Icon
          name={icon}
          size={17}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
        />
      )}
      <input
        className={`${INPUT_BASE} h-12 ${icon ? 'pl-11' : 'pl-4'} pr-4 text-[14.5px] ${className}`}
        {...rest}
      />
    </div>
  )
}

export function PasswordInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Icon
        name="lock"
        size={17}
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
      />
      <input
        type={visible ? 'text' : 'password'}
        className={`${INPUT_BASE} h-12 pr-12 pl-11 text-[14.5px] ${className}`}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-faint transition-colors hover:text-ink"
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </div>
  )
}

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
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/12 dark:text-emerald-200',
    },
    error: {
      icon: 'alert' as IconName,
      cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/12 dark:text-red-200',
    },
  }[tone]

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-relaxed ${map.cls}`}
    >
      <Icon name={map.icon} size={17} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onRetry && (
        <button
          type="button"
          onClick={() => void onRetry()}
          className="shrink-0 rounded-lg border border-current/25 px-2.5 py-1 text-[12.5px] font-medium transition-colors hover:bg-current/10"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6.5 w-12 shrink-0 rounded-full transition-colors duration-250 disabled:opacity-50 ${
        checked ? 'bg-navy-600 dark:bg-navy-400' : 'bg-[var(--line-strong)]'
      }`}
    >
      <span
        className="absolute top-1 left-1 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-250"
        style={{ transform: checked ? 'translateX(22px)' : 'none' }}
      />
    </button>
  )
}
