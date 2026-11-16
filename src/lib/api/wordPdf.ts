import { invokeFunction, ServerMessageError } from './functions'

type Answer = { result: 'ok'; url: string; size?: number } | { result: 'failed'; message: string }

/** A signed link to a Word file's PDF, and its size in bytes when the server knows it. */
export type WordPdf = { url: string; size: number | null }

/** The server's links last 10 minutes; one is reused for 8 of them. */
const REUSE_MS = 8 * 60 * 1000

/** One request per Word object at a time: an upload's warm-up and the first view share it. */
const pending = new Map<string, Promise<WordPdf>>()
/** Links already answered, so reopening a file skips the server. */
const recent = new Map<string, { pdf: WordPdf; at: number }>()

/**
 * A short-lived link to the PDF of an uploaded Word file. The server makes the
 * PDF the first time anyone asks and keeps it; the Word file is never changed.
 */
export function wordPdfUrl(storagePath: string): Promise<WordPdf> {
  const kept = recent.get(storagePath)
  if (kept && Date.now() - kept.at < REUSE_MS) return Promise.resolve(kept.pdf)
  const running = pending.get(storagePath)
  if (running) return running
  const request = invokeFunction<Answer>('word-pdf', { storage_path: storagePath })
    .then((answer) => {
      if (answer.result !== 'ok') throw new ServerMessageError(answer.message)
      const pdf: WordPdf = { url: answer.url, size: typeof answer.size === 'number' && answer.size > 0 ? answer.size : null }
      recent.set(storagePath, { pdf, at: Date.now() })
      return pdf
    })
    .finally(() => pending.delete(storagePath))
  pending.set(storagePath, request)
  return request
}

/** Starts making the PDF right after an upload or a restore, so it is ready when someone opens the file. */
export function warmWordPdf(storagePath: string) {
  wordPdfUrl(storagePath).catch(() => {
    // The preview asks again when the file is opened, and says what went wrong then.
  })
}

/** Drops every remembered link (tests). */
export function forgetWordPdfs() {
  recent.clear()
  pending.clear()
}
