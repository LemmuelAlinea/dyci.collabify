import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'

/**
 * One button for both directions: it enters full screen, then turns into the
 * exit button. It follows `fullscreenchange`, so leaving with Esc or F11 flips
 * it back too. Browsers without the Fullscreen API (iPhone Safari) get nothing.
 */
export function FullscreenToggle() {
  const [on, setOn] = useState(() => Boolean(document.fullscreenElement))

  useEffect(() => {
    const sync = () => setOn(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  if (!document.fullscreenEnabled) return null

  function toggle() {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    // Refused (no user gesture, a policy): the button keeps its state.
    void request.catch(() => {})
  }

  const label = on ? 'Exit full screen' : 'Full screen'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-[var(--surface-sunken)] hover:text-ink"
    >
      <Icon name={on ? 'minimize' : 'maximize'} size={18} />
    </button>
  )
}
