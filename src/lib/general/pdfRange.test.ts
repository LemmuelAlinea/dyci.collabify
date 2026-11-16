import { afterEach, expect, it, vi } from 'vitest'
import { fetchRange } from './pdfRange'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, bytes: number[]) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('asks for exactly the bytes pdf.js wants, end exclusive', async () => {
  const fetchMock = respond(206, [7, 8, 9])
  await expect(fetchRange('https://signed/a.pdf', 100, 103)).resolves.toEqual(new Uint8Array([7, 8, 9]))
  expect(fetchMock).toHaveBeenCalledWith('https://signed/a.pdf', { headers: { Range: 'bytes=100-102' } })
})

it('cuts the piece out when the server answers the whole file', async () => {
  respond(200, [0, 1, 2, 3, 4, 5])
  await expect(fetchRange('https://signed/a.pdf', 2, 4)).resolves.toEqual(new Uint8Array([2, 3]))
})

it('says what went wrong when the link has run out', async () => {
  respond(400, [])
  await expect(fetchRange('https://signed/a.pdf', 0, 10)).rejects.toThrow('Could not load the PDF preview.')
})
