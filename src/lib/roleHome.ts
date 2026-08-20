import type { AccountStatus, Role } from './types'

const HOME: Record<Role, string> = {
  student: '/student',
  professor: '/professor',
  admin: '/admin',
}

/** Where a signed-in user belongs right now. Pending professors are parked. */
export function roleHome(role: Role | undefined, status?: AccountStatus) {
  if (!role) return '/onboarding'
  if (status === 'pending' || status === 'rejected') return '/pending'
  return HOME[role]
}
