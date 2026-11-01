// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { notifyLooksChanged, useProjectLooks } from './useProjectLooks'
import { listProjectLooks } from '../lib/api/general'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../lib/api/general', () => ({
  listProjectLooks: vi.fn(async (ids: string[]) =>
    ids.map((id) => ({ id, color: id === 'a' ? 'teal' : null, icon: id === 'a' ? 'monitor' : null })),
  ),
}))

// The hook's result is rendered as JSON, and read back from the page.
function Probe({ ids }: { ids: string[] }) {
  return <p>{JSON.stringify(useProjectLooks(ids))}</p>
}
const seen = () => JSON.parse(host.textContent ?? '{}') as ReturnType<typeof useProjectLooks>

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const show = (ids: string[]) => act(async () => root.render(<Probe ids={ids} />))

it('fetches every listed project\'s look in one request', async () => {
  await show(['a', 'b', 'c'])
  expect(listProjectLooks).toHaveBeenCalledTimes(1)
  expect(listProjectLooks).toHaveBeenCalledWith(['a', 'b', 'c'])
  expect(seen().a).toEqual({ color: 'teal', icon: 'monitor' })
  expect(seen().b).toEqual({ color: null, icon: null })
})

it('does not fetch again for the same ids in a new array', async () => {
  await show(['a', 'b'])
  await show(['a', 'b'])
  expect(listProjectLooks).toHaveBeenCalledTimes(1)
})

it('fetches again when the ids change', async () => {
  await show(['a'])
  await show(['a', 'b'])
  expect(listProjectLooks).toHaveBeenCalledTimes(2)
})

it('asks again, with the same ids, when a look is saved', async () => {
  await show(['a', 'b'])
  expect(seen().a).toEqual({ color: 'teal', icon: 'monitor' })
  vi.mocked(listProjectLooks).mockResolvedValueOnce([
    { id: 'a', color: 'rose', icon: 'bell' },
    { id: 'b', color: null, icon: null },
  ])
  await act(async () => notifyLooksChanged())
  expect(listProjectLooks).toHaveBeenCalledTimes(2)
  expect(seen().a).toEqual({ color: 'rose', icon: 'bell' })
})

it('makes no request for an empty list', async () => {
  await show([])
  expect(listProjectLooks).not.toHaveBeenCalled()
  expect(seen()).toEqual({})
})

it('draws no look, rather than failing, when the request fails', async () => {
  vi.mocked(listProjectLooks).mockRejectedValueOnce(new Error('offline'))
  await show(['a'])
  expect(seen()).toEqual({})
})
