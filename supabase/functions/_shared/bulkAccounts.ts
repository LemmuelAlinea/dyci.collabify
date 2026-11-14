export type BulkUser = {
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  role: 'student' | 'member'
  /** An office name, matched on the server. Only set when the row names one. */
  office?: string
}

export const BULK_MAX_ROWS = 100
export const BULK_CHUNK_SIZE = 20

export type BulkResult = {
  row: number
  email: string
  status: 'created' | 'updated' | 'skipped' | 'failed'
  reason?: string
  warning?: string
}

/**
 * The warning for a row whose office matches no live office. A new account is imported
 * with none; an updated one keeps the office it had. Office names hold 80 characters at
 * most, so a longer one is echoed cut to 80 with an ellipsis, which ends the sentence.
 */
export function unknownOfficeWarning(name: string, status: 'created' | 'updated'): string {
  const named = name.length > 80 ? `${name.slice(0, 80)}…` : `${name}.`
  const outcome = status === 'updated' ? 'Office left as it was.' : 'Imported with no office.'
  return `No office named ${named} ${outcome}`
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

/** The school domain as a regex fragment, every dot and other symbol taken literally. */
function domainPattern(domain: string): string {
  return domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeBulkUser(value: unknown, domain: string): { user?: BulkUser; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'This row is not a user.' }
  }
  const row = value as Record<string, unknown>
  const first_name = typeof row.first_name === 'string' ? row.first_name.trim() : ''
  const middle_name = typeof row.middle_name === 'string' ? row.middle_name.trim() : ''
  const last_name = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
  const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : ''
  const office = typeof row.office === 'string' ? row.office.trim() : ''

  if (!first_name || !last_name) return { error: 'First and last name are required.' }
  if ([first_name, middle_name, last_name].some((name) => name.length > 80)) {
    return { error: 'Each name must be 80 characters or fewer.' }
  }
  const school = domain.trim().toLowerCase()
  if (email.length > 254 || !new RegExp(`^[a-z0-9._%+-]+@${domainPattern(school)}$`).test(email)) {
    return { error: `Use a valid @${school} email.` }
  }
  if (role !== 'student' && role !== 'member') {
    return { error: 'Role must be student or member.' }
  }
  const user: BulkUser = { first_name, middle_name: middle_name || null, last_name, email, role }
  if (office) user.office = office
  return { user }
}
