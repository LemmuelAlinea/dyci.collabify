/**
 * The phone's status bar, over the top of the page. Android paints it from
 * `<meta name="theme-color">`, so it is set to the colour actually on screen at
 * the top: the top bar's ground, which follows light or dark, the person's
 * background depth and their own colours. A fixed value left a band of the wrong
 * navy above a page the person had taken to black.
 *
 * The bottom bar (Android's navigation bar) in the installed app is painted from
 * the manifest's single `theme_color`, which cannot follow a person; it is the
 * default dark page, `#080b21`, in public/manifest.webmanifest.
 */

/** Two hex digits per channel, alpha dropped. */
export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

let canvas: CanvasRenderingContext2D | null | undefined

/**
 * Any CSS colour the browser computed (rgb, oklab, color-mix results) as hex and
 * an opacity, by painting one pixel. Null when it cannot be read.
 */
export function readColor(css: string): { hex: string; alpha: number } | null {
  if (canvas === undefined) {
    canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  }
  if (!canvas) return null
  canvas.clearRect(0, 0, 1, 1)
  canvas.fillStyle = '#000'
  canvas.fillStyle = css
  canvas.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data
  return { hex: rgbToHex(r, g, b), alpha: a / 255 }
}

/** The first solid background from `el` up, as hex. */
function solidGround(el: Element | null): string | null {
  for (let n = el; n; n = n.parentElement) {
    const read = readColor(getComputedStyle(n).backgroundColor)
    if (read && read.alpha > 0.98) return read.hex
  }
  return null
}

/** Sets the status bar to whatever is painted along the top of the screen. */
export function syncStatusBar() {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const top = document.elementFromPoint(window.innerWidth / 2, 1)
  const hex = solidGround(top) ?? solidGround(document.body)
  if (hex && meta.getAttribute('content') !== hex) meta.setAttribute('content', hex)
}
