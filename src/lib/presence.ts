/** Seen within this long counts as online: one missed beat is allowed. */
export const ACTIVE_NOW_MS = 120_000

/** How often an open, visible tab stamps the person as seen. */
export const HEARTBEAT_MS = 60_000

export function isActiveNow(lastSeen: string, now: number): boolean {
  return now - Date.parse(lastSeen) <= ACTIVE_NOW_MS
}

/** "12m" for someone seen recently; null while they are active now. */
export function seenLabel(lastSeen: string, now: number): string | null {
  if (isActiveNow(lastSeen, now)) return null
  const minutes = Math.floor((now - Date.parse(lastSeen)) / 60_000)
  return `${Math.min(59, Math.max(2, minutes))}m`
}
