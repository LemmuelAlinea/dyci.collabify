import { isMemberRole } from '../lib/access'
import type { Role } from '../lib/types'

export type GateProfile = { role: Role | null; status: 'active' | 'pending' | 'rejected' }

export type GateResult = 'ok' | '/login' | '/onboarding' | '/pending' | '/home'

/**
 * The one decision every signed-in route makes, pulled out so it can be
 * tested as a pure function instead of through a rendered route tree.
 *
 * `open` stops the check right after the rejected-account test — Settings and
 * the privacy request are owed to any signed-in, non-rejected account, admitted
 * or not. Everything else also needs the account to be admitted (active, with a
 * role), and `allow` narrows further to the roles a page is actually for. A
 * legacy `faculty` account is matched as a `member`.
 */
export function gate(
  hasSession: boolean,
  profile: GateProfile | null | undefined,
  { open, allow }: { open?: boolean; allow?: Role[] } = {},
): GateResult {
  if (!hasSession) return '/login'
  if (!profile) return '/onboarding'
  if (profile.status === 'rejected') return '/pending'
  if (open) return 'ok'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  const role = isMemberRole(profile.role) ? 'member' : profile.role
  if (allow && !allow.includes(role)) return '/home'
  return 'ok'
}
