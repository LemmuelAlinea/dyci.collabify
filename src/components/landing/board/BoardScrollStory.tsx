import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { BoardFallback } from './BoardFallback'
import type { BoardHandle } from './BoardScene'
import { CHAPTERS, HERO_UNTIL, ramp } from './story'

/**
 * three, fiber and drei are around 200KB gzipped between them — more than the
 * entire rest of this page. Split out, they are fetched after the landing
 * chunk rather than inside it, and the flat board holds the space meanwhile.
 */
const BoardExperience = lazy(() => import('./BoardExperience'))

/**
 * GSAP is imported at first effect, not at module scope.
 *
 * Statically imported it put itself and ScrollTrigger — about 47KB gzipped —
 * into the landing page's entry chunk, which is where the bytes are most
 * expensive. Nothing on the first paint needs it: the hero renders, and the
 * scroll behaviour attaches a moment later.
 */
type Gsap = typeof import('gsap')['default']
type ScrollTriggerType = typeof import('gsap/ScrollTrigger')['ScrollTrigger']

/** The canvas box, at its final height, before anything has loaded. */
const BOX = 'relative h-[340px] w-full sm:h-[400px] lg:h-[470px] xl:h-[500px]'

/**
 * The hero and the story it turns into.
 *
 * CSS `position: sticky` holds the viewport, not a GSAP pin. Both were offered
 * and sticky is the one that cannot desynchronise: a pin works by cutting the
 * element out of the flow and inserting a spacer of its measured height, so
 * anything that changes that height afterwards — a font landing, the 3D canvas
 * sizing itself, a resize — leaves the spacer wrong and the page jumps. Sticky
 * is the browser's own, needs no measurement, and survives all three.
 *
 * ScrollTrigger is still here and still doing the work it is good at: turning
 * scroll into a 0–1 progress. That number is written to a ref the frame loop
 * reads and straight onto the chapters' style. Nothing about this section
 * re-renders while somebody scrolls it.
 *
 * Below 768px there is no story. The hero stacks, the chapters become ordinary
 * blocks under it, and the board plays its entrance and one pass of the flying
 * card on its own — a pinned three-screen sequence on a phone is a scroll
 * somebody has to fight through to reach the page.
 */

/**
 * How much scroll the story costs, counting the screen it is pinned for.
 *
 * 280 was the brief's figure and it made the hero 2.8 screens tall — nearly
 * three full drags before anything else on the page existed. At 200 the pinned
 * screen is one, the travel through all three chapters is the second, and
 * "How it works" is one scroll away rather than three.
 */
const STORY_VH = 200

