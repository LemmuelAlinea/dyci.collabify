import { describe, expect, it } from 'vitest'
import {
  bulkPasswordError,
  bulkSetupChoice,
  isActiveBulkAdmin,
  normalizeBulkUser,
  unknownOfficeWarning,
} from '../../supabase/functions/_shared/bulkAccounts'
import { parseBulkCsv } from './bulkAccounts'

const D = 'dyci.edu.ph'
const header = 'first_name,middle_name,last_name,email,role\n'

describe('bulk registration CSV', () => {
  it('reads BOM, quoted commas and line breaks, and normalizes values', () => {
    const rows = parseBulkCsv(`\uFEFF${header}" Ana, Marie ","De\nLeon",Cruz,ANA@DYCI.EDU.PH,Student`, D)
    expect(rows).toHaveLength(1)
    expect(rows[0].user).toEqual({
      first_name: 'Ana, Marie', middle_name: 'De\nLeon', last_name: 'Cruz',
      email: 'ana@dyci.edu.ph', role: 'student',
    })
  })

  it('reports invalid and repeated rows without hiding valid ones', () => {
    const rows = parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph,student\nBo,,Lee,BO@evil.dyci.edu.ph,member\nAna,,Cruz,ANA@DYCI.EDU.PH,student`, D)
    expect(rows.map((row) => row.error)).toEqual([
      undefined, 'Use a valid @dyci.edu.ph email.', 'Duplicate email in this CSV.',
    ])
  })

  it('rejects malformed files and missing columns', () => {
    expect(() => parseBulkCsv(`${header}"Ana,,Cruz,ana@dyci.edu.ph,student`, D)).toThrow('Unclosed quote')
    expect(() => parseBulkCsv('first_name,email,role\nAna,ana@dyci.edu.ph,student', D)).toThrow('Missing last_name')
    expect(() => parseBulkCsv(`${header.replace('role', 'password,role')}Ana,,Cruz,secret,ana@dyci.edu.ph,student`, D)).toThrow('Unexpected password column')
    expect(() => parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph`, D)).not.toThrow()
    const tooMany = Array.from({ length: 101 }, (_, i) => `A,,B,user${i}@dyci.edu.ph,student`).join('\n')
    expect(() => parseBulkCsv(`${header}${tooMany}`, D)).toThrow('at most 100')
  })

  it('reads an optional office column and trims it', () => {
    const rows = parseBulkCsv('first_name,last_name,email,role,office\nAna,Cruz,ana@dyci.edu.ph,member,"  IT Services  "', D)
    expect(rows[0].office).toBe('IT Services')
    expect(rows[0].user?.office).toBe('IT Services')
    expect(rows[0].warning).toBeUndefined()
  })

  it('a file without an office column still parses', () => {
    const rows = parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph,member`, D)
    expect(rows[0].error).toBeUndefined()
    expect(rows[0].office).toBe('')
    expect(rows[0].user?.office).toBeUndefined()
  })

  it('an office on a student row is kept for the preview with a warning', () => {
    const rows = parseBulkCsv('first_name,last_name,email,role,office\nAna,Cruz,ana@dyci.edu.ph,student,Registrar', D)
    expect(rows[0].user).toBeDefined()
    expect(rows[0].office).toBe('Registrar')
    expect(rows[0].warning).toBe('Students have no office. It will be ignored.')
  })
})

describe('server-side bulk validation', () => {
  it('allows only students and members at the exact school domain', () => {
    expect(normalizeBulkUser({ first_name: ' A ', last_name: ' B ', email: 'A@DYCI.EDU.PH', role: 'Member' }, D).user)
      .toMatchObject({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph', role: 'member' })
    expect(normalizeBulkUser({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph.evil', role: 'student' }, D).error)
      .toContain('@dyci.edu.ph')
    expect(normalizeBulkUser({ first_name: 'A', last_name: 'B', email: 'a@dyci.edu.ph', role: 'admin' }, D).error)
      .toBe('Role must be student or member.')
  })

  it('requires a strong shared password', () => {
    expect(bulkPasswordError('short')).toContain('12 to 128')
    expect(bulkPasswordError('twelve chars')).toBeNull()
  })

  it('only defers the first password change when explicitly requested', () => {
    expect(bulkSetupChoice({})).toEqual({ error: 'Enter a password.' })
    expect(bulkSetupChoice({ deferPasswordChange: true })).toEqual({})
    expect(bulkSetupChoice({ deferPasswordChange: true, newPassword: 'new-password' }).error).toBeTruthy()
    expect(bulkSetupChoice({ newPassword: 'new-password' })).toEqual({ password: 'new-password' })
  })

  it('refuses everyone except an active admin', () => {
    expect(isActiveBulkAdmin({ role: 'admin', status: 'active' })).toBe(true)
    expect(isActiveBulkAdmin({ role: 'member', status: 'active' })).toBe(false)
    expect(isActiveBulkAdmin({ role: 'admin', status: 'pending' })).toBe(false)
    expect(isActiveBulkAdmin(null)).toBe(false)
  })

  it('says what happened to the office an unknown name named', () => {
    expect(unknownOfficeWarning('Registrar', 'created')).toBe('No office named Registrar. Imported with no office.')
    expect(unknownOfficeWarning('Registrar', 'updated')).toBe('No office named Registrar. Office left as it was.')
  })

  it('cuts an over-long office name to 80 characters without doubling the stop', () => {
    const long = 'x'.repeat(90)
    const created = unknownOfficeWarning(long, 'created')
    expect(created).toBe(`No office named ${'x'.repeat(80)}… Imported with no office.`)
    expect(created).not.toContain('….')
    expect(unknownOfficeWarning(long, 'updated')).toBe(`No office named ${'x'.repeat(80)}… Office left as it was.`)
  })
})

describe('configured school domain', () => {
  const row = (email: string) => ({ first_name: 'A', last_name: 'B', email, role: 'student' })

  it('refuses the old domain and accepts the configured one', () => {
    expect(normalizeBulkUser(row('a@dyci.edu.ph'), 'school.test').error).toBe('Use a valid @school.test email.')
    expect(normalizeBulkUser(row('a@school.test'), 'school.test').user?.email).toBe('a@school.test')
    expect(normalizeBulkUser(row('a@school.test'), 'School.Test').user).toBeDefined()
  })

  it('takes the dots in the domain literally', () => {
    expect(normalizeBulkUser(row('a@schoolxtest'), 'school.test').error).toBeTruthy()
    expect(normalizeBulkUser(row('a@evil-school.test'), 'school.test').error).toBeTruthy()
  })

  it('previews each CSV row against the configured domain', () => {
    const rows = parseBulkCsv(`${header}Ana,,Cruz,ana@dyci.edu.ph,student\nBo,,Lee,bo@school.test,member`, 'school.test')
    expect(rows.map((r) => r.error)).toEqual(['Use a valid @school.test email.', undefined])
  })
})
