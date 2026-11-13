// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CLASS_TILE, ClassMark } from './ClassMark'
import type { ClassLook } from '../../lib/classLook'

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

const show = (look: ClassLook | null) =>
  act(async () => root.render(<ClassMark look={look} initial="QME" {...CLASS_TILE.card} />))
const tile = () => host.querySelector('span')!

it('draws the initials on the plain tile with no look, as before', async () => {
  await show(null)
  expect(tile().textContent).toBe('QME')
  expect(tile().className).toContain('bg-icon-tile')
  expect(tile().querySelector('svg')).toBeNull()
})

it('draws the icon instead of the initials', async () => {
  await show({ color: null, icon: 'code' })
  expect(tile().querySelector('svg')).not.toBeNull()
  expect(tile().textContent).toBe('')
  expect(tile().getAttribute('data-class-mark')).toBe('code')
})

it('grounds the tile in a swatch or a custom color', async () => {
  await show({ color: 'teal', icon: null })
  expect(tile().className).toContain('bg-swatch-teal')
  expect(tile().className).not.toContain('bg-icon-tile')
  expect(tile().textContent).toBe('QME')
  await show({ color: '#3a6ff7', icon: 'flask' })
  expect(tile().style.background).toMatch(/#3a6ff7|58, 111, 247/)
  expect(tile().querySelector('svg')).not.toBeNull()
})
