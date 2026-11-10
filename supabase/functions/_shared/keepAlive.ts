/**
 * A JSON answer for work that can outlast the gateway's wait for a first byte
 * (150 seconds). Spaces go out until the work is done, then the JSON; JSON
 * ignores leading spaces, so the caller reads it like any other answer.
 *
 * The status is already sent by then, so a refusal travels as
 * `{ result: 'failed', message }` with a 200, which the app reads the same way.
 */
export function keepAliveJson(
  headers: Record<string, string>,
  work: () => Promise<Record<string, unknown>>,
  beatMs = 20_000,
): Response {
  const encoder = new TextEncoder()
  let beat: ReturnType<typeof setInterval> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      beat = setInterval(() => controller.enqueue(encoder.encode(' ')), beatMs)
      void work()
        .then((answer) => ({ result: 'ok', ...answer }))
        .catch((err: unknown) => ({
          result: 'failed',
          message: err instanceof Error ? err.message : 'That did not work. Try again.',
        }))
        .then((out) => {
          clearInterval(beat)
          controller.enqueue(encoder.encode(JSON.stringify(out)))
          controller.close()
        })
        // The person closed the page; there is nobody left to answer.
        .catch(() => clearInterval(beat))
    },
    cancel() {
      clearInterval(beat)
    },
  })
  return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } })
}
