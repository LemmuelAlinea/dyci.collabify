import type { ReactNode } from 'react'
import logo from '../../assets/dyci-logo.png'
import { DEPARTMENT, NO_MARKS_NOTE, SCHOOL, generatedOn } from '../../lib/report'

/**
 * The paper. Everything printable in the product is wrapped in one of these, so
 * a report looks the same whichever one it is.
 *
 * The letterhead is the only place Collabify speaks for a school, which is why
 * the name lives in a single constant rather than being typed into seven files.
 * Under the last line sits the note that this is not a grade record — a
 * completion percentage on school letterhead would otherwise be read as one.
 */
export function Sheet({
  title,
  subject,
  meta,
  professor,
  children,
  footnote,
  signatureLabel = 'Signature over printed name',
}: {
  title: string
  /** What the report is about: the class, the group, the student. */
  subject: string
  /** Short facts under the subject — term, section, dates. */
  meta?: string[]
  professor: string
  children: ReactNode
  /** An extra line above the standing note, when the report needs one. */
  footnote?: string
  /** What the name under the rule means. A student prepares; a professor attests. */
  signatureLabel?: string
}) {
  return (
    <article className="sheet card p-4 sm:p-5 sm:p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex items-start gap-4 border-b border-line-strong pb-4">
        <img src={logo} alt="" className="h-14 w-14 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[17px] leading-tight font-semibold text-ink">{SCHOOL}</p>
          <p className="text-[12px] leading-snug text-muted">{DEPARTMENT}</p>
        </div>
        <p className="shrink-0 text-right font-mono text-[12px] leading-relaxed text-faint">
          Generated
          <br />
          {generatedOn()}
        </p>
      </header>

      <div className="mt-5">
        <p className="eyebrow text-faint">{title}</p>
        <h2 className="mt-1 font-display leading-tight text-ink">{subject}</h2>
        {meta && meta.length > 0 && (
          <p className="mt-1.5 text-[12px] text-muted">{meta.filter(Boolean).join(' · ')}</p>
        )}
      </div>

      <div className="mt-5 space-y-5">{children}</div>

      <footer className="mt-8 border-t border-line pt-4">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <p className="max-w-[62ch] text-[12px] leading-relaxed text-faint">
            {footnote && (
              <>
                {footnote}
                <br />
              </>
            )}
            {NO_MARKS_NOTE}
          </p>
          <div className="min-w-[220px]">
            <div className="h-8 border-b border-line-strong" />
            <p className="mt-1 text-[12px] text-muted">{professor}</p>
            <p className="text-[12px] text-faint">{signatureLabel}</p>
          </div>
        </div>
      </footer>
    </article>
  )
}

/** A run of figures at the top of a sheet — the numbers somebody scans first. */
export function Figures({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k} className="border-l-2 border-line pl-3">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="font-mono text-[15.5px] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The bordered table every report prints its rows in. */
export function ReportTable({
  headers,
  rows,
  align,
  empty = 'Nothing to list.',
}: {
  headers: string[]
  rows: ReactNode[][]
  /** Right-align the columns whose index is in here — the numeric ones. */
  align?: number[]
  empty?: string
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-muted">{empty}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                // Indexed, because a two-column label table heads both with ''.
                key={i}
                className={`border-b border-line-strong pb-1.5 font-medium text-muted ${
                  align?.includes(i) ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`border-b border-line py-1.5 pr-3 text-ink ${
                    align?.includes(j) ? 'text-right font-mono' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A heading inside a sheet. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className=" font-semibold tracking-wide text-ink uppercase">{title}</h3>
      {children}
    </section>
  )
}
