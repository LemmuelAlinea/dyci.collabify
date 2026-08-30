import { useEffect, useState } from 'react'

/**
 * Whether a media query matches, kept current.
 *
 * **It starts as `true`, and that is deliberate.** Callers use this to decide
 * whether a section may be folded away on a narrow screen, so the failure mode
 * has to be "everything is open" rather than "everything is hidden". If
 * `matchMedia` is missing, or the first paint happens before the effect runs,
 * the page is whole rather than empty.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(true)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** The breakpoint the dashboards fold at — Tailwind's `md`. */
export function useWideScreen() {
  return useMediaQuery('(min-width: 768px)')
}
