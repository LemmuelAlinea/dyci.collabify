// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EstimateSpent, TaskTimer } from './TaskTimer'
import { cancelTimer, myTimer, startTimer, stopTimer } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const show = vi.hoisted(() => vi.fn())
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../../lib/api/workload', () => ({
  myTimer: vi.fn(),
  startTimer: vi.fn(async () => new Date().toISOString()),
  stopTimer: vi.fn(),
  cancelTimer: vi.fn(async () => {}),
  isLongTimerError: (err: unknown) =>
    err instanceof Error && err.message.startsWith('This timer ran past 8 hours'),
}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

const task = { id: 'a', title: 'Build login form' }
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)

async function render(onLogged = vi.fn()) {
  await act(async () => root.render(<TaskTimer task={task} onLogged={onLogged} />))
  return onLogged
}

it('start shows running time', async () => {
  vi.mocked(myTimer).mockResolvedValueOnce(null)
  await render()
  expect(button('Start timer')).toBeTruthy()
  vi.mocked(myTimer).mockResolvedValueOnce({
    task_id: 'a', project_id: 'p', title: 'Build login form',
    started_at: new Date(Date.now() - 75 * 60_000).toISOString(),
  })
  await act(async () => button('Start timer')!.click())
  expect(startTimer).toHaveBeenCalledWith('a')
  expect(container.querySelector('[data-timer-elapsed]')?.textContent).toBe('1:15')
  expect(button('Stop')).toBeTruthy()
  expect(button('Discard')).toBeTruthy()
})

it('stop logs and calls onLogged', async () => {
  vi.mocked(myTimer).mockResolvedValue({
    task_id: 'a', project_id: 'p', title: 'Build login form',
    started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  })
  vi.mocked(stopTimer).mockResolvedValueOnce(30)
  const onLogged = await render()
  vi.mocked(myTimer).mockResolvedValue(null)
  await act(async () => button('Stop')!.click())
  expect(stopTimer).toHaveBeenCalledWith()
  expect(onLogged).toHaveBeenCalled()
  expect(show).toHaveBeenCalledWith('Logged 30 m')
  expect(button('Start timer')).toBeTruthy()
})

it('confirm long timer', async () => {
  vi.mocked(myTimer).mockResolvedValue({
    task_id: 'a', project_id: 'p', title: 'Build login form',
    started_at: new Date(Date.now() - 10 * 3_600_000).toISOString(),
  })
  vi.mocked(stopTimer)
    .mockRejectedValueOnce(new Error('This timer ran past 8 hours. Confirm the time you worked.'))
    .mockResolvedValueOnce(480)
  const onLogged = await render()
  await act(async () => button('Stop')!.click())
  const hours = container.querySelector<HTMLInputElement>('input[aria-label="Hours worked"]')!
  expect(hours.value).toBe('8')
  vi.mocked(myTimer).mockResolvedValue(null)
  await act(async () => button('Log it')!.click())
  expect(stopTimer).toHaveBeenLastCalledWith(480)
  expect(onLogged).toHaveBeenCalled()
})

it('switch from another task', async () => {
  vi.mocked(myTimer).mockResolvedValue({
    task_id: 'b', project_id: 'p', title: 'Write tests',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  })
  await render()
  expect(container.textContent).toContain('Timer running on Write tests')
  await act(async () => button('Start here')!.click())
  expect(startTimer).toHaveBeenCalledWith('a')
})

it('discard', async () => {
  vi.mocked(myTimer).mockResolvedValue({
    task_id: 'a', project_id: 'p', title: 'Build login form',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  })
  const onLogged = await render()
  vi.mocked(myTimer).mockResolvedValue(null)
  await act(async () => button('Discard')!.click())
  expect(cancelTimer).toHaveBeenCalled()
  expect(onLogged).not.toHaveBeenCalled()
  expect(button('Start timer')).toBeTruthy()
})

it('lost task clears the timer with a message', async () => {
  vi.mocked(myTimer).mockResolvedValue({
    task_id: 'a', project_id: 'p', title: 'Build login form',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  })
  vi.mocked(stopTimer).mockResolvedValueOnce(0)
  await render()
  vi.mocked(myTimer).mockResolvedValue(null)
  await act(async () => button('Stop')!.click())
  expect(container.textContent).toContain('You no longer hold this task. The timer was cleared and nothing was logged.')
})

it('refusal shows its message and reloads', async () => {
  vi.mocked(myTimer).mockResolvedValueOnce(null)
  vi.mocked(startTimer).mockRejectedValueOnce(new Error('Only the task\'s holder can time it.'))
  await render()
  vi.mocked(myTimer).mockResolvedValueOnce(null)
  await act(async () => button('Start timer')!.click())
  expect(container.textContent).toContain('Only the task\'s holder can time it.')
  expect(myTimer).toHaveBeenCalledTimes(2)
})

it('spent over estimate warns', async () => {
  await act(async () => root.render(<EstimateSpent estimate={360} spent={440} />))
  const line = container.querySelector('[data-estimate-spent]')!
  expect(line.textContent).toBe('Est. 6 h · Spent 7 h 20 m')
  expect(line.className).toContain('warning')
})

it('no estimate shows spent only', async () => {
  await act(async () => root.render(<EstimateSpent estimate={null} spent={440} />))
  const line = container.querySelector('[data-estimate-spent]')!
  expect(line.textContent).toBe('Spent 7 h 20 m')
  expect(line.className).not.toContain('warning')
})
