import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function ScrollTenList({ ids, label, className, children, visibleRows = 10, ordered = false }: {
  ids: readonly string[]
  label: string
  className: string
  children: ReactNode
  visibleRows?: number
  /** An <ol>, for a list whose order means something (newest first). */
  ordered?: boolean
}) {
  const ref = useRef<HTMLUListElement & HTMLOListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()
  const count = ids.length
  const signature = ids.join('\0')

  useLayoutEffect(() => {
    if (count <= visibleRows) {
      setMaxHeight(undefined)
      return
    }
    const list = ref.current
    const rows = Array.from(list?.children ?? []).slice(0, visibleRows) as HTMLElement[]
    // From the list's top edge to the last shown row's bottom, so gaps between
    // rows (space-y) count as well as dividers, plus the bottom border.
    const measure = () => {
      if (!list || rows.length === 0) return
      const last = rows[rows.length - 1].getBoundingClientRect().bottom
      setMaxHeight(last - list.getBoundingClientRect().top + list.scrollTop + list.clientTop)
    }
    const observer = new ResizeObserver(measure)
    rows.forEach((row) => observer.observe(row))
    measure()
    return () => observer.disconnect()
  }, [count, signature, visibleRows])

  const List = ordered ? 'ol' : 'ul'
  return (
    <List
      ref={ref}
      aria-label={label}
      tabIndex={count > visibleRows ? 0 : undefined}
      style={{ maxHeight }}
      className={`${className} overflow-y-auto`}
    >
      {children}
    </List>
  )
}
