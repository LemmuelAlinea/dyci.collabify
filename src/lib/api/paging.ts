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

/** Ids sent in one `.in()` filter. Thousands of uuids make a URL the server refuses. */
export const ID_CHUNK = 100

/**
 * Every row matching a list of ids: the ids go in chunks of at most
 * `ID_CHUNK`, and each chunk is paged. Chunks are read in turn; the caller
 * orders the rows it gets back.
 */
export async function pageAllIn<T>(
  ids: string[],
  fetchPage: (chunk: string[], from: number, to: number) => Promise<T[]>,
  size = PAGE_SIZE,
): Promise<T[]> {
  const unique = [...new Set(ids)]
  const out: T[] = []
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK)
    out.push(...(await pageAll((from, to) => fetchPage(chunk, from, to), size)))
  }
  return out
}
