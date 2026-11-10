import { expect, it } from 'vitest'
import { keepAliveJson } from '../../../supabase/functions/_shared/keepAlive'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

it('sends spaces while the work runs, and the whole body still parses as JSON', async () => {
  const response = keepAliveJson({ 'X-Test': 'yes' }, async () => {
    await wait(40)
    return { tasks: [1, 2] }
  }, 5)
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('application/json')
  expect(response.headers.get('X-Test')).toBe('yes')
  const text = await response.text()
  expect(text.startsWith(' ')).toBe(true)
  expect(JSON.parse(text)).toEqual({ result: 'ok', tasks: [1, 2] })
})

it('turns a refusal into the failed answer the app shows', async () => {
  const response = keepAliveJson({}, async () => {
    throw new Error('That list is too long.')
  })
  expect(await response.json()).toEqual({ result: 'failed', message: 'That list is too long.' })
})

it('stops sending once the reader goes away', async () => {
  let done = false
  const response = keepAliveJson({}, async () => {
    await wait(20)
    done = true
    return {}
  }, 2)
  await response.body!.cancel()
  await wait(40)
  expect(done).toBe(true)
})
