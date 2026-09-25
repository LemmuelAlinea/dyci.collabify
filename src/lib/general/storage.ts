/** The requested paths Storage did not report removing, whether missing or refused. */
export function pathsNotRemoved(requested: string[], removed: { name: string }[] | null) {
  const gone = new Set((removed ?? []).map((o) => o.name))
  return requested.filter((p) => !gone.has(p))
}

export const ROW_LEFT = 'The file was removed, but its entry is still in the archive. Delete it again to clear it.'

const REFUSED = new Set(['42501', '23514'])

/**
 * What to throw when the row delete fails after the objects step. A refusal keeps
 * its own message, since this call may have removed nothing.
 */
export function rowDeleteError<E extends { code?: string }>(error: E, removed: number): E | Error {
  if (error.code && REFUSED.has(error.code)) return error
  return removed > 0 ? new Error(ROW_LEFT) : error
}
