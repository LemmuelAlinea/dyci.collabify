import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { cors, denied } from '../_shared/cors.ts'
import {
  BULK_CHUNK_SIZE,
  bulkPasswordError,
  isActiveBulkAdmin,
  normalizeBulkUser,
  unknownOfficeWarning,
} from '../_shared/bulkAccounts.ts'
import type { BulkResult, BulkUser } from '../_shared/bulkAccounts.ts'

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * Files a member into the office the row names, with the admin's own rights. A
 * blank office calls nothing, so an overwrite keeps the current office. An
 * unknown name or a student's office warns and changes no office: a new account
 * has none, an updated one keeps the office it had.
 */
async function fileOffice(
  caller: SupabaseClient,
  result: BulkResult,
  user: BulkUser,
): Promise<BulkResult> {
  if (!user.office) return result
  if (user.role === 'student') return { ...result, warning: 'Students have no office. It was ignored.' }
  // A new account is imported with no office; an updated one keeps the office it had.
  const unknown = unknownOfficeWarning(user.office, result.status === 'updated' ? 'updated' : 'created')
  // Office names hold 80 characters at most, so a longer one names nothing. Skip it
  // with the unknown-office warning, echoing only the first 80 characters.
  if (user.office.length > 80) return { ...result, warning: unknown }
  const { data, error } = await caller.rpc('set_member_office_by_name', {
    p_email: user.email,
    p_office_name: user.office,
  })
  if (error) return { ...result, warning: 'The office could not be set. Set it on Accounts.' }
  if (data === 'unknown_office') return { ...result, warning: unknown }
  if (data !== 'set') return { ...result, warning: 'The office could not be set. Set it on Accounts.' }
  return result
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
  if (body.users.some((item) => !item || typeof item !== 'object' || item.overwrite !== true)) {
    const passwordError = bulkPasswordError(body.defaultPassword)
    if (passwordError) return json(headers, { message: passwordError }, 400)
  }
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

    if (item.overwrite === true) {
      const { error } = await caller.rpc('overwrite_bulk_account', {
        p_email: email,
        p_first_name: normalized.user.first_name,
        p_middle_name: normalized.user.middle_name,
        p_last_name: normalized.user.last_name,
        p_role: normalized.user.role,
      })
      results.push(error
        ? { row, email, status: 'failed', reason: error.message }
        : await fileOffice(caller, { row, email, status: 'updated' }, normalized.user))
      continue
    }

    const { data, error } = await admin.auth.admin.createUser({
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
      if (!data.user) {
        results.push({ row, email, status: 'failed', reason: 'Could not verify this account. Contact an admin before sharing its password.' })
        continue
      }
      const { error: setupError } = await admin.from('profiles')
        .update({ status: 'pending', bulk_setup_required: true })
        .eq('id', data.user.id)
        .select('id')
        .single()
      results.push(setupError
        ? { row, email, status: 'failed', reason: 'Account created, but setup could not be required. Contact an admin before sharing its password.' }
        : await fileOffice(caller, { row, email, status: 'created' }, normalized.user))
    } else if (error.code === 'email_exists' || error.code === 'user_already_exists' ||
               /already.*(registered|exists)|email.*(already|exists)/i.test(error.message)) {
      results.push({ row, email, status: 'skipped', reason: 'Account already exists.' })
    } else {
      results.push({ row, email, status: 'failed', reason: 'Could not create this account. Retry this row.' })
    }
  }
  return json(headers, { results })
})
