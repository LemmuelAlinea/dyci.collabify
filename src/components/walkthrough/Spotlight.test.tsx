// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Spotlight } from './Spotlight'
import { TARGET_GRACE_MS, useTargetBox } from './useTargetBox'
import { DUR } from '../../lib/motion'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

type Motion = { animate: Record<string, number>; duration: number; spotlight?: string }
const h = vi.hoisted(() => ({ reduce: false, renders: [] as Motion[] }))

// Records what each light element was told, so the moves can be read without running them.
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => h.reduce,
  motion: {
    div: ({
      animate,
      transition,
      initial: _initial,
      ref,
      ...rest
    }: React.ComponentProps<'div'> & {
      animate: Record<string, number>
      transition: { duration: number }
      initial: boolean
    }) => {
      h.renders.push({ animate, duration: transition.duration, spotlight: (rest as Record<string, string>)['data-spotlight'] })
      return <div ref={ref} {...rest} />
    },
  },
}))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  h.reduce = false
  h.renders = []
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.replaceChildren()
  document.documentElement.style.removeProperty('--app-bar')
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

it('leaves the announcement to the focus move', async () => {
  await show()
  expect(document.querySelector('[aria-live]')).toBeNull()
})

it('marks its layer and follows the dark background depth', async () => {
  await show()
  const layer = document.querySelector('[data-spotlight-layer]')!
  expect(layer.classList.contains('depth-ground')).toBe(true)
  expect(layer.contains(document.querySelector('[data-spotlight="card"]'))).toBe(true)
  const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8')
  expect(css).toContain("html.has-modal .app-ui:not([role='menu']):not([data-spotlight-layer]) {")
})

const scrimMoveTo = (top: number) => h.renders.find((r) => r.spotlight === 'scrim' && r.animate.height === top)
const moved = { ...box, top: 300 }

it('moves the light instantly while the step stays the same', async () => {
  await show({ stepId: 'a' })
  h.renders = []
  await show({ stepId: 'a', box: moved })
  expect(scrimMoveTo(294)?.duration).toBe(0)
})

it('glides the light when the step changes, then settles', async () => {
  await show({ stepId: 'a' })
  h.renders = []
  await show({ stepId: 'b', box: moved })
  expect(scrimMoveTo(294)?.duration).toBe(DUR.base / 1000)
  expect(h.renders.at(-1)?.duration).toBe(0)
  h.renders = []
  await show({ stepId: 'b', box: { ...box, top: 400 } })
  expect(scrimMoveTo(394)?.duration).toBe(0)
})

it('does not glide under reduced motion', async () => {
  h.reduce = true
  await show({ stepId: 'a' })
  h.renders = []
  await show({ stepId: 'b', box: moved })
  expect(h.renders.every((r) => r.duration === 0)).toBe(true)
})

it('keeps the hole below the app bar', async () => {
  document.documentElement.style.setProperty('--app-bar', '64px')
  await show({ box: { ...box, top: 30 } })
  expect(h.renders.find((r) => r.spotlight === 'scrim')?.animate.height).toBe(64)
})

it('opens the hole at the top of the screen with no app bar', async () => {
  await show({ box: { ...box, top: 30 } })
  expect(h.renders.find((r) => r.spotlight === 'scrim')?.animate.height).toBe(24)
})

it('moves the phone card under the app bar when the sheet would cover the target', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
  document.documentElement.style.setProperty('--app-bar', '60px')
  await show({ box: { top: 560, left: 20, width: 120, height: 44 } })
  expect(h.renders.filter((r) => r.spotlight === 'card').at(-1)?.animate.top).toBe(76)
})

function Probe({ markers, active = true, onRender }: { markers: readonly string[]; active?: boolean; onRender?: () => void }) {
  const result = useTargetBox(markers, active)
  onRender?.()
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

const movable = () => {
  const rect = { top: 10, left: 20, width: 30, height: 40 }
  const target = document.createElement('div')
  target.setAttribute('data-walkthrough', 'x')
  target.getBoundingClientRect = () => ({ ...rect }) as DOMRect
  document.body.append(target)
  return rect
}

it('follows a target that moves with no mutation or event', async () => {
  vi.useFakeTimers()
  const rect = movable()
  await act(async () => root.render(<Probe markers={['x']} />))
  await tick(50)
  expect(probe().box.top).toBe(10)
  rect.top = 32
  await tick(50)
  expect(probe().box.top).toBe(32)
})

it('does not render on a frame where nothing changed', async () => {
  vi.useFakeTimers()
  const rect = movable()
  const onRender = vi.fn()
  await act(async () => root.render(<Probe markers={['x']} onRender={onRender} />))
  await tick(50)
  onRender.mockClear()
  await tick(500)
  expect(onRender).not.toHaveBeenCalled()
  rect.left = 90
  await tick(50)
  expect(onRender).toHaveBeenCalledTimes(1)
})

it('cancels the loop and the grace when it stops', async () => {
  vi.useFakeTimers()
  await act(async () => root.render(<Probe markers={['x']} />))
  await tick(50)
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  await act(async () => root.render(null))
  expect(vi.getTimerCount()).toBe(0)
})

it('does not measure while inactive', async () => {
  vi.useFakeTimers()
  await act(async () => root.render(<Probe markers={['x']} active={false} />))
  expect(vi.getTimerCount()).toBe(0)
})

it('reports a dialog with no markers, for a paused walkthrough', async () => {
  vi.useFakeTimers()
  await act(async () => root.render(<Probe markers={[]} />))
  await tick(50)
  expect(probe().dialogOpen).toBe(false)
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  document.body.append(dialog)
  await tick(50)
  expect(probe().dialogOpen).toBe(true)
})

it('starts the grace again when the markers change', async () => {
  vi.useFakeTimers()
  await act(async () => root.render(<Probe markers={['x']} />))
  await tick(TARGET_GRACE_MS + 50)
  expect(probe().missing).toBe(true)

  await act(async () => root.render(<Probe markers={['y']} />))
  await tick(50)
  expect(probe()).toMatchObject({ box: null, missing: false })
  await tick(TARGET_GRACE_MS)
  expect(probe().missing).toBe(true)
})

it('keeps Tab among the card buttons and the lit target', async () => {
  const lit = document.createElement('button')
  lit.getBoundingClientRect = () => ({ top: 100, left: 200, width: 120, height: 40 }) as DOMRect
  document.body.append(lit)
  await show()
  lit.focus()
  const press = (shiftKey: boolean) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    ;(document.activeElement as HTMLElement).dispatchEvent(e)
    return e
  }
  const card = document.querySelector('[data-spotlight="card"]')!
  const forward = press(false)
  expect(forward.defaultPrevented).toBe(true)
  expect(card.contains(document.activeElement)).toBe(true)
  expect(document.activeElement?.textContent).toBe('Skip')
  lit.focus()
  press(true)
  expect(document.activeElement?.textContent).toBe('Next')
  press(false)
  expect(document.activeElement).toBe(lit)
})

it('leaves Tab to an open dialog, but not to one that is inert', async () => {
  await show()
  const shell = document.createElement('div')
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const field = document.createElement('input')
  dialog.append(field)
  shell.append(dialog)
  document.body.append(shell)
  const press = () => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    field.dispatchEvent(e)
    return e
  }
  field.focus()
  expect(press().defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(field)

  shell.setAttribute('inert', '')
  field.focus()
  expect(press().defaultPrevented).toBe(true)
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
