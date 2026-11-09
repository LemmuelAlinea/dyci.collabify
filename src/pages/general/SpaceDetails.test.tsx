// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import SpaceDetails from './SpaceDetails'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../lib/api/spaces', () => ({ archiveSpace: vi.fn(), updateSpace: vi.fn() }))

let space: Record<string, unknown> = {}
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({ currentSpace: space, reload: vi.fn() }),
}))

async function renderAs(role: string, check: (container: HTMLDivElement) => void) {
  space = { id: 's', name: 'Capstone', description: 'Notes', archived_at: null, my_role: role }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(SpaceDetails)))
    check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const buttons = (c: HTMLElement) => [...c.querySelectorAll('button')].map((b) => b.textContent)

it('a member sees details without inputs enabled or a save button', async () => {
  await renderAs('member', (c) => {
    const fields = [...c.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
    expect(fields.length).toBe(2)
    expect(fields.every((f) => f.disabled)).toBe(true)
    expect(buttons(c)).not.toContain('Save changes')
  })
})

it('a coordinator can edit details but sees no archive control', async () => {
  await renderAs('coordinator', (c) => {
    expect([...c.querySelectorAll<HTMLInputElement>('input, textarea')].every((f) => !f.disabled)).toBe(true)
    expect(buttons(c)).toContain('Save changes')
    expect(buttons(c)).not.toContain('Archive space')
  })
})

it('the project manager sees the archive control', async () => {
  await renderAs('pm', (c) => {
    expect(buttons(c)).toContain('Archive space')
    expect(buttons(c)).toContain('Save changes')
  })
})
