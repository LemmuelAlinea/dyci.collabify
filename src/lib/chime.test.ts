import { describe, expect, it } from 'vitest'
import { shouldChime } from './chime'

describe('shouldChime', () => {
  it('chimes when the unread count rises while the page is in view', () => {
    expect(shouldChime(2, 3, true)).toBe(true)
    expect(shouldChime(0, 4, true)).toBe(true)
  })
  it('stays quiet on the first count, which is the backlog', () => {
    expect(shouldChime(null, 7, true)).toBe(false)
  })
  it('stays quiet when nothing new arrived', () => {
    expect(shouldChime(3, 3, true)).toBe(false)
    expect(shouldChime(3, 1, true)).toBe(false)
  })
  it('stays quiet in the background, where device push sounds instead', () => {
    expect(shouldChime(2, 3, false)).toBe(false)
  })
})
