import { describe, expect, it } from 'vitest'
import { isMissingColumn, isMissingRelation } from './missingRelation'

describe('isMissingRelation', () => {
  it('accepts the PostgREST and Postgres missing-table codes', () => {
    expect(isMissingRelation({ code: 'PGRST205', message: 'x' }, 'general_join_requests')).toBe(true)
    expect(isMissingRelation({ code: '42P01' }, 'general_join_requests')).toBe(true)
  })

  it('accepts a message naming the table as missing', () => {
    expect(
      isMissingRelation({ message: 'relation "public.general_join_requests" does not exist' }, 'general_join_requests'),
    ).toBe(true)
    expect(
      isMissingRelation(new Error("Could not find the table 'public.general_join_requests' in the schema cache"), 'general_join_requests'),
    ).toBe(true)
  })

  it('rejects every other error', () => {
    expect(isMissingRelation({ code: '42501', message: 'permission denied for table general_join_requests' }, 'general_join_requests')).toBe(false)
    expect(isMissingRelation({ message: 'relation "other" does not exist' }, 'general_join_requests')).toBe(false)
    expect(isMissingRelation(new Error('Failed to fetch'), 'general_join_requests')).toBe(false)
    expect(isMissingRelation(null, 'general_join_requests')).toBe(false)
    expect(isMissingRelation('general_join_requests does not exist', 'general_join_requests')).toBe(false)
  })
})

describe('isMissingColumn', () => {
  it('accepts the Postgres and PostgREST missing-column codes', () => {
    expect(isMissingColumn({ code: '42703', message: 'x' })).toBe(true)
    expect(isMissingColumn({ code: 'PGRST204', message: 'x' })).toBe(true)
  })

  it('accepts a message about a missing column', () => {
    expect(isMissingColumn({ message: 'column general_projects.color does not exist' })).toBe(true)
  })

  it('rejects every other error', () => {
    expect(isMissingColumn({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingColumn(new Error('Failed to fetch'))).toBe(false)
    expect(isMissingColumn(null)).toBe(false)
  })
})
