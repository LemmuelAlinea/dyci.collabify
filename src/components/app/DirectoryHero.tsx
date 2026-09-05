import type { ReactNode } from 'react'

type HeroStat = {
  value: string | number
  label: string
}

export function DirectoryHero({
  title,
  accent,
  description,
  action,
  stats,
  statsVariant = 'default',
}: {
  title: string
  accent: string
  description: string
  action?: ReactNode
  stats: HeroStat[]
  statsVariant?: 'default' | 'compact-row'
}) {
  return (
    <section className="relative overflow-hidden rounded-panel border border-amber-50/10 bg-navy-950 px-5 py-7 text-amber-50 sm:px-7 sm:py-8 lg:px-9 lg:py-9">
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

      <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-[720px]">
          <h1 className="font-display text-amber-50">
            {title} <span className="text-amber-300">{accent}</span>
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-amber-50/60">
            {description}
          </p>
        </div>
        {action && <div className="lg:pb-1">{action}</div>}
      </div>

      <dl
        className={`relative mt-7 grid gap-px overflow-hidden rounded-xl border border-amber-50/12 bg-amber-50/12 ${
          statsVariant === 'compact-row'
            ? 'w-full grid-cols-4 sm:w-fit'
            : 'grid-cols-2 sm:w-fit sm:min-w-[360px]'
        }`}
      >
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`min-w-0 bg-navy-950/80 ${
              statsVariant === 'compact-row'
                ? 'px-2 py-2.5 sm:min-w-[120px] sm:px-3'
                : 'px-4 py-3.5 sm:min-w-[180px]'
            }`}
          >
            <dt
              className={`truncate text-amber-50/50 ${
                statsVariant === 'compact-row' ? 'text-[10px] sm:text-[11px]' : 'text-[12px]'
              }`}
            >
              {stat.label}
            </dt>
            <dd
              className={`mt-1 font-mono font-bold tabular-nums text-amber-50 ${
                statsVariant === 'compact-row' ? 'text-[17px] sm:text-[19px]' : 'text-[22px]'
              }`}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
