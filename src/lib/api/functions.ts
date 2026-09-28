import { supabase } from '../supabase'

/**
 * Call an edge function and get its answer back, refusals included.
 *
 * Every function here answers `{ result: 'failed', message }` when it refuses
 * (an hourly limit, a missing permission, nothing to read), often with a 4xx
 * status. supabase-js turns any non-2xx into a bare "Edge Function returned a
 * non-2xx status code" and leaves the body on the error's `context`. That
 * message tells nobody anything, so the body is read back out and returned
 * like any other answer. A failure with no readable body still throws.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const parsed = await context.clone().json().catch(() => null)
      if (parsed && typeof parsed.message === 'string') return parsed as T
    }
    throw error
  }
  return data as T
}
