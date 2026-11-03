import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A board whose sideways scrollbar sits above the columns instead of under
 * the longest one. The top bar is an empty scroller as wide as the board,
 * kept in step with it both ways; the board's own bar is hidden. It shows
 * only while the columns overflow.
 */
export function BoardScroller({ className, children }: { className: string; children: ReactNode }) {
  const top = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  const measure = () => {
    const el = board.current
    if (el) setWidth(el.scrollWidth > el.clientWidth + 1 ? el.scrollWidth : 0)
  }

  // Columns come and go with filters and stages, which the board's own box
  // does not report, so measure after every render as well as on resize.
  useLayoutEffect(measure)
  useEffect(() => {
    const observer = new ResizeObserver(measure)
    observer.observe(board.current!)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div
        ref={top}
        aria-hidden="true"
        onScroll={() => {
          if (board.current) board.current.scrollLeft = top.current!.scrollLeft
        }}
        className="general-project-scroll overflow-x-auto"
        style={{ display: width ? undefined : 'none' }}
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div
        ref={board}
        onScroll={() => {
          if (top.current) top.current.scrollLeft = board.current!.scrollLeft
        }}
        className={`scroll-hidden ${className}`}
      >
        {children}
      </div>
    </>
  )
}
