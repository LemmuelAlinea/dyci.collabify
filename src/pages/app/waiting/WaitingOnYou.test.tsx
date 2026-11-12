// @vitest-environment happy-dom
import * as React from 'react'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import WaitingOnYou from './WaitingOnYou'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

/** Each list reports ready only when the test says it has loaded. */
const lists = vi.hoisted(() => ({ handIns: false, requests: false, rerender: [] as (() => void)[] }))

function Fake({ ready, onReady, text }: { ready: () => boolean; onReady?: () => void; text: string }) {
  const [, tick] = React.useState(0)
  useEffect(() => {
    lists.rerender.push(() => tick((n) => n + 1))
  }, [])
  const done = ready()
  useEffect(() => {
    if (done) onReady?.()
  }, [done, onReady])
  return <p>{done ? text : 'loading'}</p>
}

vi.mock('../submissions/Submissions', () => ({
  default: ({ onReady }: { onReady?: () => void }) => (
    <Fake ready={() => lists.handIns} onReady={onReady} text="hand-ins list" />
  ),
}))
vi.mock('../reassignments/Reassignments', () => ({
  default: ({ onReady }: { onReady?: () => void }) => (
    <Fake ready={() => lists.requests} onReady={onReady} text="requests list" />
  ),
}))

const frame = () => new Promise((r) => setTimeout(r, 50))

it('scrolls to the requests only once both lists have loaded, and only once', async () => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  await act(async () => {
    createRoot(el).render(
      <MemoryRouter initialEntries={['/waiting?section=reassignments']}>
        <WaitingOnYou />
      </MemoryRouter>,
    )
    await frame()
  })
  expect(el.querySelector('#hand-ins h2')?.textContent).toBe('Hand-ins')
  expect(el.querySelector('#reassignments h2')?.textContent).toBe('Reassignment requests')
  expect(scroll).not.toHaveBeenCalled()

  // The requests land first; the hand-ins above them are still loading.
  await act(async () => {
    lists.requests = true
    lists.rerender.forEach((r) => r())
    await frame()
  })
  expect(scroll).not.toHaveBeenCalled()

  await act(async () => {
    lists.handIns = true
    lists.rerender.forEach((r) => r())
    await frame()
  })
  expect(scroll).toHaveBeenCalledTimes(1)

  // A later reload of either list does not pull the page back.
  await act(async () => {
    lists.rerender.forEach((r) => r())
    await frame()
  })
  expect(scroll).toHaveBeenCalledTimes(1)
})
