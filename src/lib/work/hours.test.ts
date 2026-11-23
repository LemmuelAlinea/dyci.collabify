import { describe, expect, it } from 'vitest'
import { formatHours, formatSpent, parseHours } from './hours'

describe('formatSpent', () => {
  it('shows hours and minutes', () => {
    expect(formatSpent(440)).toBe('7 h 20 m')
    expect(formatSpent(120)).toBe('2 h')
    expect(formatSpent(45)).toBe('45 m')
    expect(formatSpent(0)).toBe('0 m')
  })
})

describe('formatHours', () => {
  it('shows at most one decimal', () => {
    expect(formatHours(840)).toBe('14 h')
    expect(formatHours(90)).toBe('1.5 h')
    expect(formatHours(20)).toBe('0.3 h')
  })
})

describe('parseHours', () => {
  it('reads hours as minutes', () => {
    expect(parseHours('1.5')).toBe(90)
    expect(parseHours('1000')).toBe(60000)
  })
  it('treats empty as no estimate', () => {
    expect(parseHours('')).toBeNull()
    expect(parseHours('  ')).toBeNull()
  })
  it('refuses anything else', () => {
    for (const t of ['0', '-1', 'abc', '1001', '0.001']) expect(parseHours(t)).toBe('invalid')
  })
})
