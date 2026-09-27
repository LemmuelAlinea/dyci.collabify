/**
 * Where an admitted account lands.
 *
 * `home_workplace` only ever mattered while there were two workplaces to
 * choose between; one shell now covers both, so this keeps just the one
 * decision that is still real: `pending` (faculty waiting on the admin),
 * `rejected` (turned down or deactivated) and an account with no role at all
 * all land on /pending, which says which of the three it is.
 */
import type { Profile } from './types'

export type Workplace = 'education' | 'general'

export type HomeProfile = Pick<Profile, 'role' | 'status' | 'home_workplace'>

export function homeFor(profile: HomeProfile | null | undefined): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return '/home'
}
