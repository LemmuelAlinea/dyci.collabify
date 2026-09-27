/**
 * The classes somebody teaches: the ones they own, and the ones whose space
 * holds them at Owner or Manager (co-teaching). As a PostgREST `or` filter,
 * or null when they hold no seat and professor_id alone answers it.
 *
 * Ids come from the database, never from input, so they need no escaping.
 */
export function teachingClassFilter(userId: string, spaceIds: string[]): string | null {
  if (spaceIds.length === 0) return null
  return `professor_id.eq.${userId},space_id.in.(${spaceIds.join(',')})`
}
