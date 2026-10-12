/**
 * A trend at the size of a word. A null value is a gap in the line, not a
 * zero: "nothing was finished that week" and "it was 0%" are different facts.
 */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const W = 96
  const H = 24
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) {
    return (
      <span className="font-mono text-[11px] text-faint" aria-label={label}>
        no data
      </span>
    )
  }
  const max = Math.max(...nums)
  const min = Math.min(...nums, 0)
  const span = max - min || 1
  const x = (i: number) => (values.length === 1 ? W / 2 : 2 + (i / (values.length - 1)) * (W - 4))
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6)
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
    pen = true
  })
  let lastIdx = values.length - 1
  while (values[lastIdx] === null) lastIdx--
  const last = values[lastIdx] as number

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24 shrink-0" role="img" aria-label={label}>
      <path
        d={d}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-navy-600 dark:stroke-navy-300"
      />
      <circle cx={x(lastIdx)} cy={y(last)} r="2.25" className="fill-navy-600 dark:fill-navy-300" />
    </svg>
  )
}
