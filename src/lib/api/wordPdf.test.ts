import { afterEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./functions', () => ({ invokeFunction: invoke, ServerMessageError: class extends Error {} }))

import { warmWordPdf, wordPdfUrl } from './wordPdf'

afterEach(() => invoke.mockReset())

it('shares one request between the upload warm-up and the first view', async () => {
  let answer!: (v: unknown) => void
  invoke.mockReturnValue(new Promise((r) => (answer = r)))
  warmWordPdf('p/files/a.docx')
  const view = wordPdfUrl('p/files/a.docx')
  answer({ result: 'ok', url: 'https://signed/a.pdf' })
  await expect(view).resolves.toBe('https://signed/a.pdf')
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('word-pdf', { storage_path: 'p/files/a.docx' })
})

it("passes the server's refusal on as written, and asks again next time", async () => {
  invoke.mockResolvedValueOnce({ result: 'failed', message: 'You cannot open this file.' })
  await expect(wordPdfUrl('p/files/b.docx')).rejects.toThrow('You cannot open this file.')
  invoke.mockResolvedValueOnce({ result: 'ok', url: 'https://signed/b.pdf' })
  await expect(wordPdfUrl('p/files/b.docx')).resolves.toBe('https://signed/b.pdf')
  expect(invoke).toHaveBeenCalledTimes(2)
})
