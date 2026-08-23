import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Seconds. Stagger siblings by passing 0, 0.06, 0.12 … */
  delay?: number
  y?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article' | 'span'
  /** Re-hide when scrolled back out, so the motion is reversible. */
  once?: boolean
}

/**
 * Content that arrives as it is scrolled to.
 *
 * **Reduced motion does not mean no animation — it means no movement.** The
 * guidance is about vestibular trouble: travel, parallax, scaling. A cross-fade
 * causes none of that, so under `prefers-reduced-motion` this keeps fading and
 * only drops the translate. It matters more than it sounds: Windows ships with
 * animation effects off on a great many machines, browsers report that as
 * reduced motion, and treating the preference as "show everything instantly"
 * left whole pages looking dead to people who never asked for that.
 *
 * **Nothing here may leave content permanently invisible.** Hiding is done in
 * JavaScript, so anything that stops the observer — a browser that never
 * composites the page, a tab restored from the back/forward cache — would
 * otherwise blank the section for good. Two things prevent it: the first frame
 * decides from the element's own box rather than waiting to be told, and a
 * failsafe reveals everything a second and a half later whatever happened.
 */
const FAILSAFE_MS = 1500

export function Reveal({
  children,
  delay = 0,
  y = 22,
  className = '',
  as: Tag = 'div',
  once = false,
}: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(query.matches)
    const onChange = () => setReduce(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Anything already on screen at mount is shown on the first paint, so the
  // top of a page never waits for an observer callback to become readable.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (box.top < window.innerHeight * 0.94 && box.bottom > 0) setShown(true)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          if (once) io.disconnect()
        } else if (!once) {
          setShown(false)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    io.observe(el)

    const failsafe = window.setTimeout(() => setShown(true), FAILSAFE_MS)
    return () => {
      io.disconnect()
      window.clearTimeout(failsafe)
    }
  }, [once])

  // The attribute exempts this transition from the blanket reduced-motion rule
  // in index.css, which zeroes every other duration on the page.
  return (
    <Tag
      ref={ref as never}
      data-reveal={reduce ? 'fade' : 'move'}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown || reduce ? 'none' : `translate3d(0, ${y}px, 0)`,
        transition: reduce
          ? `opacity .55s var(--ease-out-soft) ${delay}s`
          : `opacity .7s var(--ease-out-soft) ${delay}s, transform .7s var(--ease-out-soft) ${delay}s`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </Tag>
  )
}
