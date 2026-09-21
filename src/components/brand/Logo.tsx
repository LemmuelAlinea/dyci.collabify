type Props = {
  size?: number
  tone?: 'auto' | 'brand' | 'onDark'
}

export function LogoMark({ size = 32, tone = 'brand' }: Props) {
  const box = { width: size, height: size }
  if (tone === 'onDark') {
    return (
      <img
        src="/collabify-logo-dark.png"
        alt=""
        aria-hidden="true"
        className="shrink-0 object-contain"
        style={box}
      />
    )
  }

  return (
    <span className="relative shrink-0" style={box} aria-hidden="true">
      <img
        src="/collabify-logo-light.png"
        alt=""
        className="absolute inset-0 h-full w-full object-contain dark:hidden"
      />
      <img
        src="/collabify-logo-dark.png"
        alt=""
        className="absolute inset-0 hidden h-full w-full object-contain dark:block"
      />
    </span>
  )
}

export function Logo({
  size = 34,
  tone = 'brand',
  subtitle = 'Project workspace',
  showSubtitle = true,
}: Props & { subtitle?: string; showSubtitle?: boolean }) {
  const word =
    tone === 'onDark' ? 'text-white' : tone === 'brand' ? 'text-navy-600 dark:text-white' : ''
  const sub = tone === 'onDark' ? 'text-white/60' : 'text-muted'

  return (
    <span className="flex items-center gap-3">
      <LogoMark size={Math.round(size * 1.85)} tone={tone} />
      <span className="flex flex-col leading-none">
        <span className={`font-display text-[19px] font-extrabold tracking-[-0.04em] ${word}`}>
          Collabify
        </span>
        {showSubtitle && <span className={`eyebrow mt-1 text-[12px] ${sub}`}>{subtitle}</span>}
      </span>
    </span>
  )
}
