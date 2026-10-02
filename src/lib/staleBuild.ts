/**
 * A tab opened before a deploy still runs the old build. Its page chunks were
 * named for that build and are gone once Vercel ships the next one, so the
 * first page it has not loaded yet fails to import. A full reload picks up the
 * new build and fixes it; retrying in place cannot, because React.lazy keeps
 * the rejected import.
 */

const KEY = 'collabify:stale-reload-at'
/** A reload this recent that failed again is not a stale build. Stop there. */
const GUARD_MS = 30_000

const STALE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|not a valid JavaScript MIME type|ChunkLoadError/i

export function isStaleBuildError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return STALE.test(message)
}

/** Reload once for a new build. False when a reload just happened and did not help. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < GUARD_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // No sessionStorage (private mode, blocked): reload anyway, once per load.
    if ((window as { __collabifyReloaded?: boolean }).__collabifyReloaded) return false
    ;(window as { __collabifyReloaded?: boolean }).__collabifyReloaded = true
  }
  window.location.reload()
  return true
}

/** Vite fires this when a lazy page's code fails to load. */
export function installStaleBuildReload() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}
