/**
 * Read the invitation text Google Meet and Zoom give you to share.
 *
 * Nothing here talks to either service. It reads the words someone pasted, so
 * whatever it cannot find stays for the person to fill in, and `inviteChecks`
 * says what that was.
 */
import { PLATFORM_LABEL, detectPlatform } from './meetings'
import type { MeetingPlatform } from './meetings'

export type MeetingInvite = {
  platform: MeetingPlatform
  joinUrl: string
  /** Null when the invitation has none, Google's "(No title)" included. */
  title: string | null
  startsAt: string | null
  durationMin: number | null
  /** Meeting ID and passcode, for whoever joins without the link. */
  details: string
  /** The time zone wording, when Collabify does not know it. */
  unknownZone: string | null
}

const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
// "10 November", "November 10", "Nov 11, 2026", "11 Nov 2026".
const DATE = new RegExp(
  `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})|(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b(?:,?\\s+(\\d{4})\\b)?`,
  'i',
)
// "4:00pm", "07:00 AM", "4pm" or a 24-hour "16:00".
const TIME = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\b\.?|\b(\d{1,2}):(\d{2})\b/gi
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Zoom writes a place or a region where the zone goes, so match the wording. */
const ZONE_NAMES: [RegExp, string][] = [
  [/manila|philippine/i, 'Asia/Manila'],
  [/singapore/i, 'Asia/Singapore'],
  [/kuala lumpur|malaysia/i, 'Asia/Kuala_Lumpur'],
  [/hong kong/i, 'Asia/Hong_Kong'],
  [/beijing|shanghai|china/i, 'Asia/Shanghai'],
  [/taipei|taiwan/i, 'Asia/Taipei'],
  [/perth/i, 'Australia/Perth'],
  [/tokyo|osaka|sapporo|japan/i, 'Asia/Tokyo'],
  [/seoul|korea/i, 'Asia/Seoul'],
  [/jakarta|indonesia/i, 'Asia/Jakarta'],
  [/bangkok|thailand/i, 'Asia/Bangkok'],
  [/hanoi|vietnam/i, 'Asia/Ho_Chi_Minh'],
  [/mumbai|kolkata|delhi|india/i, 'Asia/Kolkata'],
  [/dubai|abu dhabi/i, 'Asia/Dubai'],
  [/riyadh|kuwait/i, 'Asia/Riyadh'],
  [/doha|qatar/i, 'Asia/Qatar'],
  [/london/i, 'Europe/London'],
  [/dublin/i, 'Europe/Dublin'],
  [/paris|madrid|rome|berlin|amsterdam/i, 'Europe/Paris'],
  [/sydney|melbourne|canberra/i, 'Australia/Sydney'],
  [/brisbane/i, 'Australia/Brisbane'],
  [/auckland|wellington/i, 'Pacific/Auckland'],
  [/pacific time/i, 'America/Los_Angeles'],
  [/mountain time/i, 'America/Denver'],
  [/central time/i, 'America/Chicago'],
  [/eastern time/i, 'America/New_York'],
  [/universal time|greenwich|^(utc|gmt)$/i, 'UTC'],
]

/** A named zone, a fixed offset, or null for the reader's own clock. */
type Zone = { tz: string } | { offsetMs: number } | null

/** The zone a label names. Undefined when the label means nothing to us. */
function readZone(label: string): Zone | undefined {
  if (!label) return null
  const offset = /(?:gmt|utc)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i.exec(label)
  if (offset) {
    const size = Number(offset[2]) * 3_600_000 + Number(offset[3] ?? 0) * 60_000
    return { offsetMs: offset[1] === '-' ? -size : size }
  }
  if (/^[a-z_]+\/[a-z_/+-]+$/i.test(label)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: label })
      return { tz: label }
    } catch {
      return undefined
    }
  }
  const named = ZONE_NAMES.find(([words]) => words.test(label))
  return named ? { tz: named[1] } : undefined
}

