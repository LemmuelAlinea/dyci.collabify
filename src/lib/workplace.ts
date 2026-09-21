/**
 * The two workplaces, and where somebody belongs in them.
 *
 * One account uses both. `home_workplace` is only where sign-in lands; the
 * switcher in the top bar opens the other. Education needs a student or
 * professor role, which an account that registered for General does not have
 * until it enters Education once. General needs nothing but an active account.
 *
 * `rejected` is what the admin's Deactivate sets (supabase/accounts.sql), so it
 * closes both workplaces. `pending` is a professor waiting for approval, which
 * closes only Education.
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
  if (profile.status === 'rejected') return '/pending'
  if (!profile.role) return '/education/enter'
  if (profile.status === 'pending') return '/pending'
  return EDUCATION_HOME[profile.role]
}

export function homeFor(profile: HomeProfile | null | undefined): string {
  if (!profile) return '/onboarding'
  if (profile.status === 'rejected') return '/pending'
  if (profile.role === 'admin') return '/admin'
  if (profile.home_workplace === 'general') return '/general'
  return educationHome(profile)
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
