// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemberImportDialog } from './MemberImportDialog'
import * as api from '../../../lib/api/general'
import { extractMemberRoster } from '../../../lib/api/workAi'
import { readMemberImportFile, type RosterRow } from '../../../lib/general/memberImportFile'
import type { GeneralProjectState } from '../useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../../lib/api/general', () => ({
  listGeneralMembers: vi.fn(), listTeams: vi.fn(), listArchivedTeams: vi.fn(), listTeamMembers: vi.fn(),
  listPositions: vi.fn(), listPositionHolders: vi.fn(), listMemberSkills: vi.fn(), applyMemberImport: vi.fn(),
}))
vi.mock('../../../lib/api/workAi', () => ({ extractMemberRoster: vi.fn() }))
vi.mock('../../../lib/general/memberImportFile', () => ({ readMemberImportFile: vi.fn() }))

const member = (id = 'u1', first = 'Ana') => ({ user_id: id, role: 'member', joined_at: id === 'u1' ? '2026-11-01T12:00:00Z' : '2026-11-02T12:00:00Z', profile: { first_name: first, last_name: 'Cruz' } })
const row = (over: Partial<RosterRow> = {}): RosterRow => ({ name: 'Ana Cruz', source: 'Sheet A, row 2', teams: ['Design'], positions: [{ name: 'Designer', team: 'Design', scope: 'team' }], skills: [], present: { teams: true, positions: true, skills: false }, ...over })
const reload = vi.fn(async () => {})
const close = vi.fn()
const state = { project: { id: 'p1' }, reload } as unknown as GeneralProjectState

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listGeneralMembers).mockResolvedValue([member()] as never)
  for (const fn of [api.listTeams, api.listArchivedTeams, api.listTeamMembers, api.listPositions, api.listPositionHolders, api.listMemberSkills]) vi.mocked(fn).mockResolvedValue([])
  vi.mocked(api.listMemberSkills).mockResolvedValue([{ user_id: 'u1', tag: 'CSS' }] as never)
  vi.mocked(readMemberImportFile).mockResolvedValue({ fileName: 'roster.xlsx', text: 'temporary roster' })
  vi.mocked(extractMemberRoster).mockResolvedValue({ result: 'ok', rows: [row()] })
})

async function mounted(run: (host: HTMLElement, render: (open?: boolean) => Promise<void>) => Promise<void>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try { await run(document.body, (open = true) => act(async () => root.render(open ? <MemberImportDialog state={state} onClose={close} /> : null))) }
  finally { await act(async () => root.unmount()); host.remove() }
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
async function upload(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['roster'], 'roster.xlsx')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
async function confirm(host: HTMLElement) { await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="I reviewed these changes"]')!.click()) }

it('discloses AI processing and refuses unknown people before any assignment draft', async () => {
  vi.mocked(extractMemberRoster).mockResolvedValue({ result: 'ok', rows: [row({ name: 'Unknown Person' })] })
  await mounted(async (host, render) => {
    await render()
    expect(host.textContent).toContain('5 MB')
    expect(host.textContent).toContain('AI service')
    await upload(host)
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/Unknown Person.*[Rr]emove.*invite/)
    expect(button(host, 'Apply')).toBeUndefined()
    expect(host.textContent).not.toContain('Proposed')
    expect(host.querySelector('input[type=checkbox]')).toBeNull()
  })
})

