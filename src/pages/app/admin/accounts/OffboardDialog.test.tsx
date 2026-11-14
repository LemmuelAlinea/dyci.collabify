// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { OffboardDialog } from './OffboardDialog'
import { offboardMember } from '../../../../lib/api/offboarding'
import type { OffboardLine } from '../../../../lib/offboarding'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../../components/ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../../lib/api/offboarding', () => ({
  offboardingPreview: vi.fn(async () => []),
  offboardMember: vi.fn(async () => {}),
}))

const line = (over: Partial<OffboardLine>): OffboardLine => ({
  kind: 'project_pm',
  item_id: 'x',
  item_name: 'Item',
  project_name: '',
  space_name: 'Registrar Ops',
  office_name: 'Registrar',
  archived: false,
  task_count: 0,
  ...over,
})

const LINES: OffboardLine[] = [
  line({ kind: 'space_pm', item_id: 'sp1', item_name: 'Registrar Ops', project_name: '' }),
  line({ kind: 'project_pm', item_id: 'p1', item_name: 'Enrollment 2027', project_name: 'Enrollment 2027' }),
  line({ kind: 'project_pm', item_id: 'p2', item_name: 'Records cleanup', project_name: 'Records cleanup' }),
  line({ kind: 'team_lead', item_id: 'g1', item_name: 'Records team', project_name: 'Enrollment 2027' }),
  line({ kind: 'reviewer', item_id: 'p1', item_name: 'Enrollment 2027', project_name: 'Enrollment 2027', task_count: 3 }),
  line({ kind: 'open_tasks', item_id: null, item_name: '', project_name: '', space_name: '', office_name: '', task_count: 7 }),
]

const PEOPLE = [
  { id: 's1', name: 'Ben Reyes' },
  { id: 's2', name: 'Cara Lim' },
]

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const onClose = vi.fn()
const onDone = vi.fn()

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = null
  root = null
  vi.clearAllMocks()
})

async function render(lines = LINES, candidates = PEOPLE) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <OffboardDialog
        person={{ id: 't', name: 'Ana Cruz' }}
        candidates={candidates}
        lines={lines}
        onClose={onClose}
        onDone={onDone}
      />,
    ),
  )
}

const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
const successor = () => document.querySelector<HTMLSelectElement>('select[data-offboard-successor]')!
const pickFor = (name: string) =>
  document.querySelector<HTMLSelectElement>(`select[aria-label="Who runs ${name}"]`)!
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('lists every preview line with its project name', async () => {
  await render()
  expect(text()).toContain('Offboard Ana Cruz')
  expect(text()).toContain('Registrar Ops')
  expect(text()).toContain('Enrollment 2027')
  expect(text()).toContain('Records cleanup')
  expect(text()).toContain('Records team')
  expect(text()).toContain('Seat emptied. The project manager picks a lead.')
  expect(text()).toContain("3 reviews move to that project's new project manager.")
  expect(text()).toContain('7 open tasks are unassigned and go back to their teams.')
  // The team and the reviews each name the project they belong to.
  const team = document.querySelector('[data-offboard-line="team_lead"]')!.textContent
  expect(team).toContain('Records team')
  expect(team).toContain('Enrollment 2027')
  const reviews = document.querySelector('[data-offboard-line="reviewer"]')!.textContent
  expect(reviews).toContain('Enrollment 2027')
})

it('defaults every space and project to the chosen successor', async () => {
  await render()
  await choose(successor(), 's1')
  expect(pickFor('Registrar Ops').value).toBe('s1')
  expect(pickFor('Enrollment 2027').value).toBe('s1')
  expect(pickFor('Records cleanup').value).toBe('s1')
  await choose(successor(), 's2')
  expect(pickFor('Records cleanup').value).toBe('s2')
})

it('sends only changed lines as overrides', async () => {
  await render()
  await choose(successor(), 's1')
  await choose(pickFor('Records cleanup'), 's2')
  await act(async () => button('Deactivate and hand over').click())
  expect(offboardMember).toHaveBeenCalledWith('t', 's1', { p2: 's2' })
  expect(toast).toHaveBeenCalledWith('Ana Cruz offboarded')
  expect(onDone).toHaveBeenCalled()
})

it('keeps confirm disabled without a successor', async () => {
  await render()
  expect(button('Deactivate and hand over').disabled).toBe(true)
  await choose(successor(), 's1')
  expect(button('Deactivate and hand over').disabled).toBe(false)
})

it("says nobody can take over when there are no candidates, and points to Accounts' Project manager switch", async () => {
  await render(LINES, [])
  expect(text()).toContain('Nobody can take over yet.')
  expect(text()).toContain('Project manager')
  expect(text()).toContain('Accounts')
  expect(button('Deactivate and hand over').disabled).toBe(true)
})

it('shows the database refusal as-is', async () => {
  // Supabase rejects with a plain object, not an Error instance.
  vi.mocked(offboardMember).mockRejectedValueOnce({
    message: 'Ben Reyes needs Project manager on to take over.',
    code: 'P0001',
  })
  await render()
  await choose(successor(), 's1')
  await act(async () => button('Deactivate and hand over').click())
  expect(text()).toContain('Ben Reyes needs Project manager on to take over.')
  expect(onDone).not.toHaveBeenCalled()
  expect(toast).not.toHaveBeenCalled()
})
