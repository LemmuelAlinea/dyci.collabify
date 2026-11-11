import { describe, expect, it } from 'vitest'
import { rgbToHex } from './systemBars'

describe('rgbToHex', () => {
  it('writes two digits per channel', () => {
    expect(rgbToHex(8, 11, 33)).toBe('#080b21')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
  })
  it('rounds and holds each channel to 0–255', () => {
    expect(rgbToHex(9.6, -4, 300)).toBe('#0a00ff')
  })
})
