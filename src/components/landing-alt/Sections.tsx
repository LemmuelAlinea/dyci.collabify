import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * The page's repeating shapes.
 *
 * oryzo.ai runs on one idea repeated: a very large statement on the left, a
 * small paragraph set well to the right of it, and a great deal of nothing in
 * between. The negative space is the design — shrinking the gaps to fit more
 * in would leave a different page that happened to use the same words.
 */

/** A warm bleed from one corner, the way a low sun catches a dark room. */
export function Glow({
  corner = 'left',
}: {
  corner?: 'left' | 'right'
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className={`absolute h-[720px] w-[720px] rounded-full blur-[130px] ${
          corner === 'left' ? '-bottom-72 -left-64' : '-top-72 -right-64'
        }`}
        style={{
          background:
            'radial-gradient(circle, rgb(240 180 41 / 0.22) 0%, rgb(240 180 41 / 0.07) 45%, transparent 70%)',
        }}
      />
    </div>
  )
}

/**
 * Fades and lifts its children the first time they reach the viewport.
 *
 * The landing page's own `Reveal` is not reused here on purpose: this page is
 * a parallel mock-up and importing from `landing/` would tie the two together,
 * so a change to one would have to be reasoned about for both.
 */
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
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '-12% 0px' },
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
        transform: shown || reduce ? 'translateY(0)' : 'translateY(22px)',
        transition: reduce
          ? 'opacity .5s ease'
          : `opacity .9s var(--ease-out-soft) ${delay}s, transform .9s var(--ease-out-soft) ${delay}s`,
      }}
    >
      {children}
    </div>
  )
}

/** The small mono kicker that labels a section without announcing it. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10.5px] tracking-[0.28em] text-amber-300/70 uppercase">
      {children}
    </p>
  )
}

/**
 * The page's one layout: a statement, and a paragraph set apart from it.
 *
 * The two do not sit in a tidy two-column grid — the paragraph starts past the
 * halfway line and the statement stops well before it, so the gap between them
 * is wider than either column. That gap is the whole effect.
 */
export function Statement({
  kicker,
  headline,
  body,
  aside,
}: {
  kicker?: string
  headline: ReactNode
  body?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="grid gap-10 md:grid-cols-12 md:gap-6">
      <div className="md:col-span-6 lg:col-span-5">
        {kicker && (
          <Rise>
            <Kicker>{kicker}</Kicker>
          </Rise>
        )}
        <Rise delay={0.06}>
          <h2 className="mt-5 font-display text-[clamp(34px,6.2vw,76px)] leading-[0.98] font-bold tracking-[-0.035em] text-amber-50">
            {headline}
          </h2>
        </Rise>
      </div>

      {(body || aside) && (
        <div className="md:col-span-5 md:col-start-8 lg:col-span-4 lg:col-start-9">
          {body && (
            <Rise delay={0.12}>
              <p className="text-[15px] leading-[1.75] text-amber-50/65 sm:text-[16px]">{body}</p>
            </Rise>
          )}
          {aside && (
            <Rise delay={0.18}>
              <div className="mt-8">{aside}</div>
            </Rise>
          )}
        </div>
      )}
    </div>
  )
}

/** Full-height section with the page's standing gutters. */
export function Panel({
  id,
  children,
  className = '',
}: {
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 px-5 py-28 sm:px-8 sm:py-36 lg:px-16 lg:py-44 ${className}`}
    >
      <div className="mx-auto w-full max-w-[1240px]">{children}</div>
    </section>
  )
}

/**
 * A figure with its label underneath, mono and small.
 *
 * Mono for the numeral is the app's own convention — index.css records that
 * inside the product the mono face's job is numerals and counts, and a landing
 * page that contradicts that would be a different product's landing page.
 */
export function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t border-amber-50/12 pt-4">
      <p className="font-mono text-[30px] leading-none font-bold text-amber-50 sm:text-[38px]">
        {value}
      </p>
      <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase">
        {label}
      </p>
    </div>
  )
}

/**
 * The doubled-letter marquee from the footer.
 *
 * Each character is rendered twice so the strip can translate by exactly half
 * its width and loop with no seam, which is the trick the original uses. Held
 * still under reduced motion — this is decorative travel and nothing is lost
 * by stopping it.
 */
export function Marquee({ text }: { text: string }) {
  const reduce = useReducedMotion()
  return (
    <div aria-hidden className="overflow-hidden border-y border-amber-50/10 py-5">
      <div
        className="flex w-max whitespace-nowrap"
        style={
          reduce ? undefined : { animation: 'collabify-drift 26s linear infinite' }
        }
      >
        {[0, 1].map((copy) => (
          <span
            key={copy}
            className="font-display text-[42px] leading-none font-bold tracking-[-0.03em] text-amber-50/12 uppercase sm:text-[62px]"
          >
            {text.repeat(4)}
          </span>
        ))}
      </div>
    </div>
  )
}
