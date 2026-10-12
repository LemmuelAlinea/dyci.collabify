import type { ReactNode } from 'react'
import type { Tone } from '../../lib/analyticsMath'
import { TONE_CELL } from './format'

export type HeatCell = { value: ReactNode; tone: Tone; title?: string }
export type HeatRow = { key: string; label: ReactNode; cells: HeatCell[] }

/** A real table whose cells carry their tone. Readable without colour: every cell prints its value. */
export function HeatGrid({
  columns,
  rows,
  caption,
}: {
  columns: string[]
  rows: HeatRow[]
  caption: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-[12px] font-medium text-faint">Group</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1 text-left text-[12px] font-medium text-faint">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
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
