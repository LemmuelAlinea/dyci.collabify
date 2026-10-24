import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUS_LABEL,
  canPostFeedback,
  canSetFeedbackStatus,
  feedbackAuthor,
  feedbackStatusTone,
  safeFileName,
} from './feedback'

describe('feedback roles', () => {
  it('lets the pm, coordinators and stakeholders post', () => {
    expect(canPostFeedback('pm')).toBe(true)
    expect(canPostFeedback('coordinator')).toBe(true)
    expect(canPostFeedback('stakeholder')).toBe(true)
    expect(canPostFeedback('member')).toBe(false)
    expect(canPostFeedback('qa')).toBe(false)
    expect(canPostFeedback(null)).toBe(false)
  })

  it('lets only the pm and coordinators change a status', () => {
    expect(canSetFeedbackStatus('pm')).toBe(true)
    expect(canSetFeedbackStatus('coordinator')).toBe(true)
    expect(canSetFeedbackStatus('stakeholder')).toBe(false)
    expect(canSetFeedbackStatus('member')).toBe(false)
    expect(canSetFeedbackStatus(null)).toBe(false)
  })
})

describe('feedback labels', () => {
  it('maps each status to a tone', () => {
    expect(feedbackStatusTone('open')).toBe('pending')
    expect(feedbackStatusTone('acknowledged')).toBe('warning')
    expect(feedbackStatusTone('resolved')).toBe('success')
  })

  it('labels every kind and status', () => {
    expect(FEEDBACK_KIND_LABEL.approval_request).toBe('Approval request')
    expect(FEEDBACK_STATUS_LABEL.acknowledged).toBe('Acknowledged')
  })
})

describe('feedbackAuthor', () => {
  it('names a former member when the author is gone', () => {
    expect(feedbackAuthor(null, () => 'Ana')).toBe('Former member')
    expect(feedbackAuthor('u1', () => 'Ana')).toBe('Ana')
  })
})

describe('safeFileName', () => {
  it('keeps word characters, dots and dashes and trims to 120', () => {
    expect(safeFileName('Q3 plan (final).pdf')).toBe('Q3_plan_final_.pdf')
    expect(safeFileName('a'.repeat(200)).length).toBe(120)
  })
})
