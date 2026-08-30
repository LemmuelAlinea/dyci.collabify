import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/**
 * True from the first tick after mount.
 *
 * Everything that enters on this page is styled from this flag with a CSS
 * transition, rather than being animated out of an invisible starting state.
 * The distinction is the whole point, and it is not stylistic:
 *
 * **An entrance must never be the only thing making content visible.** Animate
 * from `opacity: 0` and the content is gone until something advances the
 * animation — and plenty of real situations never do. A document the browser
 * is not painting runs no `requestAnimationFrame` at all: a background tab, a
 * page being thumbnailed, an embedded view. Measured here, that rendered the
 * hero completely blank — headline, buttons, board and all.
 *
 * Timers fire regardless, so this returns two flags rather than one:
 *
 * - `entered` — a frame after mount. The final style is applied here, and the
 *   transition is decoration on top of it.
 * - `settled` — once the longest entrance is over, the transition is dropped
 *   altogether. That is the failsafe, and it is needed even though `entered`
 *   already carries the final value: a *transform* reveal hides behind a mask
 *   rather than behind opacity, so a transition frozen part-way leaves the word
 *   still translated out of sight. Measured in this pane: the headline's words
 *   sat 78px below their masks indefinitely.
 *
 * After settling, either the transition ran and this changes nothing, or it did
 * not and the content snaps into place. Both are correct; only staying hidden
 * is not.
 *
 * It is the same rule `motion/Reveal` follows for content that arrives on
 * scroll, and for the same reason.
 */
const SETTLE_MS = 1800

function useEntered() {
  const [entered, setEntered] = useState(false)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const a = window.setTimeout(() => setEntered(true), 24)
    const b = window.setTimeout(() => setSettled(true), SETTLE_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [])
  return { entered, settled }
}

/**
 * Content that arrives on page load. Reduced motion keeps the fade and drops
 * the travel: the guidance is about movement, and a page that snaps into place
 * reads as broken to somebody who only asked for less of it.
 */
export function Rise({
  children,
  delay = 0,
  y = 26,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  /** A list of items still has to be a list. */
  as?: 'div' | 'ul' | 'p'
}) {
  const { entered, settled } = useEntered()
  const reduce = useReducedMotion()

  const style: CSSProperties = {
    opacity: entered ? 1 : 0,
    transform: entered || reduce ? 'none' : `translate3d(0, ${y}px, 0)`,
    transition: settled
      ? 'none'
      : reduce
        ? `opacity .6s var(--ease-out-soft) ${delay}s`
        : `opacity .75s var(--ease-out-soft) ${delay}s, transform .75s var(--ease-out-soft) ${delay}s`,
  }

  return (
    <Tag className={className} style={style}>
      {children}
    </Tag>
  )
}

/**
 * A heading that arrives a word at a time, each one rising out from behind its
 * own line rather than fading in place.
 *
 * The mask is what makes it read as type being set instead of text appearing:
 * every word travels up through a clipped box, so the baseline stays put and
 * nothing is ever half-transparent. Under reduced motion the words are simply
 * there — no travel, and no fade either, because a heading is the one thing on
 * the page that should never make somebody wait to read it.
 */
export function WordReveal({
  text,
  className = '',
  accent,
  delay = 0,
  as: Tag = 'h1',
}: {
  text: string
  className?: string
  /** Words to set in the accent colour, matched case-insensitively. */
  accent?: string[]
  delay?: number
  as?: 'h1' | 'h2' | 'p'
}) {
  const { entered, settled } = useEntered()
  const reduce = useReducedMotion()
  const words = text.split(' ')
  const isAccent = (w: string) =>
    accent?.some((a) => a.toLowerCase() === w.replace(/[.,]/g, '').toLowerCase()) ?? false

  if (reduce) {
    return (
      <Tag className={className}>
        {words.map((w, i) => (
          <span key={`${w}-${i}`} className={isAccent(w) ? 'text-amber-400' : undefined}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </Tag>
    )
  }

  return (
    <Tag className={className}>
      {words.map((w, i) => (
        <span
          key={`${w}-${i}`}
          // inline-flex rather than inline-block: a descender on the last line
          // was being clipped by the mask on Safari otherwise.
          className="inline-flex overflow-hidden pb-[0.08em] align-bottom"
        >
          <span
            className={isAccent(w) ? 'text-amber-400' : undefined}
            style={{
              display: 'inline-block',
              transform: entered ? 'none' : 'translate3d(0, 108%, 0)',
              transition: settled
                ? 'none'
                : `transform .85s var(--ease-out-soft) ${delay + i * 0.055}s`,
            }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        </span>
      ))}
    </Tag>
  )
}

/**
 * A tick that draws itself instead of appearing.
 *
 * Used down the role lists, where the point of the mark is that somebody can
 * do the thing beside it — a stroke being made is closer to that than a shape
 * fading in. Same geometry as the `check` icon so the two never disagree.
 */
export function DrawnCheck({ delay = 0, size = 16 }: { delay?: number; size?: number }) {
  const reduce = useReducedMotion()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <motion.path
        d="M20 6L9 17l-5-5"
        initial={reduce ? undefined : { pathLength: 0, opacity: 0 }}
        whileInView={reduce ? undefined : { pathLength: 1, opacity: 1 }}
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
        transition={{ duration: 0.5, delay, ease: [0.65, 0, 0.35, 1] }}
      />
    </svg>
  )
}

/**
 * A card that lights where the pointer is.
 *
 * The highlight is written straight to the node's style on pointer move, not
 * held in state — going through React here would re-render the whole grid on
 * every mouse event, which is the kind of thing that makes a page feel
 * expensive to the eye and cheap to the hand.
 *
 * The glow is its own element rather than a global CSS class, so the whole
 * effect stays inside this file. It is a pointer affordance and nothing else:
 * touch never fires it, and under reduced motion nothing is attached at all.
 */
export function Spotlight({
  children,
  className = '',
  as: Tag = 'article',
}: {
  children: ReactNode
  className?: string
  as?: 'article' | 'div'
}) {
  const ref = useRef<HTMLElement>(null)
  const glow = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()

  function onMove(e: React.PointerEvent) {
    if (reduce || e.pointerType !== 'mouse') return
    const el = ref.current
    const g = glow.current
    if (!el || !g) return
    const box = el.getBoundingClientRect()
    g.style.background =
      `radial-gradient(240px circle at ${e.clientX - box.left}px ${e.clientY - box.top}px, ` +
      'rgb(240 180 41 / 0.16), transparent 62%)'
    g.style.opacity = '1'
  }

  function onLeave() {
    if (glow.current) glow.current.style.opacity = '0'
  }

  return (
    <Tag
      ref={ref as never}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`relative isolate ${className}`}
    >
      <span
        ref={glow}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 transition-opacity duration-300"
      />
      {children}
    </Tag>
  )
}
