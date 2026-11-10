// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Spotlight } from './Spotlight'
import { TARGET_GRACE_MS, useTargetBox } from './useTargetBox'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

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
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const box = { top: 100, left: 200, width: 120, height: 40 }
const onPress = vi.fn()
const base = {
  title: 'Create a project',
  body: 'Projects hold your tasks.',
  eyebrow: 'Step 1 of 3',
  box,
  blockTarget: false,
  actions: [{ label: 'Skip', onPress }, { label: 'Next', onPress: () => {}, primary: true }],
}
const show = (props: Partial<React.ComponentProps<typeof Spotlight>> = {}) =>
  act(async () => root.render(<Spotlight {...base} {...props} />))
const scrims = () => document.querySelectorAll('[data-spotlight="scrim"]')
const blockers = () => document.querySelectorAll('[data-spotlight="block"]')

it('renders four scrim panels around the target and leaves it clickable', async () => {
  await show()
  expect(scrims()).toHaveLength(4)
  expect(blockers()).toHaveLength(0)
})

it('covers the target in a replay', async () => {
  await show({ blockTarget: true })
  expect(scrims()).toHaveLength(4)
  expect(blockers()).toHaveLength(1)
})

it('shows a centered card with no scrim when there is no box', async () => {
  await show({ box: null })
  expect(scrims()).toHaveLength(0)
  expect(blockers()).toHaveLength(0)
  expect(document.body.textContent).toContain('Create a project')
})

it('runs an action', async () => {
  await show()
  const skip = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Skip')!
  await act(async () => skip.click())
  expect(onPress).toHaveBeenCalledTimes(1)
})

it('moves focus to the card when the step changes', async () => {
  await show()
  const card = document.querySelector<HTMLElement>('[data-spotlight="card"]')!
  expect(document.activeElement).toBe(card)
  ;(document.activeElement as HTMLElement).blur()
  await show({ title: 'Invite your team' })
  expect(document.activeElement).toBe(document.querySelector('[data-spotlight="card"]'))
})

it('is not itself an aria-modal dialog', async () => {
  await show()
  expect(document.querySelector('[aria-modal="true"]')).toBeNull()
})

function Probe({ markers }: { markers: readonly string[] }) {
  const result = useTargetBox(markers, true)
  return <output data-testid="probe">{JSON.stringify(result)}</output>
}
const probe = () => JSON.parse(document.querySelector('[data-testid="probe"]')!.textContent!)
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

it('falls back to a card when the target goes away', async () => {
  vi.useFakeTimers()
  const target = document.createElement('div')
  target.setAttribute('data-walkthrough', 'x')
  target.getBoundingClientRect = () => ({ top: 10, left: 20, width: 30, height: 40 }) as DOMRect
  document.body.append(target)
  await act(async () => root.render(<Probe markers={['x']} />))
  await tick(50)
  expect(probe()).toMatchObject({ box: { top: 10, left: 20, width: 30, height: 40 }, missing: false })

  target.remove()
  await tick(50)
  expect(probe().box).toBeNull()
  await tick(TARGET_GRACE_MS)
  expect(probe()).toMatchObject({ box: null, missing: true })
})

it('reports an open dialog', async () => {
  vi.useFakeTimers()
  await act(async () => root.render(<Probe markers={['x']} />))
  await tick(50)
  expect(probe().dialogOpen).toBe(false)

  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  document.body.append(dialog)
  await tick(50)
  expect(probe().dialogOpen).toBe(true)

  const shell = document.createElement('div')
  shell.setAttribute('inert', '')
  document.body.append(shell)
  shell.append(dialog)
  await tick(50)
  expect(probe().dialogOpen).toBe(false)
})
