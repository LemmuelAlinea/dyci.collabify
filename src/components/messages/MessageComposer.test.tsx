// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageComposer } from './MessageComposer'
import { mentionBlindSpots, searchMentionables } from '../../lib/api/mentions'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/mentions', () => ({
  searchMentionables: vi.fn(),
  mentionBlindSpots: vi.fn(async () => []),
}))

const A = '11111111-1111-4111-8111-111111111111'
const login = { kind: 't' as const, id: A, title: 'Login page', project_id: 'p', project_title: 'Website' }

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onSend: ReturnType<typeof vi.fn<(body: string, files: File[]) => Promise<void>>>
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(searchMentionables).mockReset()
  vi.mocked(mentionBlindSpots).mockReset().mockResolvedValue([])
  onSend = vi.fn<(body: string, files: File[]) => Promise<void>>(async () => {})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<MessageComposer conversationId="c1" onSend={onSend} onCreatePoll={() => {}} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const box = () => host.querySelector('textarea')!
const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
function type(value: string) {
  act(() => {
    setValue.call(box(), value)
    box().setSelectionRange(value.length, value.length)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(250)
  })
  await act(async () => {})
}
function press(key: string) {
  act(() => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

it('Enter does not pick a result from an earlier search', async () => {
  vi.mocked(searchMentionables).mockResolvedValueOnce([login]).mockReturnValueOnce(new Promise(() => {}))
  type('#')
  await settle()
  expect(host.textContent).toContain('Login page')
  type('#zz')
  press('Enter')
  expect(box().value).toBe('#zz')
  expect(onSend).not.toHaveBeenCalled()
})

it("names the picked task's project in the note", async () => {
  vi.mocked(searchMentionables).mockResolvedValue([login])
  vi.mocked(mentionBlindSpots).mockResolvedValue([{ kind: 't', id: A, members_without: 2, private_task: false }])
  type('#log')
  await settle()
  press('Enter')
  expect(box().value).toBe('#Login page ')
  await settle()
  expect(host.textContent).toContain("2 people in this chat aren't on Website. They'll see a locked chip.")
})

it('sends the code, not the title', async () => {
  vi.mocked(searchMentionables).mockResolvedValue([login])
  type('#log')
  await settle()
  press('Enter')
  press('Enter')
  await act(async () => {})
  expect(onSend).toHaveBeenCalledWith(`#[t:${A}] `, [])
})