/** How far ahead of UTC a zone's clock is at one instant. */
function zoneOffset(utcMs: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(utcMs)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - utcMs
}

/** The instant a wall clock reading in a zone stands for. */
function instantOf(y: number, mo: number, d: number, h: number, mi: number, zone: Zone) {
  if (!zone) return new Date(y, mo, d, h, mi).getTime()
  const wall = Date.UTC(y, mo, d, h, mi)
  if ('offsetMs' in zone) return wall - zone.offsetMs
  // Twice, because the first guess can land across a daylight saving change.
  return wall - zoneOffset(wall - zoneOffset(wall, zone.tz), zone.tz)
}

type Clock = { hour: number; minute: number; half?: 'a' | 'p' }

const clockOf = (m: RegExpMatchArray): Clock => ({
  hour: Number(m[1] ?? m[4]),
  minute: Number(m[2] ?? m[5] ?? 0),
  half: m[3]?.toLowerCase() as Clock['half'],
})
const hour24 = ({ hour, half }: Clock) => (half === 'p' ? (hour % 12) + 12 : half === 'a' ? hour % 12 : hour)
const minutesOf = (c: Clock) => hour24(c) * 60 + c.minute

/**
 * Google leaves the year out. The weekday settles it: "Tuesday, 10 November" is
 * the next 10 November that falls on a Tuesday, and when none is coming the
 * year stays as it is so the reader can be told the time has passed.
 */
function yearFor(mo: number, d: number, weekday: number, nowMs: number) {
  const year = new Date(nowMs).getUTCFullYear()
  for (const y of [year, year + 1]) {
    if (weekday >= 0 && new Date(Date.UTC(y, mo, d)).getUTCDay() !== weekday) continue
    if (Date.UTC(y, mo, d + 1) >= nowMs) return y
  }
  return year
}

type When = { year: number; month: number; day: number; start: Clock; durationMin: number | null; rest: string }

/** A line's date and times, or null when it has not got both. */
function readWhen(line: string, nowMs: number): When | null {
  const date = DATE.exec(line)
  if (!date) return null
  const after = line.slice(date.index + date[0].length)
  const clocks = [...after.matchAll(TIME)]
  if (clocks.length === 0) return null

  const start = clockOf(clocks[0])
  const end = clocks[1] ? clockOf(clocks[1]) : null
  const endDate = DATE.exec(after)
  // Google writes "4:00 – 5:00pm", the half only once.
  if (end?.half && !start.half) {
    start.half = end.half
    if (!endDate && minutesOf(start) > minutesOf(end)) start.half = end.half === 'a' ? 'p' : 'a'
  }
  if (hour24(start) > 23 || start.minute > 59) return null

  const month = MONTHS.indexOf((date[2] ?? date[3]).slice(0, 3).toLowerCase())
  const day = Number(date[1] ?? date[4])
  const weekday = WEEKDAYS.indexOf(/\b(sun|mon|tue|wed|thu|fri|sat)/i.exec(line.slice(0, date.index))?.[1].toLowerCase() ?? '')
  const year = date[5] ? Number(date[5]) : yearFor(month, day, weekday, nowMs)

  let durationMin: number | null = null
  if (end && hour24(end) <= 23 && end.minute <= 59) {
    const from = Date.UTC(year, month, day, hour24(start), start.minute)
    const to = Date.UTC(
      endDate?.[5] ? Number(endDate[5]) : year,
      endDate ? MONTHS.indexOf((endDate[2] ?? endDate[3]).slice(0, 3).toLowerCase()) : month,
      endDate ? Number(endDate[1] ?? endDate[4]) : day,
      hour24(end),
      end.minute,
    )
    let span = (to - from) / 60_000
    if (span <= 0) span += 24 * 60 // "11:00pm – 1:00am"
    // The range `meetings_duration` accepts.
    if (span >= 5 && span <= 480) durationMin = span
  }

  const last = clocks[Math.min(clocks.length, 2) - 1]
  const rest = after.slice((last.index ?? 0) + last[0].length).replace(/^[\s·,–—()-]+|[\s()]+$/g, '')
  return { year, month, day, start, durationMin, rest }
}

