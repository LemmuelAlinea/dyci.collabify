import { describe, expect, it } from 'vitest'
import { gate, type GateProfile } from './gate'

const p = (role: GateProfile['role'], status: GateProfile['status']): GateProfile => ({
  role,
  status,
})

describe('gate', () => {
  it('sends a visitor with no session to login', () => {
    expect(gate(false, null)).toBe('/login')
    expect(gate(false, p('student', 'active'))).toBe('/login')
    expect(gate(false, null, { open: true })).toBe('/login')
    expect(gate(false, null, { allow: ['admin'] })).toBe('/login')
  })

  it('sends a session with no profile yet to onboarding', () => {
    expect(gate(true, null)).toBe('/onboarding')
    expect(gate(true, undefined, { open: true })).toBe('/onboarding')
  })

  it('sends a rejected account to pending, open or not', () => {
    expect(gate(true, p('student', 'rejected'))).toBe('/pending')
    expect(gate(true, p(null, 'rejected'), { open: true })).toBe('/pending')
    expect(gate(true, p('admin', 'rejected'), { allow: ['admin'] })).toBe('/pending')
  })

  it('sends a pending account to pending, unless the route is open', () => {
    expect(gate(true, p('professor', 'pending'))).toBe('/pending')
    expect(gate(true, p('professor', 'pending'), { open: true })).toBe('ok')
  })

  it('sends a role-less active account to pending, unless the route is open', () => {
    expect(gate(true, p(null, 'active'))).toBe('/pending')
    expect(gate(true, p(null, 'active'), { open: true })).toBe('ok')
  })

  it('lets an open route through as soon as there is a non-rejected profile', () => {
    expect(gate(true, p('student', 'active'), { open: true })).toBe('ok')
    expect(gate(true, p('student', 'pending'), { open: true })).toBe('ok')
  })

  it('admits any role when there is no allow list', () => {
    expect(gate(true, p('student', 'active'))).toBe('ok')
    expect(gate(true, p('professor', 'active'))).toBe('ok')
    expect(gate(true, p('admin', 'active'))).toBe('ok')
  })

  it('admits a role on the allow list', () => {
    expect(gate(true, p('student', 'active'), { allow: ['student'] })).toBe('ok')
    expect(gate(true, p('professor', 'active'), { allow: ['professor', 'admin'] })).toBe('ok')
    expect(gate(true, p('admin', 'active'), { allow: ['professor', 'admin'] })).toBe('ok')
  })

  it('sends home a role not on the allow list', () => {
    expect(gate(true, p('student', 'active'), { allow: ['professor', 'admin'] })).toBe('/home')
    expect(gate(true, p('professor', 'active'), { allow: ['admin'] })).toBe('/home')
    expect(gate(true, p('admin', 'active'), { allow: ['student'] })).toBe('/home')
  })
})
