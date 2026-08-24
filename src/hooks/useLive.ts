import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Keep a page's data current without anybody pressing reload.
 *
 * Four things bring a page up to date, and they exist because each one covers a
 * case the others miss:
 *
 *   realtime      Somebody else changed a row. Arrives in about a second, and
 *                 is the only one that is genuinely live.
 *   focus         The tab was in the background while they worked elsewhere.
 *                 This is the one that actually matters most — the usual
 *                 complaint is coming back to a tab and finding it stale.
 *   visibility    The same thing on a phone, where switching apps fires
 *                 `visibilitychange` and never fires `focus`.
 *   poll          A safety net. Sockets drop on campus wifi, and a page that
 *                 silently stopped listening is worse than one that never did.
 *
 * The poll only runs while the tab is visible, so a forgotten tab costs
 * nothing.
 *
 * `load` is expected to be a `useCallback` — it goes in a ref rather than a
 * dependency, so a caller that rebuilds it every render does not tear the
 * subscription down and set it up again on every keystroke.
 */

/** Tables whose changes should refetch. RLS decides what actually arrives. */
export type LiveTable = string

/**
 * How many realtime channels one tab may hold open.
 *
 * Every hook that subscribes opens one, and a page rendering many live
 * components could open a dozen without anybody deciding to. Supabase counts
 * concurrent channels per connection, so the failure is not local — one tab
 * with a runaway list can exhaust the project's allowance for everybody else.
 *
 * Over the cap the page still works: the focus, visibility and poll paths all
 * carry on, so it degrades to "current within thirty seconds" rather than
 * breaking. That is the right trade — a stale page is a nuisance, a project
 * that has run out of connections is an outage.
 */
const MAX_CHANNELS = 12
let openChannels = 0

export function useLive(
  load: () => void | Promise<void>,
  tables: LiveTable[] = [],
  {
    /** Milliseconds between safety-net polls. */
    every = 30_000,
    enabled = true,
  }: { every?: number; enabled?: boolean } = {},
) {
  const ref = useRef(load)
  useEffect(() => {
    ref.current = load
  })

  const key = tables.join(',')

  // --- somebody else changed something
  useEffect(() => {
    if (!enabled || key === '') return
    if (openChannels >= MAX_CHANNELS) {
      console.warn(
        `[collabify] ${MAX_CHANNELS} realtime channels already open; this view ` +
          'will refresh on focus and on its poll instead.',
      )
      return
    }
    openChannels += 1
    const topic = `live:${key}:${Math.random().toString(36).slice(2)}`
    let channel = supabase.channel(topic)
    for (const table of key.split(',')) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => void ref.current(),
      )
    }
    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Not fatal: the poll below still brings the page up to date.
        console.warn(`[collabify] realtime ${status} on ${topic}`, err?.message ?? '')
      }
    })
    return () => {
      openChannels -= 1
      void supabase.removeChannel(channel)
    }
  }, [key, enabled])

  // --- they came back to the tab
  useEffect(() => {
    if (!enabled) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void ref.current()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [enabled])

  // --- the safety net
  useEffect(() => {
    if (!enabled || every <= 0) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void ref.current()
    }, every)
    return () => clearInterval(id)
  }, [every, enabled])
}
