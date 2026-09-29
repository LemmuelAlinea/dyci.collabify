import type { ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from './Icon'
import { cls } from './buttonClass'
import type { Common } from './buttonClass'



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
