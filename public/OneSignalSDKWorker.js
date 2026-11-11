/* global importScripts */
/*
 * Collabify's one service worker, at the root scope. Two jobs:
 *
 * 1. Device push. OneSignal's SDK registers this same file, so its code is
 *    loaded here. A failed load (offline, CDN down) must not stop the worker
 *    installing, or the job below would go with it; push comes back on the
 *    next update check.
 * 2. Installing the app. Chrome only offers its install prompt to a site whose
 *    worker handles fetches (an empty handler is ignored). This one answers
 *    page loads only, straight from the network, and shows a short offline
 *    page when there is none. Files, data and the API are never touched.
 *    src/lib/install.ts registers it for everyone on the live site.
 */
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js')
} catch {
  // See above: the install job still stands.
}

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#080b21"><title>Offline · Collabify</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b21;color:#fdf8ec;
font:16px/1.6 system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}
p{margin:0 0 20px;color:#c9cbe0}button{font:600 15px system-ui,sans-serif;padding:12px 20px;border:0;
border-radius:12px;background:#f0b429;color:#080b21}</style></head><body><main>
<h1>You are offline</h1><p>Collabify needs a connection. Check your Wi-Fi or data, then try again.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        return preloaded || (await fetch(event.request))
      } catch {
        return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
    })(),
  )
})
