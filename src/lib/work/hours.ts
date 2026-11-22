/** Minutes as hours with at most one decimal: 840 -> "14 h", 90 -> "1.5 h". */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} h`
}

/**
 * Hours typed in the estimate field, as whole minutes. Empty is null (no
 * estimate); anything that is not a number from just above 0 to 1000 is 'invalid'.
 */
export function parseHours(text: string): number | null | 'invalid' {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid'
  const hours = Number(t)
  if (hours > 1000) return 'invalid'
  const minutes = Math.round(hours * 60)
  return minutes < 1 ? 'invalid' : minutes
}
