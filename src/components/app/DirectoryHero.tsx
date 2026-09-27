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
    <section className="relative overflow-hidden rounded-panel border border-amber-50/10 bg-navy-950 px-4 py-5 text-amber-50 sm:px-7 sm:py-8 lg:px-9 lg:py-9">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-52 -right-36 h-[430px] w-[430px] rounded-full blur-[110px]"
        style={{ background: 'rgb(240 180 41 / 0.16)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          maskImage: 'linear-gradient(90deg, #000 20%, transparent 92%)',
          WebkitMaskImage: 'linear-gradient(90deg, #000 20%, transparent 92%)',
        }}
      />

      <div className="relative grid gap-5 sm:gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-[720px]">
          <h1 className="font-display text-amber-50">
            {title} <span className="text-amber-300">{accent}</span>
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-amber-50/60">
            {description}
          </p>
        </div>
        {action && <div className="directory-hero__action lg:pb-1">{action}</div>}
      </div>
    </section>
  )
}
