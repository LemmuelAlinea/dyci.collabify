import { useId, useState } from 'react'
import { FilterSearch } from './FilterPopover'

export type CheckboxItem = { id: string; label: string; hint?: string }

/**
 * A list of checkboxes with an optional search, for picking several of many —
 * projects, people, teams. Real inputs, so keyboard and screen readers get the
 * native behaviour; the search only filters what is shown, never what is picked.
 */
export function CheckboxList({
  items,
  selected,
  onChange,
  label,
  searchable = false,
  empty = 'Nothing to choose from.',
  maxHeight = 220,
}: {
  items: CheckboxItem[]
  selected: string[]
  onChange: (next: string[]) => void
  label: string
  searchable?: boolean
  empty?: string
  maxHeight?: number
}) {
  const [query, setQuery] = useState('')
  const uid = useId()
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q)) : items
  const picked = new Set(selected)

  function toggle(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(items.map((i) => i.id).filter((i) => next.has(i)))
  }

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{label}</legend>
      {searchable && items.length > 6 && <FilterSearch value={query} onChange={setQuery} placeholder={`Search ${label.toLowerCase()}`} />}
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5 overflow-y-auto pr-1" style={{ maxHeight }}>
          {shown.map((item) => (
            <li key={item.id}>
              <label
                htmlFor={`${uid}-${item.id}`}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-[var(--surface-sunken)]"
              >
                <input
                  id={`${uid}-${item.id}`}
                  type="checkbox"
                  checked={picked.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-navy-600"
                />
                <span className="min-w-0">
                  <span className="block text-ink">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-faint">{item.hint}</span>}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted">No match for “{query}”.</li>}
        </ul>
      )}
    </fieldset>
  )
}
