/**
 * Supabase auth failures arrive in several shapes, and one of them is actively
 * unhelpful: for any HTTP 5xx, auth-js throws AuthRetryableFetchError whose
 * message is `JSON.stringify(response)` — the literal string "{}". So a real
 * server fault (a failed confirmation email, most often) reached the user as
 * "{}" with nothing to act on. Everything funnels through here instead.
 */

type Unknownish = {
  message?: unknown
  msg?: unknown
  error_description?: unknown
  error?: unknown
  status?: unknown
  name?: unknown
}

/** auth-js stringifies objects it cannot read; these carry no information. */
const EMPTY_STRINGIFIED = /^(\{\s*\}|\[\s*\]|null|undefined)$/

function rawMessage(err: unknown): string {
  const pick = (v: unknown) =>
    typeof v === 'string' && v.trim() && !EMPTY_STRINGIFIED.test(v.trim()) ? v.trim() : ''

  if (typeof err === 'string') return pick(err)
  if (err instanceof Error) {
    const fromMessage = pick(err.message)
    if (fromMessage) return fromMessage
  }
  if (err && typeof err === 'object') {
    const o = err as Unknownish
    for (const v of [o.message, o.msg, o.error_description, o.error]) {
      const hit = pick(v)
      if (hit) return hit
    }
  }
  return ''
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const s = (err as Unknownish).status
    if (typeof s === 'number') return s
  }
  return undefined
}

/** Longest-match-first, so "email rate limit exceeded" wins over "rate limit". */
const KNOWN: [RegExp, string][] = [
  [
    /error sending (confirmation|recovery|magic link|invite) email/i,
    "We couldn't send that email. The mail service isn't accepting sends right now — try again shortly, or use Continue with Google.",
  ],
  [
    /email rate limit exceeded|over_email_send_rate_limit/i,
    'Too many emails have gone out in the last hour. Wait a few minutes and try again.',
  ],
  [
    /for security purposes.*after \d+ seconds?/i,
    'That was too soon after the last attempt. Wait a moment and try again.',
  ],
  [
    /invalid login credentials/i,
    'That email and password do not match. Try again, or reset your password.',
  ],
  [
    /user already registered|already been registered/i,
    // Reached only if something calls this on a signup failure without going
    // through `isAlreadyRegistered` first. Says nothing either way.
    'That address cannot be used to create a new account here. If it is yours, sign in or reset your password.',
  ],
  [/email not confirmed/i, 'Confirm your email first — open the link we sent before signing in.'],
  [/password should be at least \d+/i, 'That password is too short. Use at least 8 characters.'],
  [
    /new password should be different/i,
    'Pick a password you have not used on this account before.',
  ],
  [
    /database error saving new user/i,
    'Your account could not be created. This is a setup problem on our side, not something you did.',
  ],
  [
    /failed to fetch|networkerror|load failed/i,
    'Could not reach the server. Check your connection and try again.',
  ],
  [
    // Every unique index in this product is over a name, so one line covers
    // them. Without it the raw Postgres constraint name reached the user.
    /duplicate key value violates unique constraint/i,
    'That name is already used here. Pick another one.',
  ],
]

/**
 * Whether a signup failed because the address is already taken.
 *
 * Exported so `Register` can send that case down the same path as success
 * instead of reporting it. Answering the question at all makes the form an
 * account oracle — see the note at the call site.
 */
export function isAlreadyRegistered(err: unknown): boolean {
  return /user already registered|already been registered/i.test(rawMessage(err))
}

export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Try again.') {
  const raw = rawMessage(err)

  if (raw) {
    for (const [pattern, friendly] of KNOWN) {
      if (pattern.test(raw)) return friendly
    }
    return raw
  }

  // No usable text. A 5xx here is almost always the mail step failing, since
  // that is the only outbound dependency in the signup and reset flows.
  const status = statusOf(err)
  if (status && status >= 500) {
    return "The server couldn't finish that request. If you were signing up or resetting a password, the email service is the usual cause — try again shortly, or use Continue with Google."
  }
  if (status === 0) return 'Could not reach the server. Check your connection and try again.'

  return fallback
}
