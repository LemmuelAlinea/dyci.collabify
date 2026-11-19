// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageText } from './MessageText'
import type { ResolvedMention } from '../../lib/api/mentions'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const draw = (body: string, titles: Map<string, ResolvedMention>) =>
  act(() =>
    root.render(
      <MemoryRouter>
        <MessageText body={body} titles={titles} />
      </MemoryRouter>,
    ),
  )

it('renders text and an open chip that links', () => {
  draw(`fix #[t:${A}] today`, new Map([[`t:${A}`, { state: 'open', title: 'Login page', href: `/projects/p?task=${A}`, archived: false }]]))
  const link = host.querySelector('a')
  expect(link?.getAttribute('href')).toBe(`/projects/p?task=${A}`)
  expect(link?.textContent).toContain('Login page')
  expect(host.textContent).toContain('fix ')
  expect(host.textContent).toContain(' today')
})

it('locked chip shows no title', () => {
  draw(`see #[p:${B}]`, new Map([[`p:${B}`, { state: 'locked' }]]))
  expect(host.querySelector('a')).toBeNull()
  expect(host.textContent).toContain("Project you can't open")
  expect(host.textContent).not.toContain(B)
})

it('unresolved shows as locked', () => {
  draw(`see #[ct:${A}]`, new Map())
  expect(host.textContent).toContain("Task you can't open")
  expect(host.textContent).not.toContain('#[')
})

it('keeps links in the text clickable', () => {
  draw('read https://example.com/doc now', new Map())
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/doc')
})

it('marks an archived item', () => {
  draw(`#[p:${A}]`, new Map([[`p:${A}`, { state: 'open', title: 'Old site', href: `/projects/${A}`, archived: true }]]))
  expect(host.textContent).toContain('archived')
})
