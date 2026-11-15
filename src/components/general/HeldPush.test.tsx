// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { HeldPush } from './HeldPush'
import type { PushVerdict } from '../../lib/general/pushCheck'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const m = vi.hoisted(() => ({ diff: vi.fn() }))

vi.mock('./WordDiff', () => ({
  WordDiff: (p: { caption: string }) => {
    m.diff(p)
    return <p>{p.caption}</p>
  },
}))
vi.mock('../ui/ConfirmDialog', () => ({
  ConfirmDialog: (p: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> }) =>
    p.open ? (
      <div data-dialog>
        <h2>{p.title}</h2>
        <div>{p.body}</div>
        <button type="button" data-confirm onClick={() => void p.onConfirm()}>
          {p.confirmLabel}
        </button>
      </div>
    ) : null,
}))

type Held = PushVerdict & { kind: 'held' }
const held = (over: Partial<Held> = {}): Held => ({
  kind: 'held',
  by: 'ben',
  at: '2026-11-15T07:10:00Z',
  removed: false,
  mainSeq: 7,
  baseSeq: 4,
  ...over,
})
const names = (id: string) => (id === 'ben' ? 'Ben' : 'Someone')

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  m.diff.mockReset()
})

async function show(node: ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
}

const buttons = () => [...host!.querySelectorAll('button')].map((b) => b.textContent?.trim())
const button = (label: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

it('says who updated it and offers their version or a replace', async () => {
  const getTheirs = vi.fn()
  await show(
    <HeldPush state={held()} path="Thesis/Chap1-4.docx" names={names} onGetTheirs={getTheirs} onReplaceAnyway={vi.fn()} />,
  )
  expect(host!.textContent).toContain('Ben updated this since you pulled')
  expect(buttons()).toContain("Download Ben's version")
  expect(buttons()).toContain('Replace it anyway')
  await act(async () => button("Download Ben's version").click())
  expect(getTheirs).toHaveBeenCalledTimes(1)
})

it('says the file was removed and offers no download', async () => {
  await show(
    <HeldPush
      state={held({ removed: true })}
      path="Thesis/Chap1-4.docx"
      names={names}
      onGetTheirs={vi.fn()}
      onReplaceAnyway={vi.fn()}
    />,
  )
  expect(host!.textContent).toContain('Ben removed this file since you pulled')
  expect(buttons()).not.toContain("Download Ben's version")
  expect(buttons()).toContain('Replace it anyway')
})

it('asks once more, naming whose changes go, before replacing', async () => {
  const replace = vi.fn()
  await show(
    <HeldPush state={held()} path="Thesis/Chap1-4.docx" names={names} onGetTheirs={vi.fn()} onReplaceAnyway={replace} />,
  )
  await act(async () => button('Replace it anyway').click())
  expect(replace).not.toHaveBeenCalled()
  const dialog = host!.querySelector('[data-dialog]')!
  expect(dialog.textContent).toContain("Ben's changes")
  await act(async () => (dialog.querySelector('[data-confirm]') as HTMLElement).click())
  expect(replace).toHaveBeenCalledTimes(1)
})

it("shows the words changed between the pulled copy and Main's for a .docx", async () => {
  await show(
    <HeldPush
      state={held()}
      path="Thesis/Chap1-4.docx"
      repoId="repo"
      names={names}
      onGetTheirs={vi.fn()}
      onReplaceAnyway={vi.fn()}
    />,
  )
  expect(m.diff).toHaveBeenCalled()
  expect(host!.textContent).toContain("What Ben changed in Thesis/Chap1-4.docx")
})

it('gets their version once, however fast the clicks come', async () => {
  let finish = () => {}
  const getTheirs = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  await show(<HeldPush state={held()} path="a.docx" names={names} onGetTheirs={getTheirs} onReplaceAnyway={vi.fn()} />)
  const download = button("Download Ben's version")
  await act(async () => {
    download.click()
    // Synchronously, inside the click: the caller opens its download tab here.
    expect(getTheirs).toHaveBeenCalledTimes(1)
    download.click()
  })
  await act(async () => button("Download Ben's version").click())
  expect(getTheirs).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  await act(async () => button("Download Ben's version").click())
  expect(getTheirs).toHaveBeenCalledTimes(2)
})

it('offers a link when the browser blocked the download', async () => {
  await show(
    <HeldPush state={held()} path="a.docx" names={names} blockedUrl="https://signed/ben" onGetTheirs={vi.fn()} onReplaceAnyway={vi.fn()} />,
  )
  const link = host!.querySelector('a[href="https://signed/ben"]')
  expect(link?.textContent).toContain("Download Ben's version")
  expect(host!.textContent).toContain('Your browser blocked the download.')
})

it('shows no comparison for a removed file or a .doc', async () => {
  await show(
    <HeldPush state={held({ removed: true })} path="a.docx" repoId="repo" names={names} onGetTheirs={vi.fn()} onReplaceAnyway={vi.fn()} />,
  )
  await act(async () => root!.render(
    <HeldPush state={held()} path="a.doc" repoId="repo" names={names} onGetTheirs={vi.fn()} onReplaceAnyway={vi.fn()} />,
  ))
  expect(m.diff).not.toHaveBeenCalled()
})
