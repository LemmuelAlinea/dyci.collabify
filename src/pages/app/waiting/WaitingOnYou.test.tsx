// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WaitingOnYou from './WaitingOnYou'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../submissions/Submissions', () => ({ default: () => <p>hand-ins list</p> }))
vi.mock('../reassignments/Reassignments', () => ({ default: () => <p>requests list</p> }))
vi.mock('../../../hooks/useLive', () => ({ useLive: () => undefined }))
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))
const counts = vi.hoisted(() => vi.fn(async () => ({ handIns: 3, requests: 1 })))
vi.mock('../../../lib/api/waiting', () => ({ teachingWaitingCounts: counts }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let search = ''
function Where() {
  search = useLocation().search
  return null
}
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (at: string) =>
  act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <WaitingOnYou />
        <Where />
      </MemoryRouter>,
    )
    await new Promise((r) => setTimeout(r, 20))
  })
const radios = () =>
  [...host.querySelectorAll('[role="radio"]')].map((b) => `${b.textContent?.trim()}:${b.getAttribute('aria-checked')}`)

it('opens on the hand-ins alone, with both counts on the switch', async () => {
  await show('/waiting')
  expect(host.textContent).toContain('hand-ins list')
  expect(host.textContent).not.toContain('requests list')
  expect(radios()).toEqual(['Hand-ins3:true', 'Reassignment requests1:false'])
  expect(counts).toHaveBeenCalledWith('me')
})

it('opens an old reassignments link on the requests', async () => {
  await show('/waiting?section=reassignments')
  expect(host.textContent).toContain('requests list')
  expect(host.textContent).not.toContain('hand-ins list')
})

it('switches between the two and keeps the choice in the address', async () => {
  await show('/waiting')
  const requests = [...host.querySelectorAll('[role="radio"]')][1] as HTMLButtonElement
  await act(async () => requests.click())
  expect(host.textContent).toContain('requests list')
  expect(search).toBe('?section=reassignments')
  const handIns = [...host.querySelectorAll('[role="radio"]')][0] as HTMLButtonElement
  await act(async () => handIns.click())
  expect(host.textContent).toContain('hand-ins list')
  expect(search).toBe('')
})
