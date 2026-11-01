import { describe, expect, it, vi } from 'vitest'
import { isMissingSprintSettingsTable } from './sprints'

vi.mock('../supabase', () => ({ supabase: {} }))

describe('isMissingSprintSettingsTable', () => {
  it('accepts the PostgREST and Postgres missing-table codes', () => {
    expect(isMissingSprintSettingsTable({ code: 'PGRST205', message: 'x' })).toBe(true)
    expect(isMissingSprintSettingsTable({ code: '42P01' })).toBe(true)
  })

  it('accepts a message naming the table as missing', () => {
    expect(
      isMissingSprintSettingsTable({ message: 'relation "public.general_sprint_settings" does not exist' }),
    ).toBe(true)
    expect(
      isMissingSprintSettingsTable(new Error("Could not find the table 'public.general_sprint_settings' in the schema cache")),
    ).toBe(true)
  })

  it('rejects every other error', () => {
    expect(isMissingSprintSettingsTable({ code: '42501', message: 'permission denied for table general_sprint_settings' })).toBe(false)
    expect(isMissingSprintSettingsTable({ message: 'relation "other" does not exist' })).toBe(false)
    expect(isMissingSprintSettingsTable(new Error('Failed to fetch'))).toBe(false)
    expect(isMissingSprintSettingsTable(null)).toBe(false)
    expect(isMissingSprintSettingsTable('general_sprint_settings does not exist')).toBe(false)
    expect(isMissingSprintSettingsTable(undefined)).toBe(false)
  })
})