/** The line that says when: Zoom labels it, Google puts a dot in it. */
function findWhen(lines: string[], nowMs: number) {
  const ranks: ((line: string) => boolean)[] = [(l) => /^time\s*:/i.test(l), (l) => l.includes('·'), () => true]
  for (const fits of ranks) {
    for (let index = 0; index < lines.length; index++) {
      if (!fits(lines[index])) continue
      const when = readWhen(lines[index].replace(/^time\s*:/i, ''), nowMs)
      if (when) return { index, when }
    }
  }
  return null
}

/** The link people join by, never the Zoom chat link or a calendar page when a call link is there. */
function pickLink(text: string) {
  const links = (text.match(/https:\/\/[^\s<>"']+/gi) ?? [])
    .map((u) => u.replace(/[.,;:)\]]+$/, ''))
    .filter((u) => detectPlatform(u))
  return (
    links.find((u) => /^https:\/\/meet\.google\.com\//i.test(u)) ??
    links.find((u) => /zoom\.(us|com)\/(j|my|w|s)\//i.test(u)) ??
    links.find((u) => !/\/launch\/jc\//i.test(u)) ??
    null
  )
}

/** What a pasted invitation says, or null when it has no Meet or Zoom link in it. */
export function readInvitation(text: string, nowMs = Date.now()): MeetingInvite | null {
  const joinUrl = pickLink(text)
  const platform = joinUrl && detectPlatform(joinUrl)
  if (!joinUrl || !platform) return null

  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const found = findWhen(lines, nowMs)

  const topic = /^topic\s*:\s*(.+)$/im.exec(text)?.[1].trim()
  const above = found && found.index > 0 ? lines[found.index - 1] : ''
  const named = topic || (/^\(no title\)$/i.test(above) || above.includes('://') ? '' : above)

  const zoneLabel = /^time\s?zone\s*:\s*(.+)$/im.exec(text)?.[1].trim() ?? found?.when.rest ?? ''
  const zone = readZone(zoneLabel)

  let startsAt: string | null = null
  if (found) {
    const { year, month, day, start } = found.when
    startsAt = new Date(instantOf(year, month, day, hour24(start), start.minute, zone ?? null)).toISOString()
  }

  const meetingId = /^meeting id\s*:\s*(.+)$/im.exec(text)?.[1].trim()
  const passcode = /^(?:passcode|password)\s*:\s*(\S+)/im.exec(text)?.[1]

  return {
    platform,
    joinUrl,
    title: named ? named.slice(0, 120) : null,
    startsAt,
    durationMin: found?.when.durationMin ?? null,
    details: [meetingId && `Meeting ID: ${meetingId}`, passcode && `Passcode: ${passcode}`].filter(Boolean).join('\n'),
    unknownZone: zone === undefined ? zoneLabel : null,
  }
}

/** "Google Meet meeting", for an invitation that names nothing. */
export const untitledMeeting = (platform: MeetingPlatform) => `${PLATFORM_LABEL[platform]} meeting`

/** What the person still has to look at after a paste. Start now makes the time moot. */
export function inviteChecks(invite: MeetingInvite, startNow: boolean, nowMs = Date.now()) {
  const checks: string[] = []
  if (!startNow) {
    if (!invite.startsAt) checks.push('It gives no start time, so pick one.')
    // The same five minutes `create_meeting` allows.
    else if (new Date(invite.startsAt).getTime() < nowMs - 5 * 60_000) checks.push('Its start time has passed, so pick a new one.')
    if (invite.unknownZone) checks.push(`Collabify does not know the time zone "${invite.unknownZone}", so check the start time.`)
  }
  if (invite.durationMin == null) checks.push('It gives no length, so it is set to 1 hour.')
  return checks
}
