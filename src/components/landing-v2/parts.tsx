import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * Shared pieces for the combined landing page.
 *
 * The page alternates ground: a near-black hero, a paper-white feature band, a
 * navy workflow, white again for roles, then amber to close. Every piece here
 * therefore takes its colour from where it sits rather than assuming one
 * theme, which is why `tone` keeps turning up as a prop.
 */

export type Tone = 'dark' | 'light'

/** Fades and lifts on first entry. Held still under reduced motion. */
export function Rise({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (reduce) {
      setShown(true)
      return
    }
    const node = ref.current
    if (!node) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '-10% 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [reduce])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown || reduce ? 'none' : 'translateY(24px)',
        transition: reduce
          ? 'opacity .45s ease'
          : `opacity .8s var(--ease-out-soft) ${delay}s, transform .8s var(--ease-out-soft) ${delay}s`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * The small label above a heading.
 *
 * A rule then the words, which is the zip's shape. Its own eyebrow was 12px
 * letterspaced sans; this keeps the rule and moves the type to the mono face,
 * because inside the product mono is what carries labels and numerals and a
 * landing page contradicting that would belong to a different product.
 */
export function Kicker({ children, tone = 'dark' }: { children: ReactNode; tone?: Tone }) {
  return (
    <p className="flex items-center gap-3">
      <span className="h-px w-7 bg-amber-400" />
      <span
        className={`font-mono text-[10.5px] tracking-[0.22em] uppercase ${
          tone === 'dark' ? 'text-amber-200/80' : 'text-navy-500'
        }`}
      >
        {children}
      </span>
    </p>
  )
}

/** A warm bleed from a corner. One per dark screen, never two. */
export function Glow({ corner = 'left' }: { corner?: 'left' | 'right' }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute h-[760px] w-[760px] rounded-full blur-[140px] ${
          corner === 'left' ? '-bottom-80 -left-72' : '-top-80 -right-72'
        }`}
        style={{
          background:
            'radial-gradient(circle, rgb(240 180 41 / 0.20) 0%, rgb(240 180 41 / 0.06) 45%, transparent 70%)',
        }}
      />
    </div>
  )
}

/**
 * The blueprint rule, masked to a soft ellipse.
 *
 * Lifted from the zip's `.hero-grid`, which is the same motif this product
 * already uses on its landing page — a faint square rule, the way a plan is
 * drafted before anything is built.
 */
export function BlueprintField({ tone = 'dark' }: { tone?: Tone }) {
  const line = tone === 'dark' ? 'rgb(255 255 255 / 0.05)' : 'rgb(23 37 83 / 0.05)'
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '54px 54px',
        maskImage: 'radial-gradient(ellipse at 62% 42%, #000, transparent 72%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 62% 42%, #000, transparent 72%)',
      }}
    />
  )
}

/** Page gutters, matched to the app's own `.shell`. */
export function Shell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12 ${className}`}>
      {children}
    </div>
  )
}

/**
 * A statement and its paragraph, set far apart.
 *
 * The Oryzo half of the combination. The gap between the two columns is wider
 * than either of them, and that gap is the effect — closing it to fit more in
 * would leave a page that used the same words and read nothing like this.
 */
export function Statement({
  kicker,
  headline,
  body,
  tone = 'dark',
}: {
  kicker?: string
  headline: ReactNode
  body?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="grid gap-10 md:grid-cols-12 md:gap-6">
      <div className="md:col-span-6 lg:col-span-5">
        {kicker && (
          <Rise>
            <Kicker tone={tone}>{kicker}</Kicker>
          </Rise>
        )}
        <Rise delay={0.06}>
          <h2
            className={`mt-6 font-display text-[clamp(32px,5.4vw,64px)] leading-[1.02] font-bold tracking-[-0.035em] ${
              tone === 'dark' ? 'text-amber-50' : 'text-navy-900'
            }`}
          >
            {headline}
          </h2>
        </Rise>
      </div>
      {body && (
        <div className="md:col-span-5 md:col-start-8 lg:col-span-4 lg:col-start-9">
          <Rise delay={0.12}>
            <p
              className={`text-[15.5px] leading-[1.8] ${
                tone === 'dark' ? 'text-amber-50/60' : 'text-navy-600/75'
              }`}
            >
              {body}
            </p>
          </Rise>
        </div>
      )}
    </div>
  )
}

/**
 * The doubled marquee.
 *
 * Two identical copies translated by exactly half the strip's width, so the
 * loop has no seam. Reuses the `collabify-drift` keyframe the stylesheet
 * already defines for the landing page's word strip.
 */
export function Marquee({ text, tone = 'dark' }: { text: string; tone?: Tone }) {
  const reduce = useReducedMotion()
  return (
    <div
      aria-hidden
      className={`overflow-hidden border-y py-5 ${
        tone === 'dark' ? 'border-amber-50/10' : 'border-navy-900/10'
      }`}
    >
      <div
        className="flex w-max whitespace-nowrap"
        style={reduce ? undefined : { animation: 'collabify-drift 30s linear infinite' }}
      >
        {[0, 1].map((copy) => (
          <span
            key={copy}
            className={`font-display text-[40px] leading-none font-bold tracking-[-0.03em] uppercase sm:text-[58px] ${
              tone === 'dark' ? 'text-amber-50/10' : 'text-navy-900/10'
            }`}
          >
            {text.repeat(4)}
          </span>
        ))}
      </div>
    </div>
  )
}
