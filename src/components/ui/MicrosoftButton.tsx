import { MicrosoftMark, Spinner } from './Icon'

export function MicrosoftButton({
  onClick,
  loading,
  label = 'Continue with Microsoft',
}: {
  onClick: () => void
  loading?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="surface flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--line-strong)] text-[14px] font-medium text-ink transition-[background-color,scale] duration-(--dur-press) hover:bg-[var(--surface-sunken)] active:scale-[0.99] disabled:opacity-60"
    >
      {loading ? <Spinner size={17} /> : <MicrosoftMark size={18} />}
      {label}
    </button>
  )
}
