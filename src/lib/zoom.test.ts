import { describe, expect, it } from 'vitest'
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, clampZoom, parseZoom, stepZoom, zoomFill } from './zoom'

describe('clampZoom', () => {
  it('keeps a stop on the slider', () => {
    expect(clampZoom(120)).toBe(120)
  })
  it('rounds to the nearest step', () => {
    expect(clampZoom(112)).toBe(110)
    expect(clampZoom(113)).toBe(115)
  })
  it('holds the ends', () => {
    expect(clampZoom(10)).toBe(ZOOM_MIN)
    expect(clampZoom(400)).toBe(ZOOM_MAX)
  })
  it('turns junk into 100%', () => {
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_DEFAULT)
  })
})

describe('parseZoom', () => {
  it('reads a stored value', () => {
    expect(parseZoom('120')).toBe(120)
  })
  it('treats nothing or junk as 100%', () => {
    expect(parseZoom(null)).toBe(100)
    expect(parseZoom(undefined)).toBe(100)
    expect(parseZoom('')).toBe(100)
    expect(parseZoom('big')).toBe(100)
  })
  it('clamps a value from an older or edited store', () => {
    expect(parseZoom('300')).toBe(ZOOM_MAX)
    expect(parseZoom('0')).toBe(ZOOM_MIN)
  })
})

describe('stepZoom', () => {
  it('moves one step each way', () => {
    expect(stepZoom(100, 1)).toBe(105)
    expect(stepZoom(100, -1)).toBe(95)
  })
  it('stops at the ends', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})

describe('zoomFill', () => {
  it('runs from empty to full across the range', () => {
    expect(zoomFill(ZOOM_MIN)).toBe(0)
    expect(zoomFill(ZOOM_MAX)).toBe(100)
    expect(zoomFill(100)).toBe(40)
  })
})
