// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PutBackDialog } from './PutBackDialog'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
})

async function show(props: Partial<React.ComponentProps<typeof PutBackDialog>> = {}) {
  const onConfirm = vi.fn(async (_message: string) => {})
  const onClose = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <PutBackDialog
        title="Revert #12?"
        files={['a.md', 'b.md']}
        replacesDraft={[]}
        toMain
        defaultMessage="Revert #12: Draft chapter"
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />,
    ),
  )
  return { onConfirm, onClose }
}

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)

async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('lists the files and commits with the edited message', async () => {
  const { onConfirm } = await show()
  expect(document.body.textContent).toContain('Revert #12?')
  expect(document.body.textContent).toContain('a.md')
  expect(document.body.textContent).toContain('b.md')
  const input = document.getElementById('put-back-message') as HTMLInputElement
  expect(input.value).toBe('Revert #12: Draft chapter')
  await type(input, 'Take the chapter back out')
  await act(async () => button('Put back in Main')!.click())
  expect(onConfirm).toHaveBeenCalledWith('Take the chapter back out')
})

it('falls back to the default message when the field is cleared', async () => {
  const { onConfirm } = await show()
  await type(document.getElementById('put-back-message') as HTMLInputElement, '   ')
  await act(async () => button('Put back in Main')!.click())
  expect(onConfirm).toHaveBeenCalledWith('Revert #12: Draft chapter')
})

it('asks before replacing a draft copy, and cancel calls nothing', async () => {
  const { onConfirm, onClose } = await show({ toMain: false, replacesDraft: ['b.md'] })
  expect(document.getElementById('put-back-message')).toBeNull()
  expect(document.body.textContent).toContain('Your draft already has its own copy of')
  expect(document.querySelector('[data-replaces-draft]')?.textContent).toContain('b.md')
  await act(async () => button('Cancel')!.click())
  expect(onClose).toHaveBeenCalled()
  expect(onConfirm).not.toHaveBeenCalled()
  expect(button('Put back in my draft')).toBeDefined()
})

it('names the files changed since and offers only Close', async () => {
  const { onConfirm } = await show({ changedSince: ['b.md'] })
  expect(document.body.textContent).toContain('Later commits changed')
  expect(document.querySelector('[data-changed-since]')?.textContent).toContain('b.md')
  expect(button('Close')).toBeDefined()
  expect(button('Put back in Main')).toBeUndefined()
  expect(onConfirm).not.toHaveBeenCalled()
})

it('shows what the database refused, in its own words', async () => {
  const onConfirm = vi.fn(async () => {
    throw { message: 'Later commits changed a.md. Restore each file from its history instead.' }
  })
  await show({ onConfirm })
  await act(async () => button('Put back in Main')!.click())
  expect(document.body.textContent).toContain('Later commits changed a.md. Restore each file from its history instead.')
})
