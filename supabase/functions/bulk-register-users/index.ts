import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, denied } from '../_shared/cors.ts'
import {
  BULK_CHUNK_SIZE,
  bulkPasswordError,
  isActiveBulkAdmin,
  normalizeBulkUser,
} from '../_shared/bulkAccounts.ts'
import type { BulkResult } from '../_shared/bulkAccounts.ts'

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
    .select('role,status').eq('id', user.id).single()
  if (profileError || !isActiveBulkAdmin(profile)) {
    return json(headers, { message: 'Only an active admin can register users.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 64_000) throw new Error('Too large')
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body')
    body = value as Record<string, unknown>
  } catch {
    return json(headers, { message: 'Send a valid import of up to 20 users.' }, 400)
  }
  if (!Array.isArray(body.users) || body.users.length < 1 || body.users.length > BULK_CHUNK_SIZE) {
    return json(headers, { message: 'Send 1 to 20 users at a time.' }, 400)
  }
  const passwordError = bulkPasswordError(body.defaultPassword)
  if (passwordError) return json(headers, { message: passwordError }, 400)
  const password = body.defaultPassword as string

  const results: BulkResult[] = []
  const seen = new Set<string>()
  for (let index = 0; index < body.users.length; index++) {
    const raw = body.users[index]
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const row = Number.isInteger(item.row) ? item.row as number : index + 1
    const normalized = normalizeBulkUser(item)
    const email = normalized.user?.email ?? (typeof item.email === 'string' ? item.email.trim().toLowerCase() : '')
    if (!normalized.user) {
      results.push({ row, email, status: 'skipped', reason: normalized.error })
      continue
    }
    if (seen.has(email)) {
      results.push({ row, email, status: 'skipped', reason: 'Duplicate email in this batch.' })
      continue
    }
    seen.add(email)

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: normalized.user.first_name,
        middle_name: normalized.user.middle_name,
        last_name: normalized.user.last_name,
        role: normalized.user.role,
      },
      app_metadata: { bulk_registration: true },
    })
    if (!error) {
      results.push({ row, email, status: 'created' })
    } else if (error.code === 'email_exists' || error.code === 'user_already_exists' ||
               /already.*(registered|exists)|email.*(already|exists)/i.test(error.message)) {
      results.push({ row, email, status: 'skipped', reason: 'Account already exists.' })
    } else {
      results.push({ row, email, status: 'failed', reason: 'Could not create this account. Retry this row.' })
    }
  }
  return json(headers, { results })
})
