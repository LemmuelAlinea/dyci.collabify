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

export type OrgSettingsState = { settings: OrgSettings; status: 'loading' | 'ready' | 'failed' }

const LOADING: OrgSettingsState = { settings: ORG_DEFAULTS, status: 'loading' }
let current: OrgSettingsState = LOADING
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: OrgSettingsState) {
  current = next
  listeners.forEach((listener) => listener())
}

function load() {
  if (loaded || inflight) return
  inflight = getOrganizationSettings()
    .then((row) => {
      loaded = true
      publish({ settings: row, status: 'ready' })
    })
    .catch(() => {
      publish({ settings: ORG_DEFAULTS, status: 'failed' })
    })
    .finally(() => {
      inflight = null
    })
}

/** Keeps the shared copy current after the admin saves, so open pages update at once. */
export function setOrgSettingsCache(next: OrgSettings) {
  loaded = true
  publish({ settings: next, status: 'ready' })
}

/** Clears the shared copy. Tests use it between cases. */
export function resetOrgSettingsCache() {
  current = LOADING
  loaded = false
  inflight = null
}

/** Reads again after a failed read. */
function retry() {
  if (current.status !== 'failed') return
  publish(LOADING)
  load()
}

/**
 * The settings with whether they have arrived. Use it where a wrong default would do harm; a
 * failed read stays `failed` until `retry` succeeds.
 */
export function useOrgSettingsState(): OrgSettingsState & { retry: () => void } {
  useEffect(load, [])
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
    () => LOADING,
  )
  return { ...state, retry }
}

/**
 * The organization settings, read once and shared by every component. While loading or after a
 * failed read it holds today's defaults, which is right for display-only copy.
 */
export function useOrgSettings(): OrgSettings {
  return useOrgSettingsState().settings
}

/** "1 day" or "30 days". */
export function dayCount(days: number) {
  return days === 1 ? '1 day' : `${days} days`
}
