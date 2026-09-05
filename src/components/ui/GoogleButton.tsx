import { GoogleMark, Spinner } from './Icon'

export function GoogleButton({
  onClick,
  loading,
  label = 'Continue with Google',
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
      className="surface flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--line-strong)] text-[14.5px] font-medium text-ink transition-[background-color,scale] duration-200 hover:bg-[var(--surface-sunken)] active:scale-[0.99] disabled:opacity-60"
    >
      {loading ? <Spinner size={17} /> : <GoogleMark size={18} />}
      {label}
    </button>
  )
}
