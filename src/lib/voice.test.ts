import { describe, expect, it } from 'vitest'
import { clock } from './voice'

describe('clock', () => {
  it('reads a recording length as m:ss', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(5000)).toBe('0:05')
    expect(clock(84000)).toBe('1:24')
    expect(clock(300000)).toBe('5:00')
  })
})

describe('voice attachments', () => {
  it('names a recording for its length and reads it back', async () => {
    const { voiceFileName, voiceLength } = await import('./voice')
    expect(voiceFileName(84000, 'audio/webm;codecs=opus')).toBe('Voice message (1:24).webm')
    expect(voiceFileName(5000, 'audio/mp4')).toBe('Voice message (0:05).m4a')
    expect(voiceLength('Voice message (1:24).webm', 'audio/webm')).toBe('1:24')
    expect(voiceLength('Voice message (1:24).webm', 'application/pdf')).toBeNull()
    expect(voiceLength('song.mp3', 'audio/mpeg')).toBeNull()
  })
})
