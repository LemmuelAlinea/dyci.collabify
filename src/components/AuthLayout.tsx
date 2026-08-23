import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo, LogoMark } from './brand/Logo'
import { ThemeToggle } from './ThemeToggle'
import { Icon } from './ui/Icon'

type Props = {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel. On phones it shrinks to a band so the form stays above the fold. */}
      <aside className="relative overflow-hidden bg-navy-600 text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 80% at 20% 10%, #33429B 0%, #26327A 45%, #161D4A 100%)',
          }}
        />
        <div aria-hidden className="blueprint absolute inset-0 opacity-70" />
        <div
          aria-hidden
          className="absolute -right-24 -bottom-24 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #F0B429 0%, transparent 62%)' }}
        />

        <div className="relative flex h-full flex-col justify-between p-6 md:p-10 lg:p-12">
          <Link to="/" className="inline-flex w-fit" aria-label="Back to Collabify home">
            <Logo tone="onDark" subtitle="Project workspace" />
          </Link>

          <div className="hidden lg:block">
            <LogoMark size={64} tone="onDark" />
            <h2 className="mt-8 max-w-[440px] text-[clamp(2rem,3.2vw,2.9rem)] leading-[1.04]">
              Capstone work, <span className="text-amber-400">on one board</span>.
            </h2>
            <p className="mt-5 max-w-[400px] text-[16px] leading-relaxed text-white/65">
              Plan sprints, hand off tasks, and keep your adviser in the loop — from title
              defense through final defense.
            </p>
          </div>

          <p className="hidden text-[12.5px] text-white/40 lg:block">
            © {new Date().getFullYear()} Collabify · Dr. Yanga's Colleges · BSIT program
          </p>
        </div>
      </aside>

      <main className="surface-sunken relative flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13.5px] text-muted transition-colors hover:text-ink"
          >
            <Icon name="arrowLeft" size={16} />
            Back to site
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-12 md:px-8">
          <div className="w-full max-w-[420px]">
            <h1 className="text-[clamp(1.8rem,3vw,2.3rem)] leading-tight">{title}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-7 text-center text-[14px] text-muted">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  )
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-4">
      <span className="h-px flex-1 bg-[var(--line)]" />
      <span className="eyebrow text-faint">or</span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}
