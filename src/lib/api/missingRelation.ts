// src/lib/api/missingRelation.ts

/**
 * Whether an error says a table is not there yet: PostgREST's schema-cache
 * miss, Postgres's undefined_table, or a message naming the table. Used so a
 * page still loads before a new SQL file is applied.
 */
export function isMissingRelation(err: unknown, name: string): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (code === 'PGRST205' || code === '42P01') return true
  if (typeof message !== 'string' || !message.includes(name)) return false
  return /does not exist|schema cache/i.test(message)
}

/** Whether an error says a column is not there yet (undefined_column, or PostgREST's missing column). */
export function isMissingColumn(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (code === '42703' || code === 'PGRST204') return true
  return typeof message === 'string' && /column .* does not exist/i.test(message)
}
