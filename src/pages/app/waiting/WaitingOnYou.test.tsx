// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import WaitingOnYou from './WaitingOnYou'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../submissions/Submissions', () => ({ default: () => <p>hand-ins list</p> }))
vi.mock('../reassignments/Reassignments', () => ({ default: () => <p>requests list</p> }))

it('has the scroll target and both sections', async () => {
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
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(el.querySelector('#hand-ins h2')?.textContent).toBe('Hand-ins')
  expect(el.querySelector('#reassignments h2')?.textContent).toBe('Reassignment requests')
  expect(scroll).toHaveBeenCalled()
})
