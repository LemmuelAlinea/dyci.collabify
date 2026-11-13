import type { CSSProperties, ReactNode } from 'react'

/**
 * A page's banner: its name and what it is for. No figures — the counts a
 * page needs are in the page itself, and only Home carries a summary row.
 */
export function DirectoryHero({
  title,
  accent,
  description,
  action,
  corner,
  mark,
  accentClass = 'text-banner-accent',
  accentStyle,
  accentWeight,
  compact = false,
}: {
  title: string
  accent: string
  description: string
  action?: ReactNode
  /** A small control pinned to the top right, such as a view switch. */
  corner?: ReactNode
  /** Sits before the title, such as a project's mark. */
  mark?: ReactNode
  /** The accent word's color, when the page sets its own instead of the person's banner accent. */
  accentClass?: string
  /** A project's own color for the accent word, which no class can name. */
  accentStyle?: CSSProperties
  /** The accent word's weight, when it should differ from the title's, such as `font-medium`. */
  accentWeight?: string
  /** A thin banner, for a working page whose content should start high. */
  compact?: boolean
}) {
  const accentWord = (
    <span className={[accentStyle ? undefined : accentClass, accentWeight].filter(Boolean).join(' ') || undefined} style={accentStyle}>
      {accent}
    </span>
  )
  return (
    <section
      className={`relative overflow-hidden rounded-panel border border-banner-ink/10 banner-fill text-banner-ink ${
        compact ? 'px-4 py-4 sm:px-6 sm:py-5' : 'px-4 py-5 sm:px-7 sm:py-8 lg:px-9 lg:py-9'
      }`}
    >
      <div
        aria-hidden
        className="banner-deco pointer-events-none absolute -top-52 -right-36 h-[430px] w-[430px] rounded-full blur-[110px]"
        style={{ background: 'color-mix(in oklab, var(--banner-glow) 16%, transparent)' }}
      />
      <div
        aria-hidden
        className="banner-deco pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          maskImage: 'linear-gradient(90deg, #000 20%, transparent 92%)',
          WebkitMaskImage: 'linear-gradient(90deg, #000 20%, transparent 92%)',
        }}
      />

      <div
        className={`relative grid lg:grid-cols-[minmax(0,1fr)_auto] ${
          compact ? 'gap-3 lg:items-center' : 'gap-5 sm:gap-7 lg:items-end'
        }`}
      >
        <div className={`max-w-[720px] ${corner ? 'pr-10' : ''}`}>
          <h1 className={`font-display text-banner-ink ${mark ? 'flex items-center gap-3' : ''}`}>
            {mark ? (
              <>
                {mark}
                <span className="min-w-0 break-words">
                  {title} {accentWord}
                </span>
              </>
            ) : (
              <>
                {title} {accentWord}
              </>
            )}
          </h1>
          <p
            className={`max-w-[62ch] leading-relaxed text-banner-muted ${
              compact ? 'mt-1 text-[13px]' : 'mt-3 text-[14px]'
            }`}
          >
            {description}
          </p>
        </div>
        {action && <div className="directory-hero__action lg:pb-1">{action}</div>}
      </div>
      {corner && <div className="absolute top-4 right-4 sm:top-6 sm:right-6">{corner}</div>}
    </section>
  )
}
