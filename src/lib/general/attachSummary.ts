/** One toast line for the result. */
export function attachSummary({ added, failed }: { added: string[]; failed: { path: string; reason: string }[] }) {
  const done = added.length === 1 ? '1 file added' : `${added.length} files added`
  if (failed.length === 0) return { message: done, tone: 'success' as const }
  const first = `${failed[0].path} (${failed[0].reason})`
  const rest = failed.length > 1 ? ` and ${failed.length - 1} more` : ''
  return {
    message: `${added.length > 0 ? `${done}. ` : ''}Not attached: ${first}${rest}.`,
    tone: 'error' as const,
  }
}
