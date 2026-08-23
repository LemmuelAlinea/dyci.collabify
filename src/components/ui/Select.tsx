import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Icon } from './Icon'

const CONTROL =
  'w-full rounded-xl border border-[var(--control-line)] bg-[var(--surface)] text-ink ' +
  'transition-[border-color,box-shadow] duration-200 hover:border-[var(--line-strong)] ' +
  'focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12 ' +
  'disabled:opacity-60'

export type Option = { value: string; label: string }

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: Option[]
  placeholder?: string
}

export function Select({ options, placeholder, className = '', ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={`${CONTROL} h-12 appearance-none px-4 pr-10 text-[14.5px] ${className}`}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={17}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-faint"
      />
    </div>
  )
}

export function Textarea({
  className = '',
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={`${CONTROL} resize-y px-4 py-3 text-[14.5px] leading-relaxed ${className}`}
      {...rest}
    />
  )
}
