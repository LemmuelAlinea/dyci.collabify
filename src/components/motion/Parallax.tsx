import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'

/**
 * Scroll-linked motion for the landing page.
 *
 * Everything here is decoration, so everything here disappears under
 * `prefers-reduced-motion` — not slowed down, removed. A parallax that still
 * drifts a little is worse than none for somebody who asked for stillness.
 *
 * The scroll position drives a spring rather than the transform directly. Wheel
 * events arrive in jumps and a raw binding shows every one of them; the spring
 * is what makes it read as weight instead of stutter.
 */
export function Parallax({
  children,
  /** Pixels travelled across the whole time the element is on screen. */
  distance = 60,
  className = '',
}: {
  children: ReactNode
  distance?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })
  const eased = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 })
  const y = useTransform(eased, [0, 1], [distance, -distance])

  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  )
}

/**
 * A line that fills as its section is read.
 *
 * Used down the left of the flow: it is the only thing on the page that tells
 * you how far through an explanation you are, which is worth more than any of
 * the fades.
 */
export function ScrollLine({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target,
    offset: ['start 65%', 'end 60%'],
  })
  const height = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 })

  return (
    <div
      aria-hidden
      className="absolute top-2 bottom-2 left-[15px] hidden w-px bg-[var(--line)] md:block"
    >
      <motion.div
        className="w-px origin-top bg-amber-400"
        style={{ height: '100%', scaleY: reduce ? 1 : height }}
      />
    </div>
  )
}

/**
 * A word strip that drifts sideways for ever.
 *
 * The words are the product's own vocabulary — claimed, handed in, returned —
 * which is the one kind of ornament that also tells you what the thing does.
 * CSS rather than a spring: it never reacts to anything, so nothing needs to
 * observe the scroll for it.
 */
export function Marquee({ words }: { words: string[] }) {
  const reduce = useReducedMotion()
  const run = [...words, ...words]

  return (
    <div
      aria-hidden
      className="relative overflow-hidden border-y border-line py-4"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 12%, black 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 12%, black 88%, transparent)',
      }}
    >
      <div
        className="flex w-max items-center gap-10"
        style={reduce ? undefined : { animation: 'collabify-drift 38s linear infinite' }}
      >
        {run.map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="font-mono text-[12px] tracking-[0.22em] whitespace-nowrap text-faint uppercase"
          >
            {w}
            <span className="ml-10 text-amber-500/60 dark:text-amber-300/50">/</span>
          </span>
        ))}
      </div>
    </div>
  )
}
