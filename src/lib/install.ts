import { useEffect, useState } from 'react'

/*
 * Installing Collabify as an app (the Home Screen or desktop app built from
 * public/manifest.webmanifest).
 *
 * Chrome and Edge offer an install prompt only once the site has a service
 * worker that handles fetches, so `registerAppWorker` registers
 * public/OneSignalSDKWorker.js for everyone on a production build. It is the
 * file OneSignal registers for push, at the same scope, so the two never
 * compete. The prompt itself arrives as `beforeinstallprompt`, often before
 * React has drawn anything, so it is caught as soon as this module loads.
 *
 * Where there is no prompt to show (iPhone and iPad, Firefox, a browser inside
 * Messenger or Facebook, or Chrome before it decides), the button shows the
 * steps for that device instead. `installRoute` decides which.
 */

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallRoute =
  | 'installed' // already running as the installed app
  | 'prompt' // the browser handed over its install prompt
  | 'in-app' // a browser inside Messenger, Facebook, Instagram and the like: cannot install
  | 'ios' // iPhone or iPad: Share, then Add to Home Screen
  | 'android' // Android browser menu
  | 'desktop' // Chrome or Edge on a computer: the address bar or menu
  | 'unsupported' // Firefox on a computer, and the rest

const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|MicroMessenger|musical_ly|BytedanceWebview|TikTok|Snapchat|; wv\)/i

/** Which way to install from here. Pure, so it is tested without a browser. */
export function installRoute(
  ua: string,
  { standalone, hasPrompt, touchPoints = 0 }: { standalone: boolean; hasPrompt: boolean; touchPoints?: number },
): InstallRoute {
  if (standalone) return 'installed'
  if (IN_APP.test(ua)) return 'in-app'
  if (hasPrompt) return 'prompt'
  // iPadOS asks for the desktop site and says Macintosh; a Mac has no touch points.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Firefox\//.test(ua)) return 'unsupported'
  if (/Chrome\/|Edg\//.test(ua)) return 'desktop'
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'desktop'
  return 'unsupported'
}

let deferred: InstallPrompt | null = null
let installedNow = false
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  // Not prevented: Chrome may still show its own install bar, and the button
  // can show the same prompt later from this saved event.
  window.addEventListener('beforeinstallprompt', (event) => {
    deferred = event as InstallPrompt
    tell()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    tell()
  })
}

/** Registers the worker that makes the site installable. Production only: it would get in the way of dev reloads. */
export function registerAppWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const go = () => navigator.serviceWorker.register('/OneSignalSDKWorker.js', { scope: '/' }).catch(() => undefined)
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}

function isStandalone() {
  return (
    installedNow ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function currentRoute(): InstallRoute {
  return installRoute(navigator.userAgent, {
    standalone: isStandalone(),
    hasPrompt: deferred !== null,
    touchPoints: navigator.maxTouchPoints,
  })
}

/**
 * The install button's state. `install` shows the browser's prompt when there
 * is one and says whether it went ahead; otherwise it returns null and the
 * caller shows the steps for `route`.
 */
export function useInstall() {
  const [route, setRoute] = useState<InstallRoute>(currentRoute)

  useEffect(() => {
    const update = () => setRoute(currentRoute())
    listeners.add(update)
    update()
    return () => {
      listeners.delete(update)
    }
  }, [])

  const install = async (): Promise<boolean | null> => {
    const event = deferred
    if (!event) return null
    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      // A prompt can be shown once; Chrome hands over a fresh one if it is offered again.
      deferred = null
      tell()
      return outcome === 'accepted'
    } catch {
      deferred = null
      tell()
      return null
    }
  }

  return { route, install }
}
