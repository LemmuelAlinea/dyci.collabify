import { invokeFunction, ServerMessageError } from './functions'

type Answer = { result: 'ok'; url: string } | { result: 'failed'; message: string }

/** One request per Word object at a time: an upload's warm-up and the first view share it. */
const pending = new Map<string, Promise<string>>()

/**
 * A short-lived link to the PDF of an uploaded Word file. The server makes the
 * PDF the first time anyone asks and keeps it; the Word file is never changed.
 */
export function wordPdfUrl(storagePath: string): Promise<string> {
  const running = pending.get(storagePath)
  if (running) return running
  const request = invokeFunction<Answer>('word-pdf', { storage_path: storagePath })
    .then((answer) => {
      if (answer.result !== 'ok') throw new ServerMessageError(answer.message)
      return answer.url
    })
    .finally(() => pending.delete(storagePath))
  pending.set(storagePath, request)
  return request
}

/** Starts making the PDF right after an upload, so it is ready when someone opens the file. */
export function warmWordPdf(storagePath: string) {
  wordPdfUrl(storagePath).catch(() => {
    // The preview asks again when the file is opened, and says what went wrong then.
  })
}
