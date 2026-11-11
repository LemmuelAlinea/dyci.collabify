# Device push notifications (OneSignal)

## Why

Everything Collabify notifies about lands under the bell, and only while the site is open. People
asked for real notifications that reach a phone, tablet or computer even when Collabify is closed.
The professor recommended OneSignal; its web push is free at this size (up to 10,000 subscribers per
send; the 2026 1,000-MAU cap applies to mobile-app push and in-app messages, not web push).

## Goals

- Every row written to `public.notifications` also reaches every device the recipient turned on.
- Works on desktop Chrome, Edge, Firefox and Safari, Android, and iPhone/iPad on iOS 16.4+ once
  Collabify is on the Home Screen.
- The person turns it on per device, from Settings → Notifications, with a button tap.
- Tapping a push opens the same page the bell would.

## Non-goals

- No new notification kinds, no push-only preferences. The existing switches in
  `notification_prefs` already decide which rows get written, so a push follows the same choice.
- No native app, no email or SMS channel.

## Anti-goals

- A push must never block or fail the change that wrote the notification.
- No surprise permission popup on page load (iOS refuses it anyway, and it nags).
- A shared computer must not keep receiving the previous person's notifications after sign-out.
- The OneSignal REST API key never appears in frontend code, Vercel or a committed file.

## How

**Dashboard (done by the user):** OneSignal app "Collabify", Typical site,
`https://dyci-collabify.vercel.app`, App ID `f3a232e0-d87f-4ddf-9da5-40b0e65d22ac`, one slide
prompt with auto-prompt off, click behavior Same origin + Navigate.

**Sending — `supabase/push-notifications.sql`:** an `after insert` trigger on
`public.notifications` calls `send_notification_push(row)`, which reads the REST API key from the
Vault (`collabify_onesignal_rest_key`) and posts to `https://api.onesignal.com/notifications`
with `pg_net` (asynchronous, so the insert never waits). Target: `include_aliases.external_id =
[user_id]`, `target_channel = push`. Title is the notification title, body its preview (or the
title), `url` is `https://dyci-collabify.vercel.app/n/<notification id>`, `idempotency_key` the
notification id. Without the Vault secret the trigger does nothing. Any error is swallowed with a
warning. The file stands alone (nothing earlier owns the trigger) and runs before
`anon-lockdown.sql`.

**Opening — `/n/:id`:** a small redirect route inside the signed-in shell. It reads the
notification, marks it read and replaces itself with `destination(...)`, the bell's own rule. A
missing row goes to Home. It is a redirect, so it gets no nav entry.

**Device — `src/lib/push.ts`:** loads the OneSignal v16 SDK only on the production origin, only
for an active, admitted account, then `OneSignal.login(profile.id)` so the database can target the
user id. Sign-out calls `OneSignal.logout()` before the session ends. `public/OneSignalSDKWorker.js`
imports OneSignal's worker from its CDN.

**Settings → Notifications → "This device":** one row with its state:
on (Turn off), off (Turn on → `Notifications.requestPermission()` inside the tap), blocked (how to
unblock in the browser), iPhone/iPad in a browser tab (Add to Home Screen steps), unsupported, or
not available on this address (localhost and previews).

**Home Screen app:** `public/manifest.webmanifest` (`display: standalone`, PNG icons 192 and 512)
plus `apple-touch-icon` (180) and the manifest link in `index.html`. iOS needs this to allow push
at all.

**CSP:** the report-only policy in `vercel.json` gains OneSignal's CDN and API hosts so the report
stays accurate.

## Calls made by the builder (not asked)

- `pg_net` straight to OneSignal instead of an Edge Function: one less deploy, same secret hygiene.
- Push copies every notification row, gated only by the existing preferences.
- Only the production origin loads the SDK; OneSignal refuses any other origin.
- Icons on navy brand ground, so the white link stays visible on light notification trays.

## Rollout

1. Store the REST API key in the Vault (the user runs one command; the key never passes through chat).
2. Apply `push-notifications.sql`, then `anon-lockdown.sql`.
3. Push the frontend after review. Test: turn on in Settings on a desktop and an Android phone,
   add to Home Screen on an iPhone and turn on there, then trigger a notification.
