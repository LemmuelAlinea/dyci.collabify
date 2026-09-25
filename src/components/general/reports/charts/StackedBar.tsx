export type Stack = { label: string; value: number; tone: 'done' | 'progress' | 'late' | 'todo' }

const TONE: Record<Stack['tone'], string> = {
  done: 'bg-emerald-500',
  progress: 'bg-amber-400',
  late: 'bg-red-500',
  todo: 'bg-[var(--line-strong)]',
}

/**
 * One horizontal bar split into parts, scaled to `max` so rows compare. The
 * counts are written out in the accessible name and the table beside it; the
 * bar only shows proportion.
 */
export function StackedBar({ parts, max }: { parts: Stack[]; max: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const label = parts.map((p) => `${p.value} ${p.label}`).join(', ')
  return (
    <span role="img" aria-label={label || 'Nothing yet'} className="flex h-2 w-full min-w-[6rem] overflow-hidden rounded-full surface-sunken">
      {total > 0 &&
        parts.map((p) =>
          p.value > 0 ? (
            <span key={p.label} className={`h-full ${TONE[p.tone]}`} style={{ width: `${(p.value / Math.max(max, 1)) * 100}%` }} />
          ) : null,
        )}
    </span>
  )
}
