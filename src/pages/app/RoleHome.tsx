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
      <Reveal once>
        <h1 className="text-[clamp(1.9rem,3.4vw,2.6rem)] leading-tight">
          {greeting()}, {profile.first_name}.
        </h1>
        <p className="mt-3 max-w-[620px] text-[16px] leading-relaxed text-muted">{intro}</p>
      </Reveal>

      <Reveal once delay={0.08} className="mt-8">
        <div className="relative overflow-hidden rounded-panel bg-navy-600 p-4 sm:p-5 sm:p-7 text-white md:p-9">
          <div aria-hidden className="blueprint absolute inset-0 opacity-60" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-[560px]">
              <h2 className="text-[22px] md:text-[26px]">{headline}</h2>
              <p className="mt-2.5 text-[15px] leading-relaxed text-white/68">
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
          <h2 className="text-[20px]">Landing in the next release</h2>
          <span className="font-mono text-[11px] tracking-wider text-faint uppercase">
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
              className="surface rounded-card border border-line p-4 sm:p-6 shadow-card"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--surface-sunken)] text-muted">
                <Icon name={u.icon} size={20} />
              </span>
              <h3 className="mt-4 text-[17px]">{u.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{u.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      <Reveal once className="mt-10 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
        <Icon name="info" size={16} className="text-faint" />
        Something not working the way you expect?{' '}
        <Link to="/settings" className="font-medium text-ink hover:underline">
          Check your account settings
        </Link>
      </Reveal>
    </div>
  )
}
