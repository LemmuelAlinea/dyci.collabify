import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { TypeOption } from '../../lib/taskTypes/typeSet'
import { Icon } from '../ui/Icon'
import { TypeChip } from './TypeChip'
import { TypeIcon } from './TypeIcon'

/**
 * A task type picker: the chosen type's chip on a button that opens the project's types in order,
 * each with its icon, name and description. Arrows move, Enter picks, Escape closes.
 */
export function TypePicker({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string
  label: string
  value: string
  options: TypeOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const chosen = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const away = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  function show() {
    if (disabled) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  function pick(next: string) {
    onChange(next)
    close()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(options.length - 1, i + 1))
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(options.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') {
      if (options[active]) pick(options[active].value)
    } else if (event.key === 'Escape') {
      // Only the list closes; the dialog around it stays open.
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') close()
    else return
    event.preventDefault()
  }

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        id={id}
        type="button"
        aria-label={chosen ? `${label}: ${chosen.entry.name}` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
        className="flex min-h-[42px] w-full items-center justify-between gap-2 rounded-xl border border-[var(--control-line)] bg-[var(--surface)] px-3 py-2 text-left transition-[border-color,box-shadow] duration-200 hover:border-[var(--line-strong)] focus:border-navy-400 focus:outline-none focus:ring-4 focus:ring-navy-500/12 disabled:opacity-60"
      >
        {chosen ? <TypeChip entry={chosen.entry} size="md" /> : <span className="text-[13px] text-faint">{label}</span>}
        <Icon name="chevronDown" size={16} className="shrink-0 text-faint" />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onKey}
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-[var(--surface-raised)] p-1 shadow-card focus:outline-none sm:right-auto sm:min-w-full sm:w-80"
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(option.value)}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 ${i === active ? 'surface-sunken' : ''}`}
            >
              <TypeIcon entry={option.entry} size={28} />
              <span className="min-w-0 flex-1">
                <span data-type-name="" className="block truncate text-[13px] font-medium text-ink">{option.entry.name}</span>
                {option.entry.removed ? (
                  <span className="block text-[12px] text-muted">No longer one of this project's types</span>
                ) : option.entry.description ? (
                  <span className="block text-[12px] text-muted">{option.entry.description}</span>
                ) : null}
              </span>
              {option.value === value && <Icon name="check" size={16} className="mt-1 shrink-0 text-navy-600 dark:text-amber-400" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
