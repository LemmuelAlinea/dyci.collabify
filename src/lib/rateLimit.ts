/**
 * Client-side throttling for the auth forms.
 *
 * **This is not a security control and must never be treated as one.** It
 * lives in localStorage, so anyone who wants past it can clear a key or open a
 * private window. The real limits are Supabase's, server-side, and
 * `authErrorMessage` already translates them when they fire.
 *
 * What this buys is the thing those limits cannot: telling somebody *before*
 * they submit that the attempt will not work, and how long the wait is. Before
 * it, holding the button on a wrong password sent request after request until
 * Supabase started answering "for security purposes, wait 47 seconds" — a
 * message that arrived only after the attempt, and named a number the form
 * never counted down.
 *
 * Failures are what count, not attempts. A person who signs in correctly on
 * the fifth try has done nothing wrong and should not be locked out for it,
 * so `clear` runs on every success.
 */

export type Action = 'signIn' | 'signUp' | 'passwordReset'

type Rule = {
  /** How many failures are allowed inside the window before the wait starts. */
  limit: number
  /** How long failures are remembered, in ms. */
  windowMs: number
  /** Waits applied at the 1st, 2nd, 3rd… breach, in ms. The last repeats. */
  backoffMs: number[]
}

const MIN = 60_000

/**
 * Sign-in is the loosest: a wrong password is usually a typo or an old
 * password, not an attack, and the account is not created or emailed by
 * failing. Signing up and resetting both send mail, which is the expensive and
 * abusable part, so they are stricter and their backoff climbs faster.
 */
const RULES: Record<Action, Rule> = {
  signIn: {
    limit: 5,
    windowMs: 15 * MIN,
    backoffMs: [30_000, 2 * MIN, 5 * MIN, 15 * MIN],
  },
  signUp: {
    limit: 3,
    windowMs: 60 * MIN,
    backoffMs: [MIN, 5 * MIN, 30 * MIN],
  },
  passwordReset: {
    limit: 3,
    windowMs: 15 * MIN,
    backoffMs: [MIN, 5 * MIN, 15 * MIN],
  },
}

type Entry = {
  /** Timestamps of failures still inside the window. */
  hits: number[]
  /** How many times the limit has been breached. Drives the backoff. */
  breaches: number
  /** When the current wait ends, or 0. */
  until: number
}

const PREFIX = 'collabify:rl:'

/**
 * Keyed by action and identifier so one person's mistyped password does not
 * lock a shared machine out of the whole form. Lower-cased because a person
 * retyping their address does not think of it as a different one.
 */
function keyFor(action: Action, identifier: string) {
  return PREFIX + action + ':' + identifier.trim().toLowerCase()
}

/** localStorage throws in private mode on some browsers, and may be absent. */
function read(key: string): Entry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Entry
    if (!Array.isArray(parsed.hits)) return null
    return parsed
  } catch {
    return null
  }
}

function write(key: string, entry: Entry) {
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // Storage unavailable. The server limits still apply; this layer is a
    // courtesy, so failing to persist must never block a real attempt.
  }
}

function drop(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Same reasoning as write.
  }
}

/**
 * Milliseconds the caller must wait, or 0 to proceed.
 *
 * `now` is injectable so the rules can be tested without waiting real minutes.
 */
export function retryAfter(action: Action, identifier: string, now = Date.now()): number {
  if (!identifier.trim()) return 0
  const entry = read(keyFor(action, identifier))
  if (!entry) return 0
  return entry.until > now ? entry.until - now : 0
}

/**
 * Record a failure and return the wait it triggers, 0 if there is room left.
 *
 * Call this only when the attempt genuinely failed in a way the person
 * controls — a wrong password, a rejected signup. A network error is not the
 * user's doing and must not count against them.
 */
export function recordFailure(action: Action, identifier: string, now = Date.now()): number {
  if (!identifier.trim()) return 0
  const rule = RULES[action]
  const key = keyFor(action, identifier)
  const entry = read(key) ?? { hits: [], breaches: 0, until: 0 }

  const hits = [...entry.hits.filter((t) => now - t < rule.windowMs), now]

  if (hits.length >= rule.limit) {
    const breaches = entry.breaches + 1
    // Past the end of the ladder the last rung repeats rather than growing
    // without bound — an hour-long lockout on a coursework tool is a support
    // ticket, not a defence.
    const wait = rule.backoffMs[Math.min(breaches, rule.backoffMs.length) - 1]
    // Hits reset on breach so the next window is counted fresh; the breach
    // count is what remembers the repetition.
    write(key, { hits: [], breaches, until: now + wait })
    return wait
  }

  write(key, { ...entry, hits })
  return 0
}

/** Forget everything for this action and identifier. Call on success. */
export function clearFailures(action: Action, identifier: string) {
  if (!identifier.trim()) return
  drop(keyFor(action, identifier))
}

/** How many attempts remain before the wait starts. For "2 tries left" copy. */
export function attemptsLeft(action: Action, identifier: string, now = Date.now()): number {
  if (!identifier.trim()) return RULES[action].limit
  const rule = RULES[action]
  const entry = read(keyFor(action, identifier))
  // No record is a clean slate, not a spent one — these two cases return
  // opposite numbers and collapsing them reported "0 tries left" to everybody
  // who had never touched the form.
  if (!entry) return rule.limit
  if (entry.until > now) return 0
  const live = entry.hits.filter((t) => now - t < rule.windowMs).length
  return Math.max(0, rule.limit - live)
}

/**
 * A wait as a phrase, for putting straight into a sentence.
 *
 * Rounds up: telling somebody to wait 0 seconds when 400ms remain reads as
 * broken, and a second of slack costs nothing.
 */
export function waitLabel(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * Thrown before a request goes out, so the form can say how long the wait is
 * rather than the server saying it afterwards. `authErrorMessage` passes an
 * unrecognised message through untouched, which is the point — this one is
 * already the sentence the person should read.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(`Too many attempts. Try again in ${waitLabel(retryAfterMs)}.`)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}
