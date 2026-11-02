// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MilestoneDialog } from './MilestoneDialog'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onSubmit = vi.fn(async () => {})
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  onSubmit.mockClear()
})

const open = (props: { requireDue?: boolean; dueOn?: string }) =>
  act(async () =>
    root.render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        title="New milestone"
        submitLabel="Add milestone"
        initial={{ name: 'Beta', description: '', dueOn: props.dueOn ?? '' }}
        onSubmit={onSubmit}
        requireDue={props.requireDue}
      />,
    ),
  )
const submit = () =>
  act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Add milestone')!.click())
const dateLabel = () => [...document.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Due'))

it('asks for a due date by default', async () => {
  await open({})
  await submit()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('A milestone needs a due date.')
})

it('makes the date optional when the project does not require one', async () => {
  await open({ requireDue: false })
  expect(dateLabel()?.textContent).toContain('optional')
  await submit()
  expect(onSubmit).toHaveBeenCalledWith({ name: 'Beta', description: '', dueOn: '' })
})

it('does not mark the date optional when it is required', async () => {
  await open({ requireDue: true })
  expect(dateLabel()?.textContent).not.toContain('optional')
})
