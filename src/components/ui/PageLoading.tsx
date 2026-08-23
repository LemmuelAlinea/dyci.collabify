import { Spinner } from './Icon'

/**
 * What is on screen while a page's code arrives.
 *
 * Splitting the bundle means a page can be a network round trip away the first
 * time it is opened, and the alternative to this is a blank frame that reads as
 * a crash. It is deliberately quiet — no message, no layout shift, just enough
 * to say the app is still working.
 */
export function PageLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-[240px] items-center justify-center py-16 text-muted"
    >
      <Spinner size={20} />
    </div>
  )
}
