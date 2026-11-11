/**
 * Page zoom from Settings → Appearance: the whole app drawn larger or smaller on
 * this device, for phones and tablets where pinching is clumsy.
 *
 * It is CSS `zoom` on `<html>`. Scaling the root font size would do nothing here:
 * the app sizes its text and spacing in px, not rem. The zoom is saved on the
 * device, not the account, because the size that suits a phone is not the size
 * that suits a desktop. `public/theme.js` applies it before the first paint and
 * repeats the range check below; keep the two in step.
 *
 * What `zoom` on the root changes, and how the app answers it:
 * - Viewport units grow with it, so `100dvh` would be taller than the screen.
 *   Sizes made from viewport units divide by `--zoom` (set beside the zoom).
 * - Chrome and Firefox report `getBoundingClientRect`, `innerWidth` and pointer
 *   positions in screen px, while a `top` or `left` written to a style is in
 *   page px and gets zoomed again. Code that places a layer from a measured box
 *   reads through `pageRect`, `pageViewport` and `toPage`, which turn screen px
 *   into page px. Safari has long reported boxes in page px already; `rectScale`
 *   measures which one this browser does rather than guessing.
 * - Media queries still see the real screen width, so a zoomed tablet keeps its
 *   desktop layout in less room. Measured on a 1030px screen, just past the
 *   desktop breakpoint, every main page holds at 130% and Settings and a project
 *   page start clipping at 140%. The range stops at 130% for that.
 */

export const ZOOM_MIN = 80
export const ZOOM_MAX = 130
export const ZOOM_STEP = 1
/** How long a change between two sizes glides, in ms. Reduced motion jumps. */
export const ZOOM_GLIDE_MS = 220
export const ZOOM_DEFAULT = 100
export const ZOOM_KEY = 'collabify.zoom'

/** Any number to a stop on the slider: rounded to the step, held to the range. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped))
}

/** A stored value back to a zoom. Missing or junk is 100%. */
export function parseZoom(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return ZOOM_DEFAULT
  return clampZoom(Number(raw))
}

/** One step out (-1) or in (+1), stopping at the ends. */
export function stepZoom(current: number, direction: -1 | 1): number {
  return clampZoom(clampZoom(current) + direction * ZOOM_STEP)
}

/** How far along the track a zoom sits, 0 to 100, for the filled part of the bar. */
export function zoomFill(value: number): number {
  return ((clampZoom(value) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100
}

/* ---------- the page ---------- */

const root = () => document.documentElement

export function zoomSupported(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('zoom', '2')
}

export function readStoredZoom(): number {
  try {
    return parseZoom(window.localStorage.getItem(ZOOM_KEY))
  } catch {
    return ZOOM_DEFAULT
  }
}

/** How far a glide has eased, for `t` from 0 to 1. Ease-out cubic: quick, then settling. */
export function easeZoom(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 3
}

/**
 * Draws the page at `percent`. Fractions are allowed, so a glide can pass through
 * the sizes between two stops. Nothing is saved.
 */
export function drawZoom(percent: number) {
  const value = Number.isFinite(percent) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, percent)) : ZOOM_DEFAULT
  const html = root()
  if (Math.abs(value - ZOOM_DEFAULT) < 0.01 || !zoomSupported()) {
    html.style.removeProperty('zoom')
    html.style.removeProperty('--zoom')
  } else {
    const factor = String(Math.round(value * 100) / 10000)
    html.style.setProperty('zoom', factor)
    html.style.setProperty('--zoom', factor)
  }
}

/** Tells layers that place themselves from the window's size to measure again. */
export function announceZoom() {
  window.dispatchEvent(new Event('resize'))
}

/** Keeps a zoom for this device, for the next visit's first paint. */
export function saveZoom(percent: number) {
  const value = clampZoom(percent)
  try {
    if (value === ZOOM_DEFAULT) window.localStorage.removeItem(ZOOM_KEY)
    else window.localStorage.setItem(ZOOM_KEY, String(value))
  } catch {
    // Private windows can refuse storage. The zoom still applies for this visit.
  }
}

/** The zoom the page is drawn at, as a factor: 1.2 for 120%. */
export function pageZoom(): number {
  if (typeof document === 'undefined') return 1
  const z = parseFloat(root().style.getPropertyValue('--zoom'))
  return Number.isFinite(z) && z > 0 ? z : 1
}

/** Screen px per page px in what this browser's `getBoundingClientRect` returns. */
export function rectScale(): number {
  if (pageZoom() === 1) return 1
  const html = root()
  const scale = html.getBoundingClientRect().width / (html.offsetWidth || 1)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** A pointer position or a measured length, from screen px to page px. */
export function toPage(screenPx: number): number {
  return screenPx / rectScale()
}

export type PageBox = { top: number; left: number; right: number; bottom: number; width: number; height: number }

/** An element's box in page px, ready to write into a fixed layer's style. */
export function pageRect(el: Element): PageBox {
  const r = el.getBoundingClientRect()
  const s = rectScale()
  return { top: r.top / s, left: r.left / s, right: r.right / s, bottom: r.bottom / s, width: r.width / s, height: r.height / s }
}

/** The window's size in page px. */
export function pageViewport(): { width: number; height: number } {
  const z = pageZoom()
  return { width: window.innerWidth / z, height: window.innerHeight / z }
}
