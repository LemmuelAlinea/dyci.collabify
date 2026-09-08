/**
 * Which origins may call the edge functions.
 *
 * Both functions were answering `Access-Control-Allow-Origin: *`. That is less
 * dangerous than it looks here — every call is authorised by the caller's own
 * JWT, read from `localStorage` and therefore unreachable to another site, so
 * there is no ambient credential for a cross-origin request to ride on. CORS
 * is the second lock on these, never the first.
 *
 * It is still worth closing. A wildcard means any page anywhere can drive the
 * AI endpoints with a token it obtained some other way — a copied header from
 * devtools, a shared machine — and the cost of that lands on the project's
 * Anthropic bill.
 *
 * **Set `ALLOWED_ORIGINS`** in Supabase → Edge Functions → Secrets, as a
 * comma-separated list of exact origins:
 *
 *   ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
 *
 * Until it is set this falls back to the wildcard rather than breaking a
 * running deploy. That is a deliberate trade: a function that starts refusing
 * every browser the moment this file ships would be a worse outage than the
 * thing it is guarding against. `corsMode()` reports which state it is in so
 * the choice is visible in the function logs rather than silent.
 */

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Without this a shared cache can hand one origin's allow-header to another.
  Vary: 'Origin',
}

export function corsMode(): string {
  return ALLOWED.length === 0
    ? 'ALLOWED_ORIGINS is unset — answering any origin. Set it to lock this down.'
    : `origins: ${ALLOWED.join(', ')}`
}

/**
 * Headers for this request, and whether it is allowed at all.
 *
 * A request with no `Origin` header is not a browser — curl, a server, the
 * Supabase function tester — and CORS has nothing to say about it. Those are
 * let through on the strength of the JWT check, which is the real gate.
 */
export function cors(req: Request): { headers: Record<string, string>; allowed: boolean } {
  const origin = req.headers.get('origin')

  if (!origin) return { headers: { ...BASE }, allowed: true }
  if (ALLOWED.length === 0) {
    return { headers: { ...BASE, 'Access-Control-Allow-Origin': '*' }, allowed: true }
  }
  if (ALLOWED.includes(origin)) {
    return { headers: { ...BASE, 'Access-Control-Allow-Origin': origin }, allowed: true }
  }
  // No allow-origin header at all: the browser blocks the read, and the body
  // below never reaches the calling page.
  return { headers: { ...BASE }, allowed: false }
}

/** The refusal, for an origin that is not on the list. */
export function denied(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ result: 'failed', message: 'Origin not allowed.' }), {
    status: 403,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
