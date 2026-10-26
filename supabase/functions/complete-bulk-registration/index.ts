import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, denied } from '../_shared/cors.ts'
import { bulkPasswordError } from '../_shared/bulkAccounts.ts'

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const { headers, allowed } = cors(req)
  if (!allowed) return denied(headers)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json(headers, { message: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return json(headers, { message: 'Sign in first.' }, 401)

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('id,status,bulk_setup_required').eq('id', user.id).single()
  if (profileError || !profile?.bulk_setup_required || profile.status !== 'pending' ||
      user.app_metadata?.bulk_registration !== true) {
    return json(headers, { message: 'This account does not need first-time setup.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    const value = await req.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body')
    body = value as Record<string, unknown>
  } catch {
    return json(headers, { message: 'Enter a new password.' }, 400)
  }
  const passwordError = bulkPasswordError(body.newPassword, false)
  if (passwordError) return json(headers, { message: passwordError }, 400)

  const today = new Date().toISOString().slice(0, 10)
  const { data: versions, error: versionError } = await admin.from('legal_versions')
    .select('document,version,effective_on').lte('effective_on', today)
    .order('effective_on', { ascending: false })
  if (versionError) return json(headers, { message: 'Could not check the current terms. Try again.' }, 500)
  const current = new Map<string, string>()
  for (const row of versions ?? []) {
    if (!current.has(row.document)) current.set(row.document, row.version)
  }
  const { data: consent, error: consentError } = await admin.from('consent_records')
    .select('document,version').eq('user_id', user.id).is('withdrawn_at', null)
  if (consentError) return json(headers, { message: 'Could not check your consent. Try again.' }, 500)
  if (!['terms', 'privacy'].every((document) =>
    current.has(document) && consent?.some((row) => row.document === document && row.version === current.get(document)))) {
    return json(headers, { message: 'Accept the current terms and privacy policy first.' }, 409)
  }

  const { error: passwordUpdateError } = await admin.auth.admin.updateUserById(user.id, {
    password: body.newPassword as string,
  })
  if (passwordUpdateError) return json(headers, { message: 'Could not update the password. Try again.' }, 500)
  const { error: activationError } = await admin.from('profiles')
    .update({ status: 'active', bulk_setup_required: false })
    .eq('id', user.id).eq('bulk_setup_required', true)
  if (activationError) return json(headers, { message: 'Password updated. Finish setup again to activate your account.' }, 500)
  return json(headers, { result: 'complete' })
})
