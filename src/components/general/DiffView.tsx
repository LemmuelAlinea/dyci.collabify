import { collapseUnchanged, describeDiff, diffLines, diffStat, isGap } from '../../lib/general/diff'

/**
 * What a change would do, line by line.
 *
 * A reviewer is being asked to put somebody else's words into the project's
 * document, so the one thing this must never do is hide a line. Long untouched
 * stretches collapse to a marked gap rather than disappearing.
 */
export function DiffView({
  before,
  after,
  caption = 'What this change does, line by line',
}: {
  before: string
  after: string
  /** The table's accessible name. History reads in the past tense; a proposal does not. */
  caption?: string
}) {
  const lines = diffLines(before, after)
  const stat = diffStat(lines)
  const rows = collapseUnchanged(lines)

  if (stat.added === 0 && stat.removed === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        This change leaves everything exactly as it is.
      </p>
    )
  }

  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] text-faint">{describeDiff(stat)}</p>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full border-collapse font-mono text-[12px]">
          <caption className="sr-only">{caption}</caption>
          <tbody>
            {rows.map((row, i) => {
              if (isGap(row)) {
                return (
                  <tr key={`gap-${i}`} className="surface-sunken">
                    <td colSpan={3} className="px-3 py-1 text-center text-[11px] text-faint">
                      {row.gap} unchanged {row.gap === 1 ? 'line' : 'lines'}
                    </td>
                  </tr>
                )
              }
              const tone =
                row.kind === 'added'
                  ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  : row.kind === 'removed'
                    ? 'bg-red-500/10 text-red-800 dark:text-red-200'
                    : ''
              return (
                <tr key={`${row.kind}-${i}`} className={tone}>
                  <td className="w-10 select-none border-r border-line px-2 py-0.5 text-right text-faint">
                    {row.oldLine ?? ''}
                  </td>
                  <td className="w-10 select-none border-r border-line px-2 py-0.5 text-right text-faint">
                    {row.newLine ?? ''}
                  </td>
                  <td className="px-3 py-0.5 whitespace-pre-wrap break-words">
                    <span className="select-none text-faint">
                      {row.kind === 'added' ? '+ ' : row.kind === 'removed' ? '- ' : '  '}
                    </span>
                    {row.text || ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
