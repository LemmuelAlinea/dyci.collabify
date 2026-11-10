import { expect, it } from 'vitest'
import { holeFor, placeCard, scrimPanels, unionBox } from './geometry'

const vp = { width: 1280, height: 800 }

it('joins two rows into one box', () =>
  expect(unionBox([{ top: 10, left: 0, width: 100, height: 20 }, { top: 90, left: 0, width: 120, height: 20 }]))
    .toEqual({ top: 10, left: 0, width: 120, height: 100 }))
it('has no box for no rows', () => expect(unionBox([])).toBeNull())
it('pads the hole by 6 and clamps it to the viewport', () => {
  expect(holeFor({ top: 100, left: 100, width: 50, height: 40 }, vp)).toEqual({ top: 94, left: 94, width: 62, height: 52 })
  expect(holeFor({ top: -50, left: 0, width: 2000, height: 100 }, vp)).toEqual({ top: 0, left: 0, width: 1280, height: 56 })
})
it('leaves the hole uncovered', () => {
  const hole = { top: 100, left: 200, width: 50, height: 40 }
  const area = scrimPanels(hole, vp).reduce((sum, b) => sum + b.width * b.height, 0)
  expect(area).toBe(vp.width * vp.height - hole.width * hole.height)
})
it('centers with no hole', () => expect(placeCard(null, { width: 340, height: 200 }, vp).mode).toBe('center'))
it('is a sheet on a phone', () =>
  expect(placeCard({ top: 100, left: 20, width: 80, height: 40 }, { width: 340, height: 200 }, { width: 375, height: 812 }).mode).toBe('sheet'))
it('sits under a target with room', () => {
  const placed = placeCard({ top: 100, left: 900, width: 100, height: 40 }, { width: 340, height: 200 }, vp)
  expect(placed.mode).toBe('anchored'); expect(placed.top).toBeGreaterThan(140)
})
it('sits above a target near the bottom', () => {
  const placed = placeCard({ top: 700, left: 300, width: 100, height: 40 }, { width: 340, height: 200 }, vp)
  expect(placed.mode).toBe('anchored'); expect(placed.top + 200).toBeLessThanOrEqual(700)
})
it('stays on screen beside the right edge', () => {
  const placed = placeCard({ top: 100, left: 1200, width: 70, height: 40 }, { width: 340, height: 200 }, vp)
  expect(placed.left + 340).toBeLessThanOrEqual(vp.width - 16)
})
it('keeps the card on screen for a target taller than the screen', () => {
  const placed = placeCard({ top: -50, left: 300, width: 600, height: 1400 }, { width: 340, height: 200 }, vp)
  expect(placed.top).toBeGreaterThanOrEqual(16); expect(placed.top + 200).toBeLessThanOrEqual(vp.height - 16)
})
