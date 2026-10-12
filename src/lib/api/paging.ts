export const PAGE_SIZE = 1000

/**
 * Every row of a read, a page at a time. The caller's query must have a stable
 * order, or rows can repeat or go missing between pages.
 * Offset paging can still repeat or skip a row inserted mid-read; the next live
 * reload corrects it.
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  size = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = await fetchPage(from, from + size - 1)
    out.push(...rows)
    if (rows.length < size) return out
  }
}
