import { useEffect, useSyncExternalStore } from 'react'
import { getOrganizationSettings } from '../lib/api/orgSettings'
import type { OrgSettings } from '../lib/api/orgSettings'

/** What the app used before the settings existed; shown while loading or when the read fails. */
export const ORG_DEFAULTS: OrgSettings = {
  quiet_days: 14,
  trash_retention_days: 30,
  new_project_visibility: 'private',
  school_email_domain: 'dyci.edu.ph',
}

let current: OrgSettings = ORG_DEFAULTS
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: OrgSettings) {
  current = next
  listeners.forEach((listener) => listener())
}

function load() {
  if (loaded || inflight) return
  inflight = getOrganizationSettings()
    .then((row) => {
      loaded = true
      publish(row)
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
}

/** Keeps the shared copy current after the admin saves, so open pages update at once. */
export function setOrgSettingsCache(next: OrgSettings) {
  loaded = true
  publish(next)
}

/** Clears the shared copy. Tests use it between cases. */
export function resetOrgSettingsCache() {
  current = ORG_DEFAULTS
  loaded = false
  inflight = null
}

/**
 * The organization settings, read once and shared by every component. A failed read leaves the
 * defaults in place and the next mount tries again.
 */
export function useOrgSettings(): OrgSettings {
  useEffect(load, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
    () => ORG_DEFAULTS,
  )
}

/** "1 day" or "30 days". */
export function dayCount(days: number) {
  return days === 1 ? '1 day' : `${days} days`
}
