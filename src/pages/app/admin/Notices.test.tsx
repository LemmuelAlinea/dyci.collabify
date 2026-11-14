// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Notices, { noticeSendError } from './Notices'
import { listOffices } from '../../../lib/api/offices'
import { listAllNotices, noticeReach, postNotice } from '../../../lib/api/program'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../../components/ui/DraftFromLine', () => ({ DraftFromLine: () => null }))
vi.mock('../../../lib/api/offices', () => ({
  listOffices: vi.fn(async () => [
    { id: 'o1', name: 'IT services', description: '', archived_at: null },
    { id: 'o2', name: 'Registrar', description: '', archived_at: null },
    { id: 'o3', name: 'Old desk', description: '', archived_at: '2026-10-01T00:00:00Z' },
  ]),
}))

const base = {
  body: 'Body',
  pinned: false,
  created_at: '2026-11-10T00:00:00Z',
  edited_at: null,
  author_id: 'a',
  author_name: 'Chair',
  author_avatar: null,
  audience_offices: [],
  audience_groups: [],
  audience_office_names: null,
  live: true,
  leaves_at: '2026-11-17T00:00:00Z',
}
vi.mock('../../../lib/api/program', () => ({
  listAllNotices: vi.fn(async () => [
    { ...base, id: 'n1', title: 'All hands', audience: 'everyone' },
    {
      ...base,
      id: 'n2',
      title: 'Desk news',
      audience: 'offices',
      audience_offices: ['o1', 'o2'],
      audience_office_names: ['IT services', 'Registrar'],
    },
    {
      ...base,
      id: 'n3',
      title: 'Faculty memo',
      audience: 'groups',
      audience_groups: ['students', 'teaching'],
    },
  ]),
  postNotice: vi.fn(async () => {}),
  noticeReach: vi.fn(async () => 12),
  editNotice: vi.fn(async () => {}),
  deleteNotice: vi.fn(async () => {}),
}))

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function render() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Notices />))
}
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const click = (el: Element | undefined | null) => act(async () => (el as HTMLElement).click())
const labelled = (text: string) =>
  [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === text)!
    .querySelector('input')!
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
async function openAndFill() {
  await render()
  await click(button('Send a notice'))
  await type(document.querySelector('input[placeholder="No classes on Friday"]')!, 'Title')
  await type(document.querySelector('textarea')!, 'Body')
}
const sendButton = () => button('Send notice') as HTMLButtonElement

it('lists notices without asking for an expired column', async () => {
  await render()
  expect(listAllNotices).toHaveBeenCalled()
  expect(document.body.textContent).toContain('All hands')
})

it('sends an Offices notice with the ticked offices', async () => {
  await openAndFill()
  await click(labelled('Offices'))
  expect(document.body.textContent).not.toContain('Old desk')
  await click(labelled('Registrar'))
  await click(sendButton())
  expect(postNotice).toHaveBeenCalledWith(
    expect.objectContaining({ audience: 'offices', audienceOffices: ['o2'], audienceGroups: [] }),
  )
})

it('disables Send with no office ticked', async () => {
  await openAndFill()
  await click(labelled('Offices'))
  expect(sendButton().disabled).toBe(true)
  await click(labelled('IT services'))
  expect(sendButton().disabled).toBe(false)
  await click(labelled('Groups'))
  expect(sendButton().disabled).toBe(true)
})

it('shows the reach count', async () => {
  await openAndFill()
  await click(labelled('Groups'))
  await click(labelled('Students'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(noticeReach).toHaveBeenLastCalledWith('groups', [], ['students'])
  expect(document.querySelector('[data-reach]')!.textContent).toBe('Will notify 12 people.')
})

it('labels each notice with its audience', async () => {
  await render()
  const labels = [...document.querySelectorAll('[data-audience]')].map((e) => e.textContent)
  expect(labels).toEqual(['Everyone', 'IT services, Registrar', 'Students, Teaching faculty'])
})

it('splits notices into Live now and Past, with when each leaves or left', async () => {
  vi.mocked(listAllNotices).mockResolvedValueOnce([
    { ...base, id: 'n1', title: 'This week', audience: 'everyone' },
    {
      ...base,
      id: 'n9',
      title: 'Last month',
      audience: 'everyone',
      pinned: true,
      created_at: '2026-10-01T00:00:00Z',
      live: false,
      leaves_at: '2026-10-08T00:00:00Z',
    },
  ] as never)
  await render()
  const text = document.querySelector('ul')?.textContent ?? ''
  expect(text.indexOf('Live now')).toBeGreaterThanOrEqual(0)
  expect(text.indexOf('Live now')).toBeLessThan(text.indexOf('This week'))
  expect(text.indexOf('This week')).toBeLessThan(text.indexOf('Past'))
  expect(text.indexOf('Past')).toBeLessThan(text.indexOf('Last month'))
  expect(text).toContain('Leaves dashboards')
  expect(text).toContain('Left dashboards')
  // A past notice can be unpinned but not pinned again; a live one keeps its Pin.
  const past = [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('Last month'))!
  expect([...past.querySelectorAll('button')].map((b) => b.textContent?.trim())).toContain('Unpin')
  const live = [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('This week'))!
  expect([...live.querySelectorAll('button')].map((b) => b.textContent?.trim())).toContain('Pin')
})

it('a past notice that is not pinned offers no Pin', async () => {
  vi.mocked(listAllNotices).mockResolvedValueOnce([
    { ...base, id: 'n9', title: 'Last month', audience: 'everyone', live: false },
  ] as never)
  await render()
  const past = [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('Last month'))!
  expect([...past.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Pin')
})

it('shows a failed count as failed, and clears the old count while a new one loads', async () => {
  await openAndFill()
  await click(labelled('Groups'))
  await click(labelled('Students'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(document.querySelector('[data-reach]')!.textContent).toBe('Will notify 12 people.')
  vi.mocked(noticeReach).mockRejectedValueOnce(new Error('x'))
  await click(labelled('Teaching faculty'))
  expect(document.querySelector('[data-reach]')!.textContent).toContain('Counting')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(document.querySelector('[data-reach]')!.textContent).toBe(
    'Could not count who it reaches. Send still works.',
  )
})

it('says when the offices could not load', async () => {
  vi.mocked(listOffices).mockRejectedValueOnce(new Error('x'))
  await openAndFill()
  await click(labelled('Offices'))
  expect(document.body.textContent).toContain('Could not load the offices.')
  expect(document.body.textContent).not.toContain('There are no offices yet.')
  await click(button('Try again'))
  expect(document.body.textContent).toContain('Registrar')
})

it('rewrites the rate-limit refusal to say what it means now', () => {
  const text = 'That is six notices in an hour. Wait a while — each one reaches every professor and student in the program.'
  expect(noticeSendError(new Error(text))).toBe(
    'That is six notices in an hour. Wait a while before sending another.',
  )
})
