import { describe, expect, it } from 'vitest'
import { inviteChecks, readInvitation } from './meetingInvite'

// 2026-11-10 08:00 in Manila.
const NOW = Date.UTC(2026, 10, 10, 0, 0)

const MEET = `(No title)
Tuesday, 10 November · 4:00 – 5:00pm
Time zone: Asia/Manila
Google Meet joining info
Video call link: https://meet.google.com/hxm-vdma-nbg`

const ZOOM = `Lemmuel Alinea is inviting you to a scheduled Zoom meeting.

Topic: Collabify
Time: Nov 11, 2026 07:00 AM Singapore

Join Zoom Meeting
https://us05web.zoom.us/j/86970303609?pwd=dSFYPqk8lKJRHKO9nlTP6OHrVfmKIp.1

Meeting chat link
https://us05web.zoom.us/launch/jc/86970303609

Meeting ID: 869 7030 3609
Passcode: 68JdZm`

describe('readInvitation', () => {
  it('reads a Google Meet invitation', () => {
    expect(readInvitation(MEET, NOW)).toEqual({
      platform: 'google_meet',
      joinUrl: 'https://meet.google.com/hxm-vdma-nbg',
      title: null,
      startsAt: '2026-11-10T08:00:00.000Z',
      durationMin: 60,
      details: '',
      unknownZone: null,
    })
  })

  it('reads a Zoom invitation and joins by the meeting link, not the chat link', () => {
    expect(readInvitation(ZOOM, NOW)).toEqual({
      platform: 'zoom',
      joinUrl: 'https://us05web.zoom.us/j/86970303609?pwd=dSFYPqk8lKJRHKO9nlTP6OHrVfmKIp.1',
      title: 'Collabify',
      startsAt: '2026-11-10T23:00:00.000Z',
      durationMin: null,
      details: 'Meeting ID: 869 7030 3609\nPasscode: 68JdZm',
      unknownZone: null,
    })
  })

  it('takes a named Meet title from the line above the time', () => {
    expect(readInvitation(MEET.replace('(No title)', 'Capstone check-in'), NOW)?.title).toBe('Capstone check-in')
  })

  it('reads an invitation with Windows line endings', () => {
    expect(readInvitation(ZOOM.replace(/\n/g, '\r\n'), NOW)?.title).toBe('Collabify')
  })

  const when = (line: string, zone = 'Asia/Manila') =>
    readInvitation(`Sync\n${line}\nTime zone: ${zone}\nhttps://meet.google.com/abc-defg-hij`, NOW)

  it('reads the month first too', () => {
    expect(when('Tuesday, November 10 · 4:00 – 5:00pm')?.startsAt).toBe('2026-11-10T08:00:00.000Z')
  })

  it('carries the half of the day back to the start, across noon too', () => {
    const r = when('Wednesday, 11 November · 11:30 – 12:30pm')
    expect(r?.startsAt).toBe('2026-11-11T03:30:00.000Z')
    expect(r?.durationMin).toBe(60)
  })

  it('reads a 24-hour clock', () => {
    const r = when('Wednesday, 11 November · 16:00 – 16:45')
    expect(r?.startsAt).toBe('2026-11-11T08:00:00.000Z')
    expect(r?.durationMin).toBe(45)
  })

  it('reads a call that runs past midnight', () => {
    expect(when('Wednesday, 11 November · 11:00pm – Thursday, 12 November · 1:00am')?.durationMin).toBe(120)
    expect(when('Wednesday, 11 November · 11:00pm – 1:00am')?.durationMin).toBe(120)
  })

  it('leaves out a length the meeting cannot have', () => {
    expect(when('Wednesday, 11 November · 8:00am – 6:00pm')?.durationMin).toBeNull()
  })

  it('finds next year for a date already gone, when the weekday agrees', () => {
    // 5 January 2027 is a Tuesday.
    expect(when('Tuesday, 5 January · 9:00 – 10:00am')?.startsAt).toBe('2027-01-05T01:00:00.000Z')
  })

  it('keeps this year when the weekday only fits a date gone by', () => {
    // 3 November 2026 was a Tuesday, 3 November 2027 is a Wednesday.
    expect(when('Tuesday, 3 November · 9:00 – 10:00am')?.startsAt).toBe('2026-11-03T01:00:00.000Z')
  })

  it('follows daylight saving in a named zone', () => {
    const zoom = (time: string) => readInvitation(`Topic: A\nTime: ${time}\nhttps://zoom.us/j/1`, NOW)?.startsAt
    expect(zoom('Jan 12, 2027 09:00 AM Eastern Time (US and Canada)')).toBe('2027-01-12T14:00:00.000Z')
    expect(zoom('Jul 12, 2027 09:00 AM Eastern Time (US and Canada)')).toBe('2027-07-12T13:00:00.000Z')
  })

  it('reads a GMT offset', () => {
    expect(readInvitation('Topic: A\nTime: Nov 11, 2026 07:00 AM GMT+8\nhttps://zoom.us/j/1', NOW)?.startsAt).toBe('2026-11-10T23:00:00.000Z')
  })

  it('names a time zone it does not know', () => {
    expect(readInvitation('Topic: A\nTime: Nov 11, 2026 07:00 AM Atlantis\nhttps://zoom.us/j/1', NOW)?.unknownZone).toBe('Atlantis')
  })

  it('reads a recurring Zoom meeting with no fixed time', () => {
    const r = readInvitation('Topic: Office hours\nTime: This is a recurring meeting Meet anytime\nhttps://zoom.us/j/1', NOW)
    expect(r?.title).toBe('Office hours')
    expect(r?.startsAt).toBeNull()
  })

  it('takes a bare link', () => {
    expect(readInvitation('https://meet.google.com/abc-defg-hij', NOW)?.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('prefers the call over a calendar page and drops trailing punctuation', () => {
    expect(
      readInvitation('See https://calendar.google.com/calendar/event?eid=a and join (https://meet.google.com/abc-defg-hij).', NOW)?.joinUrl,
    ).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('refuses text with no Meet or Zoom link', () => {
    expect(readInvitation('Lunch on Nov 11 at 12:00pm', NOW)).toBeNull()
    expect(readInvitation('Join at https://evil.example/zoom.us/j/1', NOW)).toBeNull()
  })
})

describe('inviteChecks', () => {
  const meet = readInvitation(MEET, NOW)!
  const zoom = readInvitation(ZOOM, NOW)!

  it('has nothing to raise for a full invitation still to come', () => {
    expect(inviteChecks(meet, false, NOW)).toEqual([])
  })

  it('says a Zoom invitation gives no length', () => {
    expect(inviteChecks(zoom, false, NOW)).toEqual(['It gives no length, so it is set to 1 hour.'])
  })

  it('says when the time has passed, unless the meeting starts now', () => {
    const later = Date.UTC(2026, 10, 10, 13, 40)
    expect(inviteChecks(meet, false, later)).toEqual(['Its start time has passed, so pick a new one.'])
    expect(inviteChecks(meet, true, later)).toEqual([])
  })
})
