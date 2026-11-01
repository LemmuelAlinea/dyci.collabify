import { expect, it } from 'vitest'
import { openSettingsRequests } from './openRequests'

const requests = [{ status: 'open' }, { status: 'approved' }] as never[]
const joinRequests = [{ status: 'open' }, { status: 'open' }, { status: 'declined' }] as never[]
const base = { canGrant: true, archived: false, myRole: 'pm' as const, requests, joinRequests }

it('adds open access requests and open join requests for the project manager and coordinators', () => {
  expect(openSettingsRequests(base)).toBe(3)
  expect(openSettingsRequests({ ...base, myRole: 'coordinator' })).toBe(3)
})

it('leaves join requests out when the project is archived', () => {
  expect(openSettingsRequests({ ...base, archived: true })).toBe(1)
})

it('counts nothing for somebody who cannot answer requests', () => {
  expect(openSettingsRequests({ ...base, canGrant: false, myRole: 'member' })).toBe(0)
  expect(openSettingsRequests({ ...base, canGrant: false, myRole: null })).toBe(0)
})
