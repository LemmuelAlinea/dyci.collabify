// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProjectMark } from './ProjectMark'

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
})

const show = (node: React.ReactElement) => act(async () => root.render(node))
const mark = () => host.firstElementChild as HTMLElement

it('draws the first letter when it has no color and no icon', async () => {
  await show(<ProjectMark color={null} icon={null} name="  alpha site" />)
  expect(mark().textContent).toBe('A')
  expect(mark().querySelector('svg')).toBeNull()
  expect(mark().className).not.toContain('swatch')
})

it('keeps today\'s rail tile when it has no look', async () => {
  await show(<ProjectMark color={null} icon={null} name="Alpha" size="sm" />)
  expect(mark().className).toContain('border-line')
  expect(mark().className).toContain('text-muted')
  await show(<ProjectMark color={null} icon={null} name="Alpha" size="sm" active />)
  expect(mark().className).toContain('bg-nav-active')
})

it('keeps today\'s card tile when it has no look', async () => {
  await show(<ProjectMark color={null} icon={null} name="Alpha" size="lg" />)
  expect(mark().className).toContain('bg-icon-tile')
  expect(mark().className).toContain('text-icon-glyph')
})

it('puts the icon on the swatch when it has both', async () => {
  await show(<ProjectMark color="teal" icon="monitor" name="Alpha" />)
  expect(mark().className).toContain('bg-swatch-teal')
  expect(mark().className).toContain('text-swatch-teal-ink')
  expect(mark().querySelector('svg')).not.toBeNull()
  expect(mark().textContent).toBe('')
})

it('draws the letter on the swatch when only the color is set', async () => {
  await show(<ProjectMark color="violet" icon={null} name="Beta" />)
  expect(mark().className).toContain('bg-swatch-violet')
  expect(mark().textContent).toBe('B')
})

it('draws the icon on the default ground when only the icon is set', async () => {
  await show(<ProjectMark color={null} icon="folder" name="Beta" size="lg" />)
  expect(mark().className).toContain('bg-icon-tile')
  expect(mark().className).not.toContain('swatch')
  expect(mark().querySelector('svg')).not.toBeNull()
})

it('falls back to the given icon when no icon is set', async () => {
  await show(<ProjectMark color={null} icon={null} fallbackIcon="kanban" name="Beta" size="lg" />)
  expect(mark().querySelector('svg')).not.toBeNull()
})

it('is hidden from assistive tech, since the name sits beside it', async () => {
  await show(<ProjectMark color="rose" icon="bell" name="Gamma" />)
  expect(mark().getAttribute('aria-hidden')).toBe('true')
})
