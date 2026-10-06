import { Select } from '../ui/Select'

/** Which tasks Tasks is showing: the running sprint, all, the backlog, or one sprint. */
export function ScopePicker({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
      <span className="shrink-0">Showing</span>
      <span className="min-w-0 flex-1 sm:flex-none">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={options}
          aria-label="Which tasks to show"
          className="!h-9 min-w-[12rem] !text-[13px]"
        />
      </span>
    </label>
  )
}
