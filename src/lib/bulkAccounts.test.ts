import { describe, expect, it } from 'vitest'
import { bulkPasswordError, isActiveBulkAdmin, normalizeBulkUser } from '../../supabase/functions/_shared/bulkAccounts'
import { parseBulkCsv } from './bulkAccounts'

const header = 'first_name,middle_name,last_name,email,role\n'

describe('bulk registration CSV', () => {
  it('reads BOM, quoted commas and line breaks, and normalizes values', () => {
    const rows = parseBulkCsv(`\uFEFF${header}" Ana, Marie ","De\nLeon",Cruz,ANA@DYCI.EDU.PH,Student`)
    expect(rows).toHaveLength(1)
    expect(rows[0].user).toEqual({
      first_name: 'Ana, Marie', middle_name: 'De\nLeon', last_name: 'Cruz',
      email: 'ana@dyci.edu.ph', role: 'student',
    })
  })

  it('reports invalid and repeated rows without hiding valid ones', () => {
    const rows = parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph,student\nBo,,Lee,BO@evil.dyci.edu.ph,member\nAna,,Cruz,ANA@DYCI.EDU.PH,student`)
    expect(rows.map((row) => row.error)).toEqual([
      undefined, 'Use a valid @dyci.edu.ph email.', 'Duplicate email in this CSV.',
    ])
  })

  it('rejects malformed files and missing columns', () => {
    expect(() => parseBulkCsv(`${header}"Ana,,Cruz,ana@dyci.edu.ph,student`)).toThrow('Unclosed quote')
    expect(() => parseBulkCsv('first_name,email,role\nAna,ana@dyci.edu.ph,student')).toThrow('Missing last_name')
    expect(() => parseBulkCsv(`${header.replace('role', 'password,role')}Ana,,Cruz,secret,ana@dyci.edu.ph,student`)).toThrow('Unexpected password column')
    expect(() => parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph`)).not.toThrow()
    const tooMany = Array.from({ length: 101 }, (_, i) => `A,,B,user${i}@dyci.edu.ph,student`).join('\n')
    expect(() => parseBulkCsv(`${header}${tooMany}`)).toThrow('at most 100')
  })
})

describe('server-side bulk validation', () => {
  it('allows only students and members at the exact school domain', () => {
    expect(normalizeBulkUser({ first_name: ' A ', last_name: ' B ', email: 'A@DYCI.EDU.PH', role: 'Member' }).user)
      .toMatchObject({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph', role: 'member' })
    expect(normalizeBulkUser({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph.evil', role: 'student' }).error)
      .toContain('@dyci.edu.ph')
    expect(normalizeBulkUser({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph', role: 'admin' }).error)
      .toBe('Role must be student or member.')
  })

  it('requires a strong shared password', () => {
    expect(bulkPasswordError('short')).toContain('12 to 128')
    expect(bulkPasswordError('twelve chars')).toBeNull()
  })

  it('refuses everyone except an active admin', () => {
    expect(isActiveBulkAdmin({ role: 'admin', status: 'active' })).toBe(true)
    expect(isActiveBulkAdmin({ role: 'member', status: 'active' })).toBe(false)
    expect(isActiveBulkAdmin({ role: 'admin', status: 'pending' })).toBe(false)
    expect(isActiveBulkAdmin(null)).toBe(false)
  })
})
