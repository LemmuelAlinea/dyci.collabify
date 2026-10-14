import { describe, expect, it } from 'vitest'
import { parseReportKind } from './reportKind'

describe('parseReportKind', () => {
  it('reads a known report', () => {
    expect(parseReportKind('grading')).toBe('grading')
    expect(parseReportKind('peer')).toBe('peer')
    expect(parseReportKind('checkin')).toBe('checkin')
    expect(parseReportKind('notes')).toBe('notes')
    expect(parseReportKind('progress')).toBe('progress')
    expect(parseReportKind('deliverables')).toBe('deliverables')
  })
  it('falls back to the grading sheet for anything else', () => {
    expect(parseReportKind(null)).toBe('grading')
    expect(parseReportKind('toString')).toBe('grading')
    expect(parseReportKind('__proto__')).toBe('grading')
  })
})
