/** Boxes and placement for the walkthrough spotlight. Pure, so it tests without a DOM. */

export type Box = { top: number; left: number; width: number; height: number }
export type Viewport = { width: number; height: number }

const PAD = 6
const GUTTER = 16
const GAP = 12
const PHONE = 640

/** One box around every box, or null when there are none. */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  const top = Math.min(...boxes.map((b) => b.top))
  const left = Math.min(...boxes.map((b) => b.left))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  return { top, left, width: right - left, height: bottom - top }
}

/** The lit area: the target with a little air, kept inside the screen. */
export function holeFor(box: Box, vp: Viewport): Box {
  const top = Math.max(0, box.top - PAD)
  const left = Math.max(0, box.left - PAD)
  const bottom = Math.min(vp.height, box.top + box.height + PAD)
  const right = Math.min(vp.width, box.left + box.width + PAD)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** Four panels that cover the whole screen except the hole. */
export function scrimPanels(hole: Box, vp: Viewport): Box[] {
  const bottom = hole.top + hole.height
  const right = hole.left + hole.width
  return [
    { top: 0, left: 0, width: vp.width, height: hole.top },
    { top: bottom, left: 0, width: vp.width, height: Math.max(0, vp.height - bottom) },
    { top: hole.top, left: 0, width: hole.left, height: hole.height },
    { top: hole.top, left: right, width: Math.max(0, vp.width - right), height: hole.height },
  ]
}

export type Placement = { top: number; left: number; mode: 'anchored' | 'sheet' | 'center' }

/** Where the card goes: beside the lit target, as a bottom sheet on a phone, or centered with no target. */
export function placeCard(
  hole: Box | null,
  card: { width: number; height: number },
  vp: Viewport,
): Placement {
  const clampLeft = (left: number) => Math.max(GUTTER, Math.min(left, vp.width - GUTTER - card.width))
  const sheetTop = Math.max(GUTTER, vp.height - GUTTER - card.height)

  if (!hole) {
    return {
      top: Math.max(GUTTER, (vp.height - card.height) / 2),
      left: Math.max(GUTTER, (vp.width - card.width) / 2),
      mode: 'center',
    }
  }
  if (vp.width < PHONE) return { top: sheetTop, left: GUTTER, mode: 'sheet' }

  const left = clampLeft(hole.left)
  const below = hole.top + hole.height + GAP
  if (below + card.height <= vp.height - GUTTER) return { top: below, left, mode: 'anchored' }
  const above = hole.top - GAP - card.height
  if (above >= GUTTER) return { top: above, left, mode: 'anchored' }
  return { top: sheetTop, left, mode: 'sheet' }
}
