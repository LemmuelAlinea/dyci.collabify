export type BulkUser = {
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  role: 'student' | 'member'
}

export const BULK_MAX_ROWS = 100
export const BULK_CHUNK_SIZE = 20

export type BulkResult = {
  row: number
  email: string
  status: 'created' | 'updated' | 'skipped' | 'failed'
  reason?: string
}

export function isActiveBulkAdmin(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false
  const row = profile as Record<string, unknown>
  return row.role === 'admin' && row.status === 'active'
}

export function bulkPasswordError(password: unknown, temporary = true): string | null {
  if (typeof password !== 'string') return 'Enter a password.'
  const minimum = temporary ? 12 : 8
  if (!password.trim() || password.length < minimum || password.length > 128) {
    return `Use ${minimum} to 128 characters for the password.`
  }
  return null
}

export function bulkSetupChoice(body: Record<string, unknown>): { password?: string; error?: string } {
  if (body.deferPasswordChange === true) {
    return 'newPassword' in body
      ? { error: 'Choose whether to change your password now or later.' }
      : {}
  }
  const error = bulkPasswordError(body.newPassword, false)
  return error ? { error } : { password: body.newPassword as string }
}

export function normalizeBulkUser(value: unknown): { user?: BulkUser; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'This row is not a user.' }
  }
  const row = value as Record<string, unknown>
  const first_name = typeof row.first_name === 'string' ? row.first_name.trim() : ''
  const middle_name = typeof row.middle_name === 'string' ? row.middle_name.trim() : ''
  const last_name = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
  const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : ''

  if (!first_name || !last_name) return { error: 'First and last name are required.' }
  if ([first_name, middle_name, last_name].some((name) => name.length > 80)) {
    return { error: 'Each name must be 80 characters or fewer.' }
  }
  if (email.length > 254 || !/^[a-z0-9._%+-]+@dyci\.edu\.ph$/.test(email)) {
    return { error: 'Use a valid @dyci.edu.ph email.' }
  }
  if (role !== 'student' && role !== 'member') {
    return { error: 'Role must be student or member.' }
  }
  return { user: { first_name, middle_name: middle_name || null, last_name, email, role } }
}
