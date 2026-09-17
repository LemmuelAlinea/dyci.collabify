import { describe, expect, it } from 'vitest'
import {
  FIELD_TYPES,
  checkFieldValue,
  checkOptions,
  formatFieldValue,
  isChoice,
  isEmptyValue,
} from './fields'

/**
 * Mirrors `guard_general_field_value()` in supabase/general.sql. The form checks
 * first so somebody sees the reason before the database refuses the save.
 */

const ctx = { options: ['Gym', 'Covered court'], memberIds: ['u1', 'u2'] }
const ok = (type: Parameters<typeof checkFieldValue>[0], raw: unknown) =>
  checkFieldValue(type, raw, ctx)

describe('FIELD_TYPES', () => {
  it('lists the ten types the spec names', () => {
    expect(FIELD_TYPES.map((t) => t.value)).toEqual([
      'short_text',
      'long_text',
      'number',
      'money',
      'date',
      'single_choice',
      'multi_choice',
      'yes_no',
      'member',
      'link',
    ])
  })

  it('knows which types carry options', () => {
    expect(isChoice('single_choice')).toBe(true)
    expect(isChoice('multi_choice')).toBe(true)
    expect(isChoice('short_text')).toBe(false)
  })
})

describe('isEmptyValue', () => {
  it('treats blank input as no value', () => {
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue([])).toBe(true)
  })

  it('keeps false and zero, which are answers', () => {
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
  })
})

describe('checkFieldValue', () => {
  it('trims text and caps its length', () => {
    expect(ok('short_text', '  Venue  ')).toEqual({ ok: true, value: 'Venue' })
    expect(ok('short_text', 'x'.repeat(201)).ok).toBe(false)
    expect(ok('long_text', 'x'.repeat(10000)).ok).toBe(true)
    expect(ok('long_text', 'x'.repeat(10001)).ok).toBe(false)
  })

  it('reads a number from a form string', () => {
    expect(ok('number', '42')).toEqual({ ok: true, value: 42 })
    expect(ok('number', 'forty').ok).toBe(false)
  })

  it('keeps money at or above zero with two decimals at most', () => {
    expect(ok('money', '1500.50')).toEqual({ ok: true, value: 1500.5 })
    expect(ok('money', '0.07')).toEqual({ ok: true, value: 0.07 })
    expect(ok('money', '-1').ok).toBe(false)
    expect(ok('money', '10.505').ok).toBe(false)
  })

  it('accepts a real calendar date only', () => {
    expect(ok('date', '2026-10-12')).toEqual({ ok: true, value: '2026-10-12' })
    expect(ok('date', '2026-02-30').ok).toBe(false)
    expect(ok('date', '12/10/2026').ok).toBe(false)
  })

  it('holds a choice to the options', () => {
    expect(ok('single_choice', 'Gym')).toEqual({ ok: true, value: 'Gym' })
    expect(ok('single_choice', 'Field').ok).toBe(false)
    expect(ok('multi_choice', ['Gym', 'Covered court'])).toEqual({
      ok: true,
      value: ['Gym', 'Covered court'],
    })
    expect(ok('multi_choice', ['Gym', 'Gym']).ok).toBe(false)
    expect(ok('multi_choice', ['Field']).ok).toBe(false)
  })

  it('takes yes or no as a boolean', () => {
    expect(ok('yes_no', false)).toEqual({ ok: true, value: false })
    expect(ok('yes_no', 'yes').ok).toBe(false)
  })

  it('holds a member field to the project', () => {
    expect(ok('member', 'u1')).toEqual({ ok: true, value: 'u1' })
    expect(ok('member', 'stranger').ok).toBe(false)
  })

  it('takes web links only', () => {
    expect(ok('link', 'https://dyci.edu.ph')).toEqual({ ok: true, value: 'https://dyci.edu.ph' })
    expect(ok('link', 'javascript:alert(1)').ok).toBe(false)
    expect(ok('link', 'dyci.edu.ph').ok).toBe(false)
  })
})

describe('checkOptions', () => {
  it('needs at least one distinct option for a choice', () => {
    expect(checkOptions('single_choice', [])).not.toBeNull()
    expect(checkOptions('single_choice', ['Gym', 'gym'])).not.toBeNull()
    expect(checkOptions('single_choice', ['Gym', ' '])).not.toBeNull()
    expect(checkOptions('multi_choice', ['Gym', 'Court'])).toBeNull()
  })

  it('refuses options on a type that has none', () => {
    expect(checkOptions('short_text', ['Gym'])).not.toBeNull()
    expect(checkOptions('short_text', [])).toBeNull()
  })
})

describe('formatFieldValue', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'Ana Reyes' : 'Somebody')

  it('shows pesos, yes or no, names and lists', () => {
    expect(formatFieldValue('money', 1500.5, nameOf)).toBe('₱1,500.50')
    expect(formatFieldValue('yes_no', true, nameOf)).toBe('Yes')
    expect(formatFieldValue('member', 'u1', nameOf)).toBe('Ana Reyes')
    expect(formatFieldValue('multi_choice', ['Gym', 'Court'], nameOf)).toBe('Gym, Court')
  })

  it('shows a date without shifting it a day', () => {
    expect(formatFieldValue('date', '2026-10-12', nameOf)).toBe('Oct 12, 2026')
  })
})
