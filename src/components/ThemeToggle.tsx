import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { useReducedMotion } from 'motion/react'
import { useThemePreference } from '../hooks/useThemePreference'
import { Icon } from './ui/Icon'

/** How long the circle takes to cover the screen. */
const REVEAL_MS = 520

export function ThemeToggle({ tone = 'auto' }: { tone?: 'auto' | 'onNavy' }) {
  const { resolved, choose } = useThemePreference()
  const reduce = useReducedMotion()
  const next = resolved === 'dark' ? 'light' : 'dark'

  /**
   * The new theme grows out of this button as a circle over the old one.
   *
   * The browser photographs the page, the theme switches underneath in one
   * synchronous render (flushSync, so the `dark` class and the person's colours
   * are on the page before the second photograph), and the new photograph is
   * clipped in from the button's centre. Without View Transitions, or with
   * reduced motion asked for, the theme simply switches as it always did.
   */
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (reduce || typeof document.startViewTransition !== 'function') {
      void choose(next)
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    // Far enough to reach the furthest corner of the window.
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))

    const root = document.documentElement
    // Colour transitions would otherwise start from the old theme, and the new
    // photograph would catch them halfway.
    root.classList.add('theme-switching')
    const transition = document.startViewTransition(() => {
      flushSync(() => void choose(next))
    })
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
          {
            duration: REVEAL_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)', // --ease-out-soft
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .catch(() => {
        // Skipped (another transition, a hidden tab): the theme has still changed.
      })
    void transition.finished.finally(() => root.classList.remove('theme-switching'))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid h-10 w-10 place-items-center rounded-full transition-colors duration-200 ${
        tone === 'onNavy'
          ? 'text-white/75 hover:bg-white/10 hover:text-white'
          : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
      }`}
    >
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  )
}