export function BoardScrollStory({ heroCopy }: { heroCopy: ReactNode }) {
  const reduced = useReducedMotion() ?? false
  const wrap = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([])
  const [pinned, setPinned] = useState(false)

  // One handle for the whole subtree: GSAP writes progress, the DOM listener
  // writes pointer, the frame loop reads both. No state crosses this boundary.
  //
  // useMemo rather than a ref: reading `.current` during render is exactly what
  // React's rules forbid, and a stable object is all this needs to be.
  const handle = useMemo<BoardHandle>(
    () => ({
      progress: { current: 0 },
      pointer: { current: { x: 0, y: 0, active: false } },
    }),
    [],
  )

  useEffect(() => {
    const q = window.matchMedia('(min-width: 768px)')
    const sync = () => setPinned(q.matches && !reduced)
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [reduced])

  useEffect(() => {
    const el = wrap.current
    if (!el) return

    let cancelled = false
    let teardown: (() => void) | null = null

    const paint = (p: number) => {
      handle.progress.current = p
      const hero = heroRef.current
      // The hero copy leaves upward; each chapter arrives from below and goes
      // the same way. Only one is ever near full opacity.
      if (hero) {
        const out = ramp(p, 0.06, HERO_UNTIL)
        hero.style.opacity = String(1 - out)
        hero.style.transform = `translateY(${-22 * out}px)`
        hero.style.pointerEvents = out > 0.5 ? 'none' : 'auto'
      }
      CHAPTERS.forEach((c, i) => {
        const node = chapterRefs.current[i]
        if (!node) return
        const span = c.to - c.from
        const inn = ramp(p, c.from, c.from + span * 0.35)
        // The last chapter never fades: it has to still be there at the moment
        // the section unpins, or the board spends the end of the scroll beside
        // an empty column.
        const out =
          i === CHAPTERS.length - 1 ? 0 : ramp(p, c.to - span * 0.2, c.to)
        const o = inn * (1 - out)
        node.style.opacity = String(o)
        node.style.transform = `translateY(${20 * (1 - inn) - 20 * out}px)`
        node.style.pointerEvents = o > 0.5 ? 'auto' : 'none'
      })
    }

    const attach = (gsap: Gsap, ScrollTrigger: ScrollTriggerType) => {
    gsap.registerPlugin(ScrollTrigger)
    const mm = gsap.matchMedia()

    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      const st = ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        // The sticky child is one viewport tall, so the scrollable remainder is
        // the wrapper's height minus that — which is exactly when the last
        // chapter should be finishing.
        end: 'bottom bottom',
        onUpdate: (self) => paint(self.progress),
        onRefresh: (self) => paint(self.progress),
      })
      return () => st.kill()
    })

    // No story here: the hero copy stays put and the chapters read as ordinary
    // sections. The board still gets one pass of its card so the page is not
    // static, driven on a clock rather than on scroll.
    mm.add('(max-width: 767.98px), (prefers-reduced-motion: reduce)', () => {
      paint(0)
      if (heroRef.current) {
        heroRef.current.style.opacity = '1'
        heroRef.current.style.transform = 'none'
        heroRef.current.style.pointerEvents = 'auto'
      }
      chapterRefs.current.forEach((n) => {
        if (!n) return
        n.style.opacity = '1'
        n.style.transform = 'none'
        n.style.pointerEvents = 'auto'
      })
      if (reduced) {
        handle.progress.current = 0.95
        return
      }
      const state = { p: 0 }
      const tween = gsap.to(state, {
        p: 0.92,
        duration: 5.5,
        delay: 2.2,
        ease: 'power2.inOut',
        onUpdate: () => {
          handle.progress.current = state.p
        },
      })
      return () => tween.kill()
    })

    // Only once the canvas box and the copy have settled, so the trigger is
    // measured against the layout the reader actually gets.
    const t = window.setTimeout(() => ScrollTrigger.refresh(), 250)

      return () => {
        window.clearTimeout(t)
        mm.revert()
      }
    }

    // The hero is fully readable before this resolves; if the component
    // unmounts first — StrictMode's double mount, or a fast navigation — the
    // flag stops it attaching to a dead tree.
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
      ([g, st]) => {
        if (cancelled) return
        teardown = attach(g.default, st.ScrollTrigger)
      },
    )

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [handle, reduced])

  return (
    <div
      ref={wrap}
      className="relative"
      style={pinned ? { height: `${STORY_VH}vh` } : undefined}
    >
      <div
        className={
          pinned
            ? 'sticky top-0 flex h-[100svh] items-center'
            : 'relative flex items-center'
        }
      >
        <div className="shell w-full">
          <div className="grid items-center gap-10 pt-[104px] pb-12 md:pt-[116px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-14 xl:gap-16">
            {/* Left: the hero, and the chapters it becomes. Stacked on top of
                each other when pinned so the crossfade has nothing to push
                around; in normal flow otherwise. */}
            <div className={pinned ? 'relative min-h-[420px]' : ''}>
              <div
                ref={heroRef}
                className={pinned ? 'absolute inset-x-0 top-0' : ''}
                style={{ willChange: pinned ? 'opacity, transform' : undefined }}
              >
                {heroCopy}
              </div>

              {CHAPTERS.map((c, i) => (
                <div
                  key={c.id}
                  ref={(n) => {
                    chapterRefs.current[i] = n
                  }}
                  className={
                    pinned ? 'absolute inset-x-0 top-0 max-w-[520px]' : 'mt-10 max-w-[520px]'
                  }
                  style={{
                    opacity: pinned ? 0 : 1,
                    willChange: pinned ? 'opacity, transform' : undefined,
                  }}
                >
                  <p className="eyebrow text-amber-400">
                    Step {i + 1} of {CHAPTERS.length}
                  </p>
                  <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.9rem)] leading-[1.05] font-extrabold">
                    {c.title}
                  </h2>
                  <p className="mt-4 text-[17px] leading-relaxed text-white/70">{c.body}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <Suspense
                fallback={
                  <div className="relative w-full">
                    <div className={BOX}>
                      <BoardFallback />
                    </div>
                  </div>
                }
              >
                <BoardExperience handle={handle} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
