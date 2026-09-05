import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from '../../components/motion/Reveal'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { ButtonLink } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'

export type Upcoming = { icon: IconName; title: string; body: string }

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function RoleHome({
  headline,
  intro,
  upcoming,
}: {
  headline: string
  intro: string
  upcoming: Upcoming[]
}) {
  const { profile } = useAuth()

  useEffect(() => {
    document.title = `${headline} · Collabify`
  }, [headline])

  if (!profile) return null

  return (
    <div className="w-full">
      {/* The masthead, matching the one the student and professor dashboards
          use. This role's home has no figures to put in it, so the greeting and
          the intro carry the band on their own. */}
      <Reveal once>
        <section className="relative overflow-hidden rounded-panel border border-amber-50/10 bg-navy-950 px-5 py-7 text-amber-50 sm:px-7 sm:py-8 lg:px-9 lg:py-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-56 -right-40 h-[460px] w-[460px] rounded-full blur-[120px]"
            style={{
              background:
                'radial-gradient(circle, rgb(240 180 41 / 0.18) 0%, rgb(240 180 41 / 0.05) 45%, transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
              backgroundSize: '54px 54px',
              maskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
            }}
          />
          <div className="relative">
            <p className="flex items-center gap-3">
              <span className="h-px w-7 bg-amber-400" />
              <span className="font-mono text-[12px] tracking-[0.22em] text-amber-200/75 uppercase">
                Program
              </span>
            </p>
            <h1 className="mt-5 font-display leading-tight text-amber-50">
              {greeting()}, {profile.first_name}.
            </h1>
            <p className="mt-3 max-w-[620px] text-[14px] leading-relaxed text-amber-50/60">
              {intro}
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal once delay={0.08} className="mt-8">
        <div className="relative overflow-hidden rounded-panel border border-line bg-[var(--surface-sunken)] p-4 text-ink sm:p-7 md:p-9">
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-[560px]">
              <h2>{headline}</h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
                Your account, appearance, notifications, and security are live today. The
                boards and milestones below arrive in the next release.
              </p>
            </div>
            <ButtonLink to="/settings" variant="accent" size="md" className="shrink-0">
              Open settings
              <Icon name="arrowRight" size={17} />
            </ButtonLink>
          </div>
        </div>
      </Reveal>

      <div className="mt-10">
        <Reveal once className="flex items-baseline justify-between gap-4">
          <h2>Landing in the next release</h2>
          <span className="font-mono text-[12px] tracking-wider text-faint uppercase">
            Phase 2
          </span>
        </Reveal>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((u, i) => (
            <Reveal
              key={u.title}
              once
              delay={(i % 3) * 0.07}
              as="article"
              className="card p-4 sm:p-6 shadow-card"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--surface-sunken)] text-muted">
                <Icon name={u.icon} size={20} />
              </span>
              <h3 className="mt-4">{u.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{u.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      <Reveal once className="mt-10 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Icon name="info" size={16} className="text-faint" />
        Something not working the way you expect?{' '}
        <Link to="/settings" className="font-medium text-ink hover:underline">
          Check your account settings
        </Link>
      </Reveal>
    </div>
  )
}