it('requires an explicit choice between duplicate project members', async () => {
  vi.mocked(api.listGeneralMembers).mockResolvedValue([member(), member('u2')] as never)
  await mounted(async (host, render) => {
    await render(); await upload(host)
    expect(button(host, 'Apply')).toBeUndefined()
    const candidates = [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    expect(candidates.map(input => input.value)).toEqual(['u1', 'u2'])
    expect(candidates.every(input => !input.checked)).toBe(true)
    expect(candidates[0].closest('label')?.textContent).toContain('Member · Joined Nov 1, 2026')
    expect(candidates[1].closest('label')?.textContent).toContain('Member · Joined Nov 2, 2026')
    expect(host.textContent).toContain('If you cannot identify the person, stop and check the project roster before choosing.')
    await act(async () => candidates[1].click())
    expect(host.textContent).toContain('Proposed')
    await confirm(host); await act(async () => button(host, 'Apply').click())
    expect(api.applyMemberImport).toHaveBeenCalledWith('p1', 'add', expect.objectContaining({ rows: [expect.objectContaining({ user_id: 'u2' })] }))
  })
})

it('reviews Add and Replace, creations, preservation, counts and exclusions before confirmation', async () => {
  vi.mocked(api.listTeams).mockResolvedValue([{ id: 't1', name: 'Old team', archived_at: null, leader_id: null }] as never)
  vi.mocked(api.listTeamMembers).mockResolvedValue([{ team_id: 't1', user_id: 'u1' }] as never)
  await mounted(async (host, render) => {
    await render(); await upload(host)
    expect(host.textContent).toContain('Current')
    expect(host.textContent).toContain('Old team')
    expect(host.textContent).toContain('New teams: Design')
    expect(host.textContent).toContain('New positions: Design / Designer')
    expect(host.textContent).toContain('CSS')
    expect(host.textContent).toContain('Blank fields stay unchanged')
    expect(button(host, 'Apply').disabled).toBe(true)
    const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Import mode"]')!
    await act(async () => { mode.value = 'replace'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.textContent).toContain('1 changed member')
    expect(host.textContent).toContain('1 removal')
    await confirm(host)
    expect(button(host, 'Apply').disabled).toBe(false)
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Include Ana Cruz"]')!.click())
    expect(host.textContent).toContain('Excluded: Ana Cruz')
    expect(button(host, 'Apply').disabled).toBe(true)
  })
})

it('blocks unknown position scope without enabling Apply', async () => {
  vi.mocked(extractMemberRoster).mockResolvedValue({ result: 'ok', rows: [row({ positions: [{ name: 'Designer', team: '', scope: 'unknown' }] })] })
  await mounted(async (host, render) => {
    await render(); await upload(host)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('clear team')
    await confirm(host)
    expect(button(host, 'Apply').disabled).toBe(true)
  })
})

it('refreshes raw archived structure and returns to review when current values change', async () => {
  vi.mocked(api.listArchivedTeams).mockResolvedValue([{ id: 'old', name: 'Archived', leader_id: null, archived_at: 'yesterday' }] as never)
  vi.mocked(api.listTeamMembers).mockResolvedValue([{ team_id: 'old', user_id: 'u1' }] as never)
  await mounted(async (host, render) => {
    await render(); await upload(host); await confirm(host)
    vi.mocked(api.listMemberSkills).mockResolvedValue([{ user_id: 'u1', tag: 'HTML' }] as never)
    await act(async () => button(host, 'Apply').click())
    expect(api.applyMemberImport).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Review the refreshed changes')
    expect(host.textContent).toContain('HTML')
    expect(button(host, 'Apply').disabled).toBe(true)
    await confirm(host); await act(async () => button(host, 'Apply').click())
    expect(api.applyMemberImport).toHaveBeenCalledWith('p1', 'add', expect.objectContaining({ expected: expect.objectContaining({ teams: [{ id: 'old', name: 'Archived', leader_id: null, archived: true }] }) }))
    expect(reload).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})

it('keeps a refused draft for retry and discards it on close and reopen', async () => {
  vi.mocked(api.applyMemberImport).mockRejectedValueOnce(new Error('Permission changed. Refresh and try again.'))
  await mounted(async (host, render) => {
    await render(); await upload(host); await confirm(host)
    await act(async () => button(host, 'Apply').click())
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Permission changed')
    expect(host.textContent).toContain('Designer')
    expect(close).not.toHaveBeenCalled()
    await render(false); await render()
    expect(host.textContent).not.toContain('Designer')
    expect(button(host, 'Apply')).toBeUndefined()
  })
})

it('ignores an extraction completed after the dialog is discarded', async () => {
  let finish!: (value: Awaited<ReturnType<typeof extractMemberRoster>>) => void
  vi.mocked(extractMemberRoster).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mounted(async (host, render) => {
    await render(); await upload(host); await render(false)
    await act(async () => finish({ result: 'ok', rows: [row()] }))
    await render()
    expect(host.textContent).not.toContain('Designer')
  })
})
