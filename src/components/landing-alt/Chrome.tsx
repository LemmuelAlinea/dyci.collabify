import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * The fixed furniture: nav, scroll rail, edge labels.
 *
 * Modelled on oryzo.ai, where the chrome is deliberately the quietest thing on
 * screen — a wordmark, four tiny uppercase links, and a hairline progress bar.
 * Everything that carries weight is in the content underneath, which is what
 * lets the display type feel as large as it does.
 */

const SECTIONS = [
  { id: 'intro', label: 'Intro' },
  { id: 'board', label: 'The board' },
  { id: 'flow', label: 'How it runs' },
  { id: 'start', label: 'Start' },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? 'bg-navy-950/70 backdrop-blur-md' : ''
      }`}
    >
      <div className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link
          to="/preview"
          className="font-display text-[15px] font-bold tracking-[0.14em] text-amber-50 uppercase sm:text-[17px]"
        >
          Collabify
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="font-mono text-[10.5px] tracking-[0.16em] text-amber-50/55 uppercase transition-colors duration-200 hover:text-amber-50"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <Link
          to="/register"
          className="font-mono text-[10.5px] tracking-[0.16em] text-amber-50/55 uppercase transition-colors duration-200 hover:text-amber-50 md:hidden"
        >
          Start
        </Link>
      </div>
    </header>
  )
}

/**
 * The hairline that fills as the page moves.
 *
 * Driven by a scroll listener rather than `animation-timeline: scroll()`,
 * which is Chromium-only and this project's browserslist floor includes
 * Firefox and Safari. Reduced motion still gets the bar — it is a position
 * readout, not movement for its own sake — but it jumps rather than eases.
 */
export function ScrollRail() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-24 right-5 bottom-24 z-40 hidden w-px bg-amber-50/12 lg:block"
    >
      <div
        className="w-px bg-amber-300 transition-[height] duration-150 ease-out"
        style={{ height: `${progress * 100}%` }}
      />
    </div>
  )
}

/** A vertical label down the left edge, the way a spec sheet marks a plate. */
export function EdgeLabel({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none fixed top-1/2 left-4 z-40 hidden -translate-y-1/2 font-mono text-[10px] tracking-[0.3em] text-amber-50/35 uppercase lg:block"
      style={{ writingMode: 'vertical-rl' }}
    >
      {children}
    </span>
  )
}
