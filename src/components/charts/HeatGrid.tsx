import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Tone } from '../../lib/analyticsMath'
import { TONE_CELL } from './format'

export type HeatCell = { value: ReactNode; tone: Tone; title?: string }
export type HeatRow = { key: string; label: ReactNode; cells: HeatCell[]; id?: string }

/**
 * A real table whose cells carry their tone. Readable without colour: every cell prints its value.
 *
 * With `maxRows`, the table stops growing at that many rows and the rest
 * scroll under a header that stays put. The height is measured from the rows
 * themselves, since a label can wrap to two lines.
 */
export function HeatGrid({
  columns,
  rows,
  caption,
  maxRows,
}: {
  columns: string[]
  rows: HeatRow[]
  caption: string
  maxRows?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const capped = maxRows !== undefined && rows.length > maxRows
  // Stuck, the header also covers the cell spacing around it, so scrolled rows
  // do not show through the gaps.
  const head = `px-2 py-1 text-left text-[12px] font-medium text-faint${capped ? ' shadow-[0_0_0_4px_var(--surface)]' : ''}`

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !capped) return setHeight(null)
    const measure = () => {
      const last = el.querySelectorAll('tbody tr')[maxRows - 1] as HTMLElement | undefined
      if (!last) return
      // The bottom of the last row shown, plus the table's own spacing below it.
      setHeight(last.offsetTop + last.offsetHeight + 4)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [capped, maxRows, rows])

  return (
    <div
      ref={box}
      className={capped ? 'overflow-auto overscroll-contain' : 'overflow-x-auto'}
      style={capped && height ? { maxHeight: height } : undefined}
    >
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className={capped ? 'sticky top-0 z-10 bg-[var(--surface)]' : undefined}>
          <tr>
            <th scope="col" className={head}>Group</th>
            {columns.map((c) => (
              <th key={c} scope="col" className={head}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} id={r.id}>
              <th scope="row" className="max-w-[220px] px-2 py-1.5 text-left font-normal text-ink">{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={columns[i]} title={c.title} className={`rounded-md px-2 py-1.5 font-mono text-[12px] ${TONE_CELL[c.tone]}`}>
                  {c.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
