import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function ScrollTenList({ ids, label, className, children }: {
  ids: readonly string[]
  label: string
  className: string
  children: ReactNode
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()
  const count = ids.length
  const signature = ids.join('\0')

  useLayoutEffect(() => {
    if (count <= 10) {
      setMaxHeight(undefined)
      return
    }
    const rows = Array.from(ref.current?.children ?? []).slice(0, 10) as HTMLElement[]
    const measure = () => setMaxHeight(
      rows.reduce((height, row) => height + row.offsetHeight, 0) + (ref.current?.clientTop ?? 0) * 2,
    )
    const observer = new ResizeObserver(measure)
    rows.forEach((row) => observer.observe(row))
    measure()
    return () => observer.disconnect()
  }, [count, signature])

  return (
    <ul
      ref={ref}
      aria-label={label}
      tabIndex={count > 10 ? 0 : undefined}
      style={{ maxHeight }}
      className={`${className} overflow-y-auto`}
    >
      {children}
    </ul>
  )
}
