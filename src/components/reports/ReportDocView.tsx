import { Bars } from '../charts/Bars'
import { TONE_CELL } from '../charts/format'
import { WeekBars } from '../charts/WeekBars'
import { cellText, cellValue, deltaText } from '../../lib/reports/doc'
import type { Block, Cell, Column, ReportDoc } from '../../lib/reports/doc'
import { Sheet } from './Sheet'

const RIGHT: Column['type'][] = ['number', 'percent', 'score']

function CellView({ cell, col }: { cell: Cell; col: Column }) {
  const text = cellText(cell, col)
  const rich = cell !== null && typeof cell === 'object' ? cell : null
  if (col.type === 'status' && cellValue(cell) !== null) {
    return (
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[rich?.tone ?? 'pending']}`}>{text}</span>
    )
  }
  return (
    <>
      {text}
      {rich?.tag && (
        <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[rich.tone ?? 'pending']}`}>
          {rich.tag}
        </span>
      )}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'kpis':
      return (
        <div className="space-y-2">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
            {block.items.map((k) => (
              <div key={k.label} className="rounded-xl border border-line px-3 py-2 print:break-inside-avoid">
                <dt className="text-[12px] text-muted">{k.label}</dt>
                <dd className="font-mono text-[18px] tabular-nums text-ink">
                  {k.value}
                  {k.unit && <span className="ml-1 text-[12px] text-faint">{k.unit}</span>}
                  {typeof k.delta === 'number' && (
                    <span className="block font-mono text-[11px] text-faint">{deltaText(k.delta)}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {block.compareLabel && <p className="text-[12px] text-faint">Changes are against {block.compareLabel}.</p>}
        </div>
      )
    case 'heading':
      return block.level === 2 ? <h3 className="text-ink">{block.text}</h3> : <h4 className="text-ink">{block.text}</h4>
    case 'paragraph':
      return <p className="text-[13px] leading-relaxed text-muted">{block.text}</p>
    case 'note':
      return (
        <p
          className={`rounded-lg px-3 py-2 text-[13px] ${
            block.tone === 'warning' ? TONE_CELL.warning : 'surface-sunken text-muted'
          }`}
        >
          {block.text}
        </p>
      )
    case 'chart':
      return (
        <figure className="space-y-2 print:break-inside-avoid">
          <figcaption className="text-[13px] font-medium text-ink">{block.title}</figcaption>
          {block.chart.kind === 'weekBars' ? (
            <WeekBars rows={block.chart.rows} title={block.title} />
          ) : (
            <Bars rows={block.chart.rows} max={block.chart.max} unit={block.chart.unit} title={block.title} />
          )}
          <p className="sr-only">{block.summary}</p>
        </figure>
      )
    case 'table': {
      const shown = block.cap ? block.rows.slice(0, block.cap) : block.rows
      return (
        <section className="space-y-2">
          <h4 className="text-ink">{block.title}</h4>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[520px] text-[12px] print:min-w-0">
              <thead>
                <tr className="border-b border-line-strong text-left text-faint">
                  {block.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`px-2 py-1.5 font-medium ${RIGHT.includes(c.type) ? 'text-right' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, r) => (
                  <tr key={r} className="border-b border-line last:border-0 print:break-inside-avoid">
                    {block.columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 align-top ${
                          RIGHT.includes(c.type) ? 'text-right font-mono tabular-nums text-ink' : 'text-ink'
                        }`}
                      >
                        <CellView cell={row[i] ?? null} col={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.cap && block.rows.length > block.cap && (
            <p className="text-[12px] text-faint">
              Showing {block.cap} of {block.rows.length}. Excel and CSV include every row.
            </p>
          )}
          {block.note && <p className="text-[12px] text-faint">{block.note}</p>}
        </section>
      )
    }
  }
}

/** A report document on the A4 sheet: letterhead, blocks, footer and signatures. */
export function ReportDocView({ doc }: { doc: ReportDoc }) {
  const h = doc.header
  return (
    <Sheet
      title={h.title}
      subject={h.subtitle}
      meta={[h.classLine, h.rangeLabel ?? '']}
      generatedAt={h.madeAt}
      footerNote={
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[62ch] space-y-1 text-[12px] leading-relaxed text-faint">
            {doc.footer.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-8">
            {doc.footer.signatures.map((s) => (
              <div key={s.role} className="min-w-[200px] text-center">
                <p className="h-6 text-[13px] text-ink">{s.name ?? ''}</p>
                <p className="border-t border-line-strong pt-1 text-[11px] text-faint">{s.role}</p>
              </div>
            ))}
          </div>
        </div>
      }
    >
      {h.confidential && (
        <p className={`rounded-lg px-3 py-2 text-[12px] font-medium ${TONE_CELL.warning}`}>{h.confidential}</p>
      )}
      {doc.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </Sheet>
  )
}
