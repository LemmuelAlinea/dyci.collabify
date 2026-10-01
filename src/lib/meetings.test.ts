import { describe, expect, it } from 'vitest'
import { canJoin, detectPlatform, meetingState, scopeOf } from './meetings'

describe('detectPlatform', () => {
  it('reads Google Meet and Zoom links, including Zoom subdomains', () => {
    expect(detectPlatform('https://meet.google.com/abc-defg-hij')).toBe('google_meet')
    expect(detectPlatform('  https://zoom.us/j/123456789 ')).toBe('zoom')
    expect(detectPlatform('https://us05web.zoom.us/j/123?pwd=x')).toBe('zoom')
    expect(detectPlatform('https://zoom.com/j/1')).toBe('zoom')
  })

  it('reads a Google Calendar invite as Meet, short or long form', () => {
    expect(detectPlatform('https://calendar.app.google/kBjhWJM22H7yeauq5')).toBe('google_meet')
    expect(detectPlatform('https://calendar.google.com/calendar/event?eid=abc')).toBe('google_meet')
    expect(detectPlatform('https://calendar.app.google/')).toBeNull()
    expect(detectPlatform('https://calendar.google.com/other/x')).toBeNull()
    expect(detectPlatform('https://calendar.app.google.evil.com/x')).toBeNull()
  })

  it('refuses anything else, as the database does', () => {
    expect(detectPlatform('http://meet.google.com/abc')).toBeNull()
    expect(detectPlatform('https://meet.google.com/')).toBeNull()
    expect(detectPlatform('https://notzoom.us.evil.com/j/1')).toBeNull()
    expect(detectPlatform('https://zoom.us.evil.com/j/1')).toBeNull()
    expect(detectPlatform('https://teams.microsoft.com/l/meetup')).toBeNull()
    expect(detectPlatform('')).toBeNull()
  })
})

describe('meetingState and canJoin', () => {
  const start = Date.parse('2026-10-06T07:00:00Z')
  const m = { starts_at: '2026-10-06T07:00:00Z', duration_min: 60, cancelled_at: null }

  it('moves from upcoming to live to ended', () => {
    expect(meetingState(m, start - 1)).toBe('upcoming')
    expect(meetingState(m, start)).toBe('live')
    expect(meetingState(m, start + 60 * 60_000)).toBe('ended')
  })

  it('opens Join fifteen minutes early and closes it at the end', () => {
    expect(canJoin(m, start - 16 * 60_000)).toBe(false)
    expect(canJoin(m, start - 15 * 60_000)).toBe(true)
    expect(canJoin(m, start + 59 * 60_000)).toBe(true)
    expect(canJoin(m, start + 60 * 60_000)).toBe(false)
  })

  it('treats a cancelled meeting as cancelled whatever the time', () => {
    const c = { ...m, cancelled_at: '2026-10-05T00:00:00Z' }
    expect(meetingState(c, start)).toBe('cancelled')
    expect(canJoin(c, start)).toBe(false)
  })
})

describe('scopeOf', () => {
  it('puts class and group meetings under Classes, the rest under Work', () => {
    expect(scopeOf({ scope: 'class' })).toBe('classes')
    expect(scopeOf({ scope: 'group' })).toBe('classes')
    expect(scopeOf({ scope: 'space' })).toBe('work')
    expect(scopeOf({ scope: 'project_team' })).toBe('work')
  })
})
