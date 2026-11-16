import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./functions', () => ({ invokeFunction: invoke, ServerMessageError: class extends Error {} }))

import { forgetWordPdfs, warmWordPdf, wordPdfUrl } from './wordPdf'

beforeEach(() => forgetWordPdfs())
afterEach(() => {
  invoke.mockReset()
  vi.useRealTimers()
})

it('shares one request between the upload warm-up and the first view', async () => {
  let answer!: (v: unknown) => void
  invoke.mockReturnValue(new Promise((r) => (answer = r)))
  warmWordPdf('p/files/a.docx')
  const view = wordPdfUrl('p/files/a.docx')
  answer({ result: 'ok', url: 'https://signed/a.pdf', size: 3_600_000 })
  await expect(view).resolves.toEqual({ url: 'https://signed/a.pdf', size: 3_600_000 })
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('word-pdf', { storage_path: 'p/files/a.docx' })
})

it("passes the server's refusal on as written, and asks again next time", async () => {
  invoke.mockResolvedValueOnce({ result: 'failed', message: 'You cannot open this file.' })
  await expect(wordPdfUrl('p/files/b.docx')).rejects.toThrow('You cannot open this file.')
  invoke.mockResolvedValueOnce({ result: 'ok', url: 'https://signed/b.pdf' })
  await expect(wordPdfUrl('p/files/b.docx')).resolves.toEqual({ url: 'https://signed/b.pdf', size: null })
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('reuses a link for 8 of its 10 minutes, then asks again', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-17T08:00:00Z'))
  invoke.mockResolvedValueOnce({ result: 'ok', url: 'https://signed/c1.pdf', size: 10 })
  await wordPdfUrl('p/files/c.docx')
  vi.setSystemTime(new Date('2026-11-17T08:07:00Z'))
  await expect(wordPdfUrl('p/files/c.docx')).resolves.toEqual({ url: 'https://signed/c1.pdf', size: 10 })
  expect(invoke).toHaveBeenCalledTimes(1)

  invoke.mockResolvedValueOnce({ result: 'ok', url: 'https://signed/c2.pdf', size: 10 })
  vi.setSystemTime(new Date('2026-11-17T08:08:30Z'))
  await expect(wordPdfUrl('p/files/c.docx')).resolves.toEqual({ url: 'https://signed/c2.pdf', size: 10 })
  expect(invoke).toHaveBeenCalledTimes(2)
})
