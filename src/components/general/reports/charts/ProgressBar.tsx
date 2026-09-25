/** A thin bar for a share, with the figure beside it. The figure is the content; the bar is a glance. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className="flex min-w-[7rem] items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full surface-sunken" aria-hidden>
        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">
        {label ?? `${pct}%`}
      </span>
    </span>
  )
}
