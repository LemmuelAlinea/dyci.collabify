import { describe, expect, it } from 'vitest'
import { auditSentence } from './types'
import type { AuditEvent } from './types'

const event = (over: Partial<AuditEvent>): AuditEvent =>
  ({
    id: 'e1',
    at: '2026-11-14T00:00:00Z',
    action: 'office_created',
    actor_id: null,
    actor_name: '',
    actor_avatar: null,
    subject_id: null,
    subject_label: '',
    class_id: null,
    class_label: '',
    before_value: '',
    after_value: '',
    ...over,
  }) as AuditEvent

describe('auditSentence for offices', () => {
  it('never doubles "office" when the name already ends in it', () => {
    expect(auditSentence(event({ action: 'office_deleted', subject_label: 'Walk test office' }))).toBe(
      'The office Walk test office was deleted',
    )
  })

  it('never doubles "space" when the name already ends in it', () => {
    expect(
      auditSentence(
        event({ action: 'space_office_changed', subject_label: 'Walk through space', after_value: 'Registrar' }),
      ),
    ).toBe('The space Walk through space moved from No office to Registrar')
  })
})

describe('auditSentence for offboarding', () => {
  it('an offboarded line names the successor and the counts', () => {
    expect(
      auditSentence(
        event({ action: 'offboarded', subject_label: 'Ana Cruz', after_value: 'Ben Reyes', before_value: '2 spaces, 3 projects' }),
      ),
    ).toBe('Ana Cruz was offboarded and handed over to Ben Reyes (2 spaces, 3 projects)')
    expect(auditSentence(event({ action: 'offboarded', subject_label: 'Ana Cruz', after_value: 'Ben Reyes' }))).toBe(
      'Ana Cruz was offboarded and handed over to Ben Reyes',
    )
  })

  it('a space PM assignment names the space and the manager', () => {
    expect(auditSentence(event({ action: 'space_pm_assigned', subject_label: 'Lab', after_value: 'Ben Reyes' }))).toBe(
      'The space Lab now has Ben Reyes as project manager',
    )
  })
})
