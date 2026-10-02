import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { latestBuild, loadedBuild } from '../../lib/staleBuild'

const EVERY_MS = 5 * 60_000
/** Coming back to the tab checks again, but not more than once a minute. */
const ON_RETURN_MS = 60_000

/**
 * Says so when a newer build of Collabify has shipped since this tab loaded,
 * before the tab trips over it. Production only: the dev server has no build
 * to compare. "Later" hides it until the next build after that one.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    const mine = loadedBuild()
    if (!mine) return

    let last = 0
    let alive = true
    const check = async () => {
      last = Date.now()
      const now = await latestBuild()
      if (alive && now && now !== mine) setReady(now)
    }
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > ON_RETURN_MS) void check()
    }

    const timer = window.setInterval(() => void check(), EVERY_MS)
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [])

  if (!ready || ready === dismissed) return null

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex justify-center p-4 sm:justify-start sm:p-6"
    >
      <div
        data-state="open"
        className="motion-toast pointer-events-auto flex w-full max-w-[400px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-toast-info-line bg-toast-info px-4 py-3 text-[14px] text-toast-info-ink shadow-lift"
      >
        <Icon name="refresh" size={17} className="shrink-0" />
        <span className="min-w-[180px] flex-1">A new version of Collabify is ready.</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" className="!h-8 !rounded-lg !px-3" onClick={() => setDismissed(ready)}>
            Later
          </Button>
          <Button size="sm" className="!h-8 !rounded-lg !px-3" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </span>
      </div>
    </div>
  )
}
