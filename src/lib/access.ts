/**
 * Who may do what, as the screens need to know it.
 *
 * The database decides; these only keep a screen from offering what it would
 * refuse. Each mirrors a function in supabase/access.sql of the same meaning.
 */
import type { Profile } from './types'

export type AccessProfile = Pick<Profile, 'role' | 'status' | 'can_teach'> | null | undefined

/** Approved faculty, and the admin. Mirrors `is_faculty`. */
export function isFaculty(p: AccessProfile): boolean {
  return Boolean(p && p.status === 'active' && (p.role === 'professor' || p.role === 'admin'))
}

/** Faculty the admin lets open classes. Mirrors `is_teaching_faculty`. */
export function canTeach(p: AccessProfile): boolean {
  return isFaculty(p) && Boolean(p?.can_teach)
}
