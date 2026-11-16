/**
 * Reads bytes [begin, end) of a PDF by an HTTP Range request.
 *
 * Storage answers ranges with 206, but does not expose its range headers to the
 * browser, so pdf.js cannot discover that by itself; the viewer asks for each
 * piece through this instead. A server that ignores the range and answers the
 * whole file (200) still works: the piece is cut out of it.
 */
export async function fetchRange(url: string, begin: number, end: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
  if (response.status !== 206 && response.status !== 200) {
    throw new Error('Could not load the PDF preview. Reopen the file and try again.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return response.status === 200 ? bytes.subarray(begin, end) : bytes
}
