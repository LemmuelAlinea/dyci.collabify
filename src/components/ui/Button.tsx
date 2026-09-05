import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from './Icon'

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'onNavy' | 'danger'
type Size = 'sm' | 'md' | 'lg'

// `btn` is a styling hook, not a style. It carries nothing on the public side;
// inside `.app-ui` it is what squares off the corners and drops the coloured
// glow, so the same component can be a marketing pill out there and a plain
// control in here.
const BASE =
  'btn inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap ' +
  'transition-[scale,background-color,border-color,box-shadow,color] duration-(--dur-press) ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-navy-600 text-white hover:bg-navy-500 shadow-[0_6px_18px_-6px_rgba(38,50,122,0.65)] dark:bg-navy-500 dark:hover:bg-navy-400',
  accent:
    'bg-amber-400 text-navy-900 hover:bg-amber-300 shadow-[0_6px_18px_-6px_rgba(240,180,41,0.8)]',
  outline:
    'border border-[var(--line-strong)] text-ink hover:bg-[var(--surface-sunken)]',
  ghost: 'text-muted hover:text-ink hover:bg-[var(--surface-sunken)]',
  onNavy: 'border border-white/25 text-white hover:bg-white/10',
  danger: 'bg-red-600 text-white hover:bg-red-500',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-[14.5px]',
  lg: 'h-[52px] px-7 text-[15.5px]',
}

type Common = {
  variant?: Variant
  size?: Size
  loading?: boolean
  full?: boolean
  children: ReactNode
  className?: string
}

function cls({ variant = 'primary', size = 'md', full, className = '' }: Common) {
  return [BASE, VARIANTS[variant], SIZES[size], full ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ')
}

export function Button({
  variant,
  size,
  loading,
  full,
  className,
  children,
  disabled,
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cls({ variant, size, full, className, children })}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  )
}

export function ButtonLink({
  to,
  variant,
  size,
  full,
  className,
  children,
}: Common & { to: string }) {
  return (
    <Link to={to} className={cls({ variant, size, full, className, children })}>
      {children}
    </Link>
  )
}

export function ButtonAnchor({
  href,
  variant,
  size,
  full,
  className,
  children,
}: Common & { href: string }) {
  return (
    <a href={href} className={cls({ variant, size, full, className, children })}>
      {children}
    </a>
  )
}
