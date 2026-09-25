/** The requested paths Storage did not report removing, whether missing or refused. */
export function pathsNotRemoved(requested: string[], removed: { name: string }[] | null) {
  const gone = new Set((removed ?? []).map((o) => o.name))
  return requested.filter((p) => !gone.has(p))
}
