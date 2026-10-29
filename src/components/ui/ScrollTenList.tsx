import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function ScrollTenList({ ids, label, className, children, visibleRows = 10 }: {
  ids: readonly string[]
  label: string
  className: string
  children: ReactNode
  visibleRows?: number
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()
  const count = ids.length
  const signature = ids.join('\0')

  useLayoutEffect(() => {
    if (count <= visibleRows) {
      setMaxHeight(undefined)
      return
    }
    const rows = Array.from(ref.current?.children ?? []).slice(0, visibleRows) as HTMLElement[]
    const measure = () => setMaxHeight(
      rows.reduce((height, row) => height + row.offsetHeight, 0) + (ref.current?.clientTop ?? 0) * 2,
    )
    const observer = new ResizeObserver(measure)
    rows.forEach((row) => observer.observe(row))
    measure()
    return () => observer.disconnect()
  }, [count, signature, visibleRows])

  return (
    <ul
      ref={ref}
      aria-label={label}
      tabIndex={count > visibleRows ? 0 : undefined}
      style={{ maxHeight }}
      className={`${className} overflow-y-auto`}
    >
      {children}
    </ul>
  )
}
