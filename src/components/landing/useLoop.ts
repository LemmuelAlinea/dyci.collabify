import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * A looping sequence that only runs while it is being looked at.
 *
 * The hero board plays the product's lifecycle on repeat. Three things stop it,
 * and each one is a real cost rather than tidiness: off screen it is animating
 * for nobody, a hidden tab still schedules the timer on many browsers, and
 * `prefers-reduced-motion` means the person asked for stillness.
 *
 * Under reduced motion it does not freeze on step 0 — it returns the **final**
 * step, so a still reader sees the board in the state the sequence ends in
 * rather than an empty one waiting for movement that will not come.
 */
export function useLoop(steps: number, msPerStep = 2100) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setLive(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setLive(e.isIntersecting), {
      threshold: 0.25,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduce) {
      setStep(steps - 1)
      return
    }
    if (!live) return

    const timer = window.setInterval(() => {
      if (document.hidden) return
      setStep((s) => (s + 1) % steps)
    }, msPerStep)
    return () => window.clearInterval(timer)
  }, [live, reduce, steps, msPerStep])

  return { ref, step, reduce }
}

/**
 * Which of a set of elements the reader is level with — the section, for the
 * nav indicator; the step, for the flow.
 *
 * The answer is the last element whose top has passed a line 45% down the
 * viewport. How that is measured went wrong twice, and both failures are worth
 * knowing before simplifying this:
 *
 * - **A scroll listener alone is not enough.** The position can change without
 *   a scroll event — a restored position, a programmatic jump, an embedded
 *   viewport that does not propagate them — and a listener that misses those
 *   leaves the indicator pointing at the wrong place with no way back.
 * - **A negative `rootMargin` band is worse.** `-45%` top with `-55%` bottom is
 *   a root of *zero height*, which nothing can ever intersect; the symptom is
 *   not an error but an indicator that never moves.
 * - **A frame loop cannot be relied on either.** `requestAnimationFrame` does
 *   not run at all in a document the browser is not painting — a background
 *   tab, a page being thumbnailed, an embedded view. Neither, it turns out,
 *   does IntersectionObserver: in a hidden document it never fires once.
 *
 * So there is no observer here at all, and that was the simplification. Gating
 * the work on one only made the feature depend on a callback that a hidden
 * document never delivers, to save six rect reads twice a second. What is left
 * is a scroll listener as the fast path — it fires before paint, so the
 * indicator moves with the page rather than after it — and a slow sweep that
 * catches a position which changed without announcing itself. Both return
 * immediately on the far more common case of the page not having moved, so at
 * rest this costs one number comparison twice a second.
 *
 * Nothing here decides what is *shown*, only what is emphasised, so even total
 * failure leaves the page whole.
 */
const LINE = 0.45
const SWEEP_MS = 500

function useBandIndex(count: number, resolve?: () => (HTMLElement | null)[]) {
  const items = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState<number | null>(null)

  const setItem = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      items.current[i] = el
    },
    [],
  )

  useEffect(() => {
    // Callback refs are filled during the commit that runs this effect. A
    // caller with no refs to give — the nav, whose targets are sections it does
    // not render — resolves them here instead; doing it in its own effect would
    // be too late, because a child hook's effect runs before its caller's.
    if (resolve) items.current = resolve()
    if (items.current.every((el) => !el)) return

    let lastY = -1

    const measure = (force = false) => {
      const y = window.scrollY
      if (!force && y === lastY) return
      lastY = y
      // clientHeight rather than innerHeight: it is the box the layout is
      // resolved against, and it excludes a visible scrollbar.
      const line = document.documentElement.clientHeight * LINE
      let found: number | null = null
      for (let i = 0; i < items.current.length; i++) {
        const el = items.current[i]
        if (el && el.getBoundingClientRect().top <= line) found = i
      }
      setActive((prev) => (prev === found ? prev : found))
    }

    const onScroll = () => measure()
    const onResize = () => measure(true)

    measure(true)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    // Not forced: if the page has not moved there is nothing to recompute,
    // which is what makes a twice-a-second sweep cost nothing.
    const sweep = window.setInterval(() => measure(), SWEEP_MS)

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.clearInterval(sweep)
    }
  }, [count, resolve])

  return { setItem, active }
}

/** The nav indicator. Null until a section is reached, so the hero has none. */
export function useActiveSection(ids: string[]) {
  const resolve = useCallback(() => ids.map((id) => document.getElementById(id)), [ids])
  const { active } = useBandIndex(ids.length, resolve)
  return active === null ? null : ids[active]
}

/**
 * Which step of the flow the reader is at.
 *
 * Starts at 0 rather than null: the steps are a chain, and the first one is
 * where you are before you have moved.
 */
export function useActiveIndex(count: number) {
  const { setItem, active } = useBandIndex(count)
  return { setItem, active: active ?? 0 }
}
