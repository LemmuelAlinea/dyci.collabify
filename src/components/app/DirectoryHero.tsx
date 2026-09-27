import type { ReactNode } from 'react'

/**
 * A page's banner: its name and what it is for. No figures — the counts a
 * page needs are in the page itself, and only Home carries a summary row.
 */
export function DirectoryHero({
  title,
  accent,
  description,
  action,
}: {
  title: string
  accent: string
  description: string
  action?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-panel border border-banner-ink/10 banner-fill px-4 py-5 text-banner-ink sm:px-7 sm:py-8 lg:px-9 lg:py-9">
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

      <div className="relative grid gap-5 sm:gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-[720px]">
          <h1 className="font-display text-banner-ink">
            {title} <span className="text-banner-accent">{accent}</span>
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-banner-ink/60">
            {description}
          </p>
        </div>
        {action && <div className="directory-hero__action lg:pb-1">{action}</div>}
      </div>
    </section>
  )
}
