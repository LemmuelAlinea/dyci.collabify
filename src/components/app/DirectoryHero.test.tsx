// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DirectoryHero } from './DirectoryHero'

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

const show = (props: Partial<React.ComponentProps<typeof DirectoryHero>> = {}) =>
  act(async () => root.render(<DirectoryHero title="Alpha" accent="project." description="About it" {...props} />))
const h1 = () => host.querySelector('h1')!
const accent = () => h1().querySelector('span:last-child')!

it('renders as it always has without a mark or an accent class', async () => {
  await show()
  expect(h1().textContent).toBe('Alpha project.')
  expect(h1().className).not.toContain('flex')
  expect(h1().children).toHaveLength(1)
  expect(accent().className).toBe('text-banner-accent')
})

it('puts the mark before the title and keeps the title text together', async () => {
  await show({ mark: <i data-testid="mark" /> })
  expect(h1().firstElementChild!.getAttribute('data-testid')).toBe('mark')
  expect(h1().textContent).toBe('Alpha project.')
  expect(h1().className).toContain('flex')
  // A long name wraps beside the mark instead of pushing past the banner.
  expect(h1().children[1].className).toContain('min-w-0')
})

it('draws a thin banner when compact', async () => {
  await show({ compact: true })
  const section = host.querySelector('section')!
  expect(section.className).toContain('py-4')
  expect(section.className).not.toContain('lg:py-9')
  expect(host.querySelector('p')!.className).toContain('mt-1')
})

it('keeps the full banner by default', async () => {
  await show()
  expect(host.querySelector('section')!.className).toContain('lg:py-9')
})

it('colors the accent word with the class it is given', async () => {
  await show({ accentClass: 'text-swatch-teal-accent' })
  expect(accent().className).toBe('text-swatch-teal-accent')
  expect(accent().className).not.toContain('text-banner-accent')
})
