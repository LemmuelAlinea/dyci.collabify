/**
 * The two workplaces, and where somebody belongs in them.
 *
 * One account uses both. `home_workplace` is only where sign-in lands; the
 * switcher in the top bar opens the other. Neither opens until somebody has
 * admitted the account: the admin approves faculty, and a student is let in by
 * the class they join.
 *
 * `pending` (faculty waiting on the admin), `rejected` (turned down or
 * deactivated) and an account with no role at all all land on /pending, which
 * says which of the three it is.
 */
import type { Profile, Role } from './types'

export type Workplace = 'education' | 'general'

export type HomeProfile = Pick<Profile, 'role' | 'status' | 'home_workplace'>

const EDUCATION_HOME: Record<Role, string> = {
  student: '/student',
  professor: '/professor',
  admin: '/admin',
}

export function educationHome(profile: HomeProfile): string {
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return EDUCATION_HOME[profile.role]
}

export function homeFor(profile: HomeProfile | null | undefined): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  if (profile.role === 'admin') return '/admin'
  if (profile.home_workplace === 'general') return '/general'
  return EDUCATION_HOME[profile.role]
}

export function workplaceOf(pathname: string, home: Workplace): Workplace {
  if (pathname === '/general' || pathname.startsWith('/general/')) return 'general'
  if (/^\/(student|professor|admin|education)(\/|$)/.test(pathname)) return 'education'
  return home
}

export function settingsPathFor(workplace: Workplace, role: Role | null): string {
  if (workplace === 'general') return '/general/settings'
  return role ? `/${role}/settings` : '/settings'
}
