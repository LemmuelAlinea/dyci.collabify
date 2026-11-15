// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { GeneralSpaceSummary } from '../../lib/general/types'
import { SpaceLookPanel } from './SpaceLookPanel'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.fn()
const listSpaceLooks = vi.fn()
const setSpaceLook = vi.fn()
const notify = vi.fn()
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../lib/api/spaces', () => ({
  listSpaceLooks: (...a: unknown[]) => listSpaceLooks(...a),
  setSpaceLook: (...a: unknown[]) => setSpaceLook(...a),
}))
vi.mock('../../hooks/useSpaceLooks', () => ({ notifySpaceLooksChanged: () => notify() }))

beforeEach(() => {
  vi.clearAllMocks()
  listSpaceLooks.mockResolvedValue([{ id: 's', color: 'teal', icon: null }])
  setSpaceLook.mockResolvedValue(undefined)
})

const space = (mine: Partial<GeneralSpaceSummary>) =>
  ({ id: 's', kind: 'work', name: 'Capstone', archived_at: null, my_role: 'pm', ...mine }) as GeneralSpaceSummary

async function render(mine: Partial<GeneralSpaceSummary>, check: (c: HTMLDivElement) => Promise<void>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(SpaceLookPanel, { space: space(mine) })))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const radio = (c: HTMLElement, label: string) => c.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const saveButton = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Save look')

it('lets the project manager pick an icon and save it with the stored color', async () => {
  await render({}, async (c) => {
    expect(radio(c, 'Teal').checked).toBe(true)
    expect(radio(c, 'First letter').checked).toBe(true)
    expect(saveButton(c)?.disabled).toBe(true)

    await act(async () => radio(c, 'Crown').click())
    expect(saveButton(c)?.disabled).toBe(false)
    await act(async () => saveButton(c)!.click())

    expect(setSpaceLook).toHaveBeenCalledWith('s', 'teal', 'crown')
    expect(notify).toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Look saved')
    expect(saveButton(c)?.disabled).toBe(true)
  })
})

it('shows a coordinator the look but no way to change it', async () => {
  await render({ my_role: 'coordinator' }, async (c) => {
    expect(radio(c, 'Teal').checked).toBe(true)
    expect(radio(c, 'Crown').disabled).toBe(true)
    expect(saveButton(c)).toBeUndefined()
    expect(c.textContent).toContain('Only the project manager changes it.')
  })
})

it('keeps an archived space read-only, even for the project manager', async () => {
  await render({ archived_at: '2026-11-01T00:00:00Z' }, async (c) => {
    expect(radio(c, 'Crown').disabled).toBe(true)
    expect(saveButton(c)).toBeUndefined()
    expect(c.textContent).toContain('Restore the space to change its look.')
  })
})

it('says what failed when the save is refused', async () => {
  setSpaceLook.mockRejectedValue(new Error('Only the project manager changes the space\'s look.'))
  await render({}, async (c) => {
    await act(async () => radio(c, 'Bell').click())
    await act(async () => saveButton(c)!.click())
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Only the project manager')
    expect(notify).not.toHaveBeenCalled()
    expect(saveButton(c)?.disabled).toBe(false)
  })
})
