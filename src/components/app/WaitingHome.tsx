import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { Reveal } from '../motion/Reveal'
import { buttonClass } from '../ui/buttonClass'
import { paths } from '../../lib/paths'

/**
 * What a member sees until somebody gives them something to do: no role
 * switches, no class, no project. Home would otherwise be a dashboard of
 * zeroes, so it says plainly why it is empty and where an invitation lands.
 */
export function WaitingHome() {
  return (
    <div className="shell !px-0">
      <Reveal>
        <section className="relative overflow-hidden rounded-panel border border-banner-ink/10 banner-fill px-5 py-9 text-banner-ink sm:px-8 sm:py-12 lg:px-10 lg:py-16">
          <div
            aria-hidden
            className="banner-deco pointer-events-none absolute -top-56 -right-40 h-[460px] w-[460px] rounded-full blur-[120px]"
            style={{
              background:
                'radial-gradient(circle, color-mix(in oklab, var(--banner-glow) 18%, transparent) 0%, color-mix(in oklab, var(--banner-glow) 5%, transparent) 45%, transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="banner-deco pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px)',
              backgroundSize: '54px 54px',
              maskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
            }}
          />

          <div className="relative max-w-2xl">
            <p className="flex items-center gap-3">
              <span className="h-px w-7 shrink-0 bg-banner-glow" />
              <span className="font-mono text-[12px] tracking-[0.22em] text-banner-accent-soft/75 uppercase">
                Member
              </span>
            </p>
            <h1 className="mt-5 font-display leading-tight text-banner-ink">You're in</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-banner-ink/60">
              Nothing to open yet. A project manager can invite you to a project, or an admin can
              give you a role. Invitations show up in your Inbox.
            </p>
            <Link
              to={paths.inbox}
              className={`${buttonClass({ variant: 'accent', size: 'md' })} mt-7`}
            >
              <Icon name="mail" size={16} />
              Open your Inbox
            </Link>
          </div>
        </section>
      </Reveal>
    </div>
  )
}
