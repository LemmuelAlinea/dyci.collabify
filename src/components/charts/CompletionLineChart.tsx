import { useId } from 'react'
import type { CompletionWeek } from '../../lib/general/projectProgress'
import { shortDay } from './format'

export function CompletionLineChart({ weeks, selectedLabel }: { weeks: CompletionWeek[]; selectedLabel: string }) {
  const uid = useId()
  if (!weeks.length) return null
  const step = Math.max(1, Math.ceil(Math.max(...weeks.flatMap(w => [w.project, w.selected])) / 4))
  const max = step * 4
  const x = (i: number) => 40 + i * 580 / Math.max(1, weeks.length - 1)
  const y = (count: number) => 180 - count / max * 155
  const line = (key: 'project' | 'selected') => weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w[key])}`).join(' ')
  return (
    <figure className="min-w-0">
      <p className="mb-2 text-[12px] text-muted">Tasks completed that week</p>
      <svg viewBox="0 0 660 215" className="h-auto w-full" role="img" aria-labelledby={`${uid}t ${uid}d`}>
        <title id={`${uid}t`}>Weekly completed tasks</title>
        <desc id={`${uid}d`}>Project and {selectedLabel}, over {weeks.length} weeks. Weekly counts follow in a table.</desc>
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line x1="40" x2="620" y1={y(i * step)} y2={y(i * step)} className="stroke-[var(--line)]" />
            <text x="32" y={y(i * step) + 4} textAnchor="end" className="fill-[var(--ink-faint)] font-mono text-[11px]">{i * step}</text>
          </g>
        ))}
        {weeks.map((w, i) => i % 2 === 0 || i === weeks.length - 1 ? (
          <text key={w.week} x={x(i)} y="205" textAnchor="middle" className="fill-[var(--ink-faint)] font-mono text-[10px]">{shortDay(w.week)}</text>
        ) : null)}
        <path d={line('project')} fill="none" strokeWidth="2.5" className="stroke-navy-600 dark:stroke-navy-300" />
        <path d={line('selected')} fill="none" strokeWidth="2.5" strokeDasharray="5 4" className="stroke-[var(--ink-muted)]" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-muted">
        <span className="flex items-center gap-2"><span aria-hidden className="w-6 border-t-2 border-navy-600 dark:border-navy-300" />Project</span>
        <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="w-6 shrink-0 border-t-2 border-dashed border-current" />{selectedLabel}</span>
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>Tasks completed each week</caption>
          <thead><tr><th scope="col">Week starting (Asia/Manila)</th><th scope="col">Project</th><th scope="col">{selectedLabel}</th></tr></thead>
          <tbody>{weeks.map(w => <tr key={w.week}><th scope="row">{w.week}</th><td>{w.project}</td><td>{w.selected}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  )
}
