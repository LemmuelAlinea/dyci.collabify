/**
 * A class invite link, and the code it carries across signing in.
 *
 * Somebody who opens /join/ABC-1234 signed out has to register or sign in
 * first, and the email confirmation can land in a different tab. The code waits
 * in localStorage until the first page that can use it does. It is a class
 * code, which the class already shows to everybody in it, so nothing secret
 * is kept.
 */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY = 'collabify.pendingJoin'

function browserStore(): KeyStore | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

export function joinPath(code: string) {
  return `/join/${encodeURIComponent(normalizeCode(code))}`
}

export function inviteLink(code: string, origin: string) {
  return `${origin}${joinPath(code)}`
}

export function rememberJoin(code: string, s: KeyStore | undefined = browserStore()) {
  try {
    s?.setItem(KEY, normalizeCode(code))
  } catch {
    // Private windows and blocked storage: the link just has to be opened again.
  }
}

export function pendingJoin(s: KeyStore | undefined = browserStore()): string | null {
  try {
    return s?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function forgetJoin(s: KeyStore | undefined = browserStore()) {
  try {
    s?.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
