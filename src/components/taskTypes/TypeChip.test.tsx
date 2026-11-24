// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TypeChip } from './TypeChip'
import { TypeIcon } from './TypeIcon'
import { typeLook } from '../../lib/taskTypes/look'
import type { ResolvedType } from '../../lib/taskTypes/typeSet'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const epic: ResolvedType = { slot: null, name: 'Epic', description: 'Large bodies of work', color: '#db2777', icon: 'zap', removed: false }
const gone: ResolvedType = { slot: null, name: 'Gone', description: '', color: '#64748b', icon: 'tag', removed: true }

it('shows the name, the description as a tooltip and the readable look', () => {
  act(() => root.render(<TypeChip entry={epic} />))
  const chip = host.querySelector('[data-type-chip]') as HTMLElement
  expect(chip.textContent).toBe('Epic')
  expect(chip.title).toBe('Large bodies of work')
  const look = typeLook('#db2777', 'light')
  expect(chip.style.color).toBeTruthy()
  expect(chip.getAttribute('data-ink')).toBe(look.ink)
  expect(chip.querySelector('svg')).not.toBeNull()
})

it('draws a removed type gray, with no color of its own', () => {
  act(() => root.render(<TypeChip entry={gone} />))
  const chip = host.querySelector('[data-type-chip]') as HTMLElement
  expect(chip.textContent).toBe('Gone')
  expect(chip.className).toContain('text-muted')
  expect(chip.style.color).toBe('')
  expect(chip.title).toBe('No longer one of this project\'s types')
})

it('keeps the banner ink on the banner', () => {
  act(() => root.render(<TypeChip entry={epic} onBanner />))
  const chip = host.querySelector('[data-type-chip]') as HTMLElement
  expect(chip.className).toContain('text-banner-ink')
  expect(chip.style.color).toBe('')
})

it('draws the icon tile at the asked size', () => {
  act(() => root.render(<TypeIcon entry={epic} size={36} />))
  const tile = host.firstElementChild as HTMLElement
  expect(tile.style.width).toBe('36px')
  expect(tile.getAttribute('aria-hidden')).toBe('true')
})
