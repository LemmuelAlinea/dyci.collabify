type Props = {
  size?: number
  /** 'auto' inherits the surrounding text color; 'brand' always paints navy + amber. */
  tone?: 'auto' | 'brand' | 'onDark'
}

/**
 * Three stacked bars of unequal length — a burndown read as a monogram.
 * The amber bar is the one in progress.
 */
export function LogoMark({ size = 32, tone = 'brand' }: Props) {
  const plate =
    tone === 'brand' ? '#26327A' : tone === 'onDark' ? 'rgba(255,255,255,0.12)' : 'currentColor'
  const bar = tone === 'auto' ? 'currentColor' : '#FFFFFF'

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill={plate} />
      <rect x="7" y="8" width="6.5" height="16" rx="2.4" fill="#F0B429" />
      <rect x="16.5" y="8" width="6.5" height="10" rx="2.4" fill={bar} opacity="0.95" />
      <circle cx="19.75" cy="22.25" r="2.6" fill={bar} opacity="0.5" />
    </svg>
  )
}

export function Logo({
  size = 34,
  tone = 'brand',
  subtitle = 'Project workspace',
  showSubtitle = true,
}: Props & { subtitle?: string; showSubtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} tone={tone} />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[19px] font-extrabold tracking-[-0.04em]">
          Collabify
        </span>
        {showSubtitle && (
          <span className="eyebrow mt-1 text-[9.5px] opacity-60">{subtitle}</span>
        )}
      </span>
    </span>
  )
}
