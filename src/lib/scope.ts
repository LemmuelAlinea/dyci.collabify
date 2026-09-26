/**
 * The All · Classes · Work filter shared by Messages, My tasks and Calendar.
 *
 * One list per page, filtered by a `?show=` query param rather than a
 * separate route or tab per audience.
 */
export type Scope = 'all' | 'classes' | 'work'

const SCOPES: Scope[] = ['classes', 'work']

/** Reads `?show=`; anything other than a known scope defaults to 'all'. */
export function readScope(params: URLSearchParams): Scope {
  const raw = params.get('show')
  return (SCOPES as string[]).includes(raw ?? '') ? (raw as Scope) : 'all'
}

/** Writes `?show=`; 'all' removes the key rather than writing it out. */
export function writeScope(params: URLSearchParams, scope: Scope): URLSearchParams {
  const next = new URLSearchParams(params)
  if (scope === 'all') next.delete('show')
  else next.set('show', scope)
  return next
}
