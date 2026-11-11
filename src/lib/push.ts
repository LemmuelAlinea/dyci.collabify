import { useCallback, useEffect, useState } from 'react'
import { chimeReady } from './chime'

/*
 * Device push through OneSignal's web SDK (docs/superpowers/specs/2026-11-11-device-push-design.md).
 *
 * The database sends every notification row to OneSignal for the recipient's user id; this file only
 * links the device to that id and lets the person turn it on. OneSignal answers one origin per app,
 * so anywhere else (localhost, previews) the SDK is never loaded.
 */

const APP_ID = 'f3a232e0-d87f-4ddf-9da5-40b0e65d22ac'
const PUSH_ORIGIN = 'https://dyci-collabify.vercel.app'
const SDK = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'

type OneSignalApi = {
  init: (options: { appId: string }) => Promise<void>
  login: (externalId: string) => Promise<void>
  logout: () => Promise<void>
  Notifications: {
    isPushSupported: () => boolean
    permissionNative: NotificationPermission
    requestPermission: () => Promise<void>
    addEventListener: {
      (event: 'permissionChange', fn: () => void): void
      (event: 'foregroundWillDisplay', fn: (event: { preventDefault: () => void }) => void): void
    }
    removeEventListener: (event: 'permissionChange', fn: () => void) => void
  }
  User: {
    PushSubscription: {
      optedIn?: boolean
      optIn: () => Promise<void>
      optOut: () => Promise<void>
      addEventListener: (event: 'change', fn: () => void) => void
      removeEventListener: (event: 'change', fn: () => void) => void
    }
  }
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalApi) => void | Promise<void>>
  }
}

let loading: Promise<OneSignalApi> | null = null

export const pushAvailableHere = () => window.location.origin === PUSH_ORIGIN

function load(): Promise<OneSignalApi> {
  if (loading) return loading
  loading = new Promise<OneSignalApi>((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || []
    window.OneSignalDeferred.push(async (os) => {
      try {
        await os.init({ appId: APP_ID })
        // With Collabify open, the bell and its chime (lib/chime.ts) say a notification arrived;
        // the phone's own banner would sound a second time. It still shows when the chime
        // cannot play: switched off, or audio not yet unlocked by a tap.
        os.Notifications.addEventListener('foregroundWillDisplay', (event) => {
          if (chimeReady()) event.preventDefault()
        })
        resolve(os)
      } catch (err) {
        reject(err)
      }
    })
    const script = document.createElement('script')
    script.src = SDK
    script.defer = true
    script.onerror = () => reject(new Error('The notification service did not load.'))
    document.head.appendChild(script)
  })
  // A blocked or failed load is tried again next time instead of staying broken.
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** Ties this device to the signed-in account so the database can reach it by user id. */
export async function linkPush(userId: string) {
  if (!pushAvailableHere()) return
  const os = await load()
  await os.login(userId)
}

/**
 * Unties this device before sign-out, so a shared computer stops receiving the last person's
 * notifications. Never holds the sign-out up for more than two seconds.
 */
export async function unlinkPush() {
  if (!loading) return
  const done = loading.then((os) => os.logout()).catch(() => undefined)
  await Promise.race([done, new Promise((r) => setTimeout(r, 2000))])
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isHomeScreenApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export type PushState =
  | 'loading'
  | 'elsewhere' // not the live site
  | 'ios-tab' // iPhone or iPad in a browser tab: needs the Home Screen first
  | 'unsupported'
  | 'blocked'
  | 'off'
  | 'on'
  | 'failed'

function read(os: OneSignalApi): PushState {
  if (!os.Notifications.isPushSupported()) return 'unsupported'
  if (os.Notifications.permissionNative === 'denied') return 'blocked'
  return os.User.PushSubscription.optedIn ? 'on' : 'off'
}

/** This device's push state, with the two things a person can do about it. */
export function useDevicePush() {
  const [state, setState] = useState<PushState>(() =>
    !pushAvailableHere() ? 'elsewhere' : isIos() && !isHomeScreenApp() ? 'ios-tab' : 'loading',
  )
  const [os, setOs] = useState<OneSignalApi | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (state !== 'loading' || os) return
    let live = true
    load()
      .then((api) => {
        if (!live) return
        // The SDK object is a class; handed to a setter bare, React would call it as an updater.
        setOs(() => api)
        setState(read(api))
      })
      .catch(() => live && setState('failed'))
    return () => {
      live = false
    }
  }, [state, os])

  useEffect(() => {
    if (!os) return
    const sync = () => setState(read(os))
    os.Notifications.addEventListener('permissionChange', sync)
    os.User.PushSubscription.addEventListener('change', sync)
    return () => {
      os.Notifications.removeEventListener('permissionChange', sync)
      os.User.PushSubscription.removeEventListener('change', sync)
    }
  }, [os])

  // Called straight from the tap: iOS shows the permission dialog only inside one.
  const turnOn = useCallback(async () => {
    if (!os) return
    setBusy(true)
    try {
      if (os.Notifications.permissionNative !== 'granted') await os.Notifications.requestPermission()
      if (os.Notifications.permissionNative === 'granted') await os.User.PushSubscription.optIn()
    } finally {
      setState(read(os))
      setBusy(false)
    }
  }, [os])

  const turnOff = useCallback(async () => {
    if (!os) return
    setBusy(true)
    try {
      await os.User.PushSubscription.optOut()
    } finally {
      setState(read(os))
      setBusy(false)
    }
  }, [os])

  return { state, busy, turnOn, turnOff }
}
