import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Logo } from './brand/Logo'
import { ThemeToggle } from './ThemeToggle'
import { Icon } from './ui/Icon'

type Props = {
  /** The mono label above the heading. */
  kicker?: string
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
  variant?: 'default' | 'login' | 'register'
  compact?: boolean
}

/**
 * The frame the three auth pages share.
 *
 * Rebuilt to match the landing page, and it keeps that page's rhythm rather
 * than copying its surface: a near-black brand panel against a paper form
 * panel, which is the same dark-then-light alternation the landing runs down
 * its length. The form stays light on purpose — it is the one screen here
 * somebody has to read carefully and type into, and dark forms cost legibility
 * for atmosphere.
 *
 * The brand panel carries the landing's signatures so arriving here does not
 * feel like leaving the product: the amber bleed, the blueprint rule, the
 * orbit, the mono kicker with its leading rule, and the underline that draws
 * itself under the words the sentence turns on.
 */
export function AuthLayout({
  kicker,
  title,
  subtitle,
  children,
  footer,
  variant = 'default',
  compact = false,
}: Props) {
  const reduce = useReducedMotion()
  const still = !!reduce
  const mirrored = variant === 'register'
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  const animateSwap = !still && desktop && variant !== 'default'
  const panelTransition = { duration: 0.72, ease: [0.22, 1, 0.36, 1] as const }
  const brandStart = mirrored ? 'translateX(-117.4%)' : 'translateX(117.4%)'
  const formStart = mirrored ? 'translateX(85.2%)' : 'translateX(-85.2%)'

  return (
    <div
      className={`surface grid min-h-dvh overflow-x-hidden lg:h-dvh lg:min-h-0 lg:overflow-hidden ${
        mirrored
          ? 'lg:grid-cols-[minmax(0,54fr)_minmax(0,46fr)]'
          : 'lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]'
      }`}
    >
      <a href="#main-content" className="skip-link">
        Skip to the form
      </a>

      {/* --------------------------------------------------------- brand */}
      {/* On phones this shrinks to a band so the form stays above the fold. */}
      <motion.aside
        initial={animateSwap ? { transform: brandStart } : false}
        animate={{ transform: 'translateX(0%)' }}
        transition={panelTransition}
        className={`relative z-20 overflow-hidden bg-navy-950 text-amber-50 lg:h-dvh ${
          mirrored ? 'lg:order-2' : ''
        }`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-64 -left-56 h-[620px] w-[620px] rounded-full blur-[130px]"
          style={{
            background:
              'radial-gradient(circle, rgb(240 180 41 / 0.20) 0%, rgb(240 180 41 / 0.06) 45%, transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
            backgroundSize: '54px 54px',
            maskImage: 'radial-gradient(ellipse at 40% 35%, #000, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 40% 35%, #000, transparent 72%)',
          }}
        />

        {/* The orbit, from the landing hero. Desktop only — at phone height the
            band is too short for it to read as anything but a stray curve. */}
        <svg
          aria-hidden
          viewBox="0 0 520 620"
          className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <ellipse cx="260" cy="330" rx="250" ry="240" className="stroke-amber-50/10" />
          <ellipse
            cx="260"
            cy="330"
            rx="196"
            ry="186"
            className="stroke-amber-50/8"
            strokeDasharray="4 7"
          />
          <ellipse
            cx="260"
            cy="330"
            rx="250"
            ry="240"
            className="stroke-amber-400"
            strokeWidth="1.6"
            strokeDasharray="70 1450"
            style={still ? undefined : { animation: 'collabify-orbit 18s linear infinite' }}
          />
        </svg>

        <div className="relative flex h-full flex-col justify-between p-6 md:p-10 lg:p-12">
          <Link to="/" className="inline-flex w-fit" aria-label="Back to Collabify home">
            <Logo tone="onDark" subtitle="Project workspace" />
          </Link>

          <div className="hidden lg:block">
            <p className="flex items-center gap-3">
              <span className="h-px w-7 bg-amber-400" />
              <span className="font-mono text-[10.5px] tracking-[0.22em] text-amber-200/80 uppercase">
                Dr. Yanga's Colleges · BSIT
              </span>
            </p>

            <h2 className="mt-7 max-w-[13ch] font-display text-[clamp(2rem,3.1vw,2.9rem)] leading-[1.02] font-bold tracking-[-0.04em]">
              Where BSIT programs{' '}
              <span className="relative inline-block">
                <span className="text-amber-400">run the term.</span>
                <svg
                  aria-hidden
                  viewBox="0 0 300 14"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-2.5 w-full overflow-visible"
                  fill="none"
                >
                  <path
                    d="M3 9c58-7 176-8 294-3"
                    className="stroke-amber-400"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray="320"
                    strokeDashoffset={still ? 0 : 320}
                    style={
                      still
                        ? undefined
                        : { animation: 'collabify-draw 1.4s .4s var(--ease-out-soft) forwards' }
                    }
                  />
                </svg>
              </span>
            </h2>

            <p className="mt-8 max-w-[38ch] text-[15.5px] leading-[1.8] text-amber-50/60">
              Projects, boards and deadlines for classes at Dr. Yanga's Colleges. Six steps, each
              blocked by the one before it.
            </p>

            <div className="mt-10 flex gap-9 border-t border-amber-50/12 pt-6 font-mono text-[10.5px] tracking-[0.16em] text-amber-50/45 uppercase">
              <span>6 steps</span>
              <span>3 roles</span>
              <span>1 board per group</span>
            </div>
          </div>

          <p className="hidden font-mono text-[10px] tracking-[0.14em] text-amber-50/25 uppercase lg:block">
            © {new Date().getFullYear()} Collabify · Dr. Yanga's Colleges
          </p>
        </div>
      </motion.aside>

      {/* ---------------------------------------------------------- form */}
      <motion.main
        id="main-content"
        tabIndex={-1}
        initial={animateSwap ? { transform: formStart, opacity: 0.82 } : false}
        animate={{ transform: 'translateX(0%)', opacity: 1 }}
        transition={panelTransition}
        className={`surface relative z-10 flex min-h-0 flex-col outline-none lg:h-dvh ${
          mirrored ? 'lg:order-1' : ''
        }`}
      >
        <div className="flex items-center justify-between p-4 md:p-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13.5px] text-muted transition-colors duration-200 hover:text-ink"
          >
            <Icon name="arrowLeft" size={16} />
            Back to site
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex min-h-0 flex-1 overflow-y-auto px-5 md:px-8">
          <div
            className={`mx-auto my-auto w-full max-w-[430px] ${
              compact ? 'py-4 lg:py-0' : 'py-8 lg:py-10'
            }`}
          >
            {kicker && (
              <p className="flex items-center gap-3">
                <span className="h-px w-7 bg-amber-400" />
                <span className="font-mono text-[10.5px] tracking-[0.22em] text-faint uppercase">
                  {kicker}
                </span>
              </p>
            )}
            <h1
              className={`${compact ? 'mt-3' : 'mt-5'} font-display text-[clamp(1.9rem,3vw,2.4rem)] leading-[1.05] font-bold tracking-[-0.035em]`}
            >
              {title}
            </h1>
            <p className={`${compact ? 'mt-2' : 'mt-3'} text-[15px] leading-relaxed text-muted`}>
              {subtitle}
            </p>
            <div className={compact ? 'mt-6' : 'mt-9'}>{children}</div>
            {footer && (
              <div className={`${compact ? 'mt-3' : 'mt-8'} text-center text-[14px] text-muted`}>
                {footer}
              </div>
            )}
          </div>
        </div>
      </motion.main>
    </div>
  )
}

export function OrDivider({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${compact ? 'my-4' : 'my-5'} flex items-center gap-4`}>
      <span className="h-px flex-1 bg-[var(--line)]" />
      <span className="font-mono text-[10px] tracking-[0.2em] text-faint uppercase">or</span>
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}
