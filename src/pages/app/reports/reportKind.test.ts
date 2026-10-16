import { describe, expect, it } from 'vitest'
import { chosenClass, parseReportKind } from './reportKind'

describe('parseReportKind', () => {
  it('reads a known report', () => {
    for (const k of ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables', 'formal', 'activity']) {
      expect(parseReportKind(k)).toBe(k)
    }
  })
  it('falls back to the grading sheet for anything else', () => {
    expect(parseReportKind(null)).toBe('grading')
    expect(parseReportKind('toString')).toBe('grading')
    expect(parseReportKind('__proto__')).toBe('grading')
  })
})

describe('chosenClass', () => {
  it('takes the locked class over the address', () => {
    expect(chosenClass('formal', 'all', 'c-locked', 'c1')).toEqual({ classId: 'c-locked', allClasses: false })
  })
  it('reads all as every class on the term record only', () => {
    expect(chosenClass('formal', 'all', undefined, 'c1')).toEqual({ classId: '', allClasses: true })
  })
  it('never lets all reach a report about one class', () => {
    expect(chosenClass('grading', 'all', undefined, 'c1')).toEqual({ classId: 'c1', allClasses: false })
    expect(chosenClass('activity', 'all', undefined, undefined)).toEqual({ classId: '', allClasses: false })
  })
  it('takes the class in the address, or the first', () => {
    expect(chosenClass('notes', 'c2', undefined, 'c1')).toEqual({ classId: 'c2', allClasses: false })
    expect(chosenClass('notes', null, undefined, 'c1')).toEqual({ classId: 'c1', allClasses: false })
  })
})
