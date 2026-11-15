import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { projectFileBlob, projectFileUrl } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import './docxPreview.css'

/*
 * A Word file is someone else's input, and docx-preview copies its style
 * names, values and shape CSS into the output without escaping them. So the
 * drawn pages never touch the app's document: they go into a sandboxed frame
 * (no scripts, no top navigation) whose own Content-Security-Policy lets
 * nothing load but the file's own data: pictures and fonts and the app's
 * same-origin font files. The browser is the boundary; the element sanitizer
 * below only keeps the frame's DOM tidy.
 */

/** The frame may read nothing but itself; links open in a new tab outside it. */
export const FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox'

/** docx-preview writes pictures, bullets and embedded fonts as data: urls (useBase64URL), so no blob: is needed. */
export const FRAME_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'"

// Metric twins: Tinos, Arimo, Carlito and Caladea take the same space as Word's
// Times New Roman, Arial, Calibri and Cambria, so lines break where Word's do.
const TWINS: Record<string, string> = {
  tinos: 'Times New Roman',
  arimo: 'Arial',
  carlito: 'Calibri',
  caladea: 'Cambria',
}
const RANGES: Record<string, string> = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
}
// Word's own face names per weight and style, so a twin fills in only when that exact face is missing.
// Each family lists regular, bold, italic, bold italic as [full name, PostScript name].
const LOCAL: Record<string, string[][]> = {
  'Times New Roman': [
    ['Times New Roman', 'TimesNewRomanPSMT'],
    ['Times New Roman Bold', 'TimesNewRomanPS-BoldMT'],
    ['Times New Roman Italic', 'TimesNewRomanPS-ItalicMT'],
    ['Times New Roman Bold Italic', 'TimesNewRomanPS-BoldItalicMT'],
  ],
  Arial: [
    ['Arial', 'ArialMT'],
    ['Arial Bold', 'Arial-BoldMT'],
    ['Arial Italic', 'Arial-ItalicMT'],
    ['Arial Bold Italic', 'Arial-BoldItalicMT'],
  ],
  Calibri: [
    ['Calibri', 'Calibri-Regular'],
    ['Calibri Bold', 'Calibri-Bold'],
    ['Calibri Italic', 'Calibri-Italic'],
    ['Calibri Bold Italic', 'Calibri-BoldItalic'],
  ],
  Cambria: [
    ['Cambria', 'Cambria-Regular'],
    ['Cambria Bold', 'Cambria-Bold'],
    ['Cambria Italic', 'Cambria-Italic'],
    ['Cambria Bold Italic', 'Cambria-BoldItalic'],
  ],
}

/** The installed-face names for one weight and style. */
export function localFaces(family: string, weight: string, style: string) {
  return LOCAL[family][(weight === '700' ? 1 : 0) + (style === 'italic' ? 2 : 0)]
}

const FILES = import.meta.glob(
  '/node_modules/@fontsource/{tinos,arimo,carlito,caladea}/files/*-latin{,-ext}-{400,700}-{normal,italic}.woff2',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

/** @font-face rules for the twins under Word's names: an installed Word face wins, the twin fills in. */
export function wordFontCss() {
  const rules: string[] = []
  for (const [path, url] of Object.entries(FILES)) {
    const m = /\/([a-z]+)-(latin(?:-ext)?)-(400|700)-(normal|italic)\.woff2$/.exec(path)
    if (!m) continue
    const [, name, subset, weight, style] = m
    const family = TWINS[name]
    const src = [...localFaces(family, weight, style).map((n) => `local("${n}")`), `url("${url}") format("woff2")`].join(', ')
    rules.push(
      `@font-face { font-family: "${family}"; src: ${src}; font-weight: ${weight}; font-style: ${style}; unicode-range: ${RANGES[subset]}; font-display: swap; }`,
    )
  }
  return rules.join('\n')
}

/**
 * docx-preview's options. Embedded HTML (altChunk) is off: the library would
 * draw it as an iframe of its own.
 */
export const DOCX_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderAltChunks: false,
  // Word comments stay out of the preview (their popovers are not tidied for it).
  renderComments: false,
  experimental: true,
  useBase64URL: true,
} as const

// Nothing that runs, loads, navigates or keeps raw text through serialization.
const ACTIVE =
  'iframe, frame, frameset, script, object, embed, form, base, meta, link, noscript, template, style, xmp, noembed, noframes, plaintext, textarea'
const SAFE_LINK = /^(https?:|mailto:|#)/i
const SAFE_IMAGE = /^data:image\//i

/**
 * Tidies the drawn pages before they go into the frame: no active elements,
 * no event handlers, links only to the web, mail or within the file (web
 * links open in a new tab), and pictures only from the file itself.
 */
export function sanitizePreview(root: HTMLElement) {
  for (const el of [...root.querySelectorAll(ACTIVE)]) el.remove()
  // Comment nodes carry nothing a reader needs.
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const c of comments) c.parentNode?.removeChild(c)
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const name of el.getAttributeNames()) {
      const lower = name.toLowerCase()
      if (lower.startsWith('on') || lower === 'srcdoc' || lower === 'formaction') el.removeAttribute(name)
    }
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') {
      const href = (el.getAttribute('href') ?? '').trim()
      if (!href || !SAFE_LINK.test(href)) {
        el.removeAttribute('href')
        el.removeAttribute('target')
      } else if (!href.startsWith('#')) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
    } else if (tag === 'img') {
      const src = (el.getAttribute('src') ?? '').trim()
      if (!SAFE_IMAGE.test(src)) el.removeAttribute('src')
      el.removeAttribute('srcset')
    } else {
      // SVG links and pictures (an <a> or <image> inside drawn shapes) take the same rules.
      for (const name of ['href', 'xlink:href']) {
        const value = el.getAttribute(name)
        if (value === null) continue
        const ok = tag === 'image' ? SAFE_IMAGE.test(value.trim()) : value.trim().startsWith('#')
        if (!ok) el.removeAttribute(name)
      }
    }
  }
}

/** The style container takes only <style> elements. */
export function sanitizeStyles(box: HTMLElement) {
  for (const node of [...box.childNodes]) {
    if (node.nodeName !== 'STYLE') node.remove()
  }
}

/** Draw a .docx into `container` as pages; its styles go into `styleContainer`. Both come out tidied. */
export async function renderDocx(blob: Blob, container: HTMLElement, styleContainer: HTMLElement) {
  const { renderAsync } = await import('docx-preview')
  await renderAsync(blob, container, styleContainer, { ...DOCX_OPTIONS })
  sanitizePreview(container)
  sanitizeStyles(styleContainer)
}

// A `<` in style text becomes the CSS escape for it, so no `</style>` can end the element early.
const styleText = (css: string) => css.replace(/</g, '\\3c ')

// The ground around the pages comes from the app's theme as a resolved colour; anything else falls back.
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\)|transparent)$/i

/** The paper and the ground around it: white pages in both themes, as Word's are. */
function frameCss(ground: string) {
  const bg = COLOUR.test(ground.trim()) ? ground.trim() : '#eef0f4'
  return [
    `html, body { margin: 0; padding: 0; background: ${bg}; overflow: hidden; }`,
    // As wide as its widest page, so a zoomed page widens the frame instead of spilling off its left edge.
    '.docx-wrapper { background: transparent; padding: 12px; padding-bottom: 0; align-items: center; width: max-content; min-width: 100%; box-sizing: border-box; }',
    '.docx-wrapper > section.docx { background: #ffffff; color: #000000; box-shadow: 0 1px 2px rgb(13 19 48 / 0.1), 0 2px 6px rgb(13 19 48 / 0.07); margin-bottom: 12px; flex-shrink: 0; }',
  ].join('\n')
}

/**
 * The frame's whole document: the Content-Security-Policy first in the head,
 * then docx-preview's styles, the font twins, the paper, then the pages.
 */
export function frameDocument(styles: HTMLElement, pages: HTMLElement, ground: string) {
  const sheets = [...styles.querySelectorAll('style')].map((s) => `<style>${styleText(s.textContent ?? '')}</style>`)
  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    ...sheets,
    `<style>${styleText(wordFontCss())}</style>`,
    `<style>${styleText(frameCss(ground))}</style>`,
    '</head><body>',
    pages.innerHTML,
    '</body></html>',
  ].join('')
}

/**
 * In-file links (a table of contents, a bookmark) resolve against the app's
 * address from inside the frame, so following one would load the app into the
 * frame. Instead the click is kept and `scrollTo` brings the target into view.
 * Web and mail links are left alone.
 */
export function keepAnchorsInside(doc: Document, scrollTo: (target: Element) => void) {
  doc.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.('a')
    const href = link?.getAttribute('href') ?? ''
    if (!href.startsWith('#')) return
    e.preventDefault()
    let name = href.slice(1)
    try {
      name = decodeURIComponent(name)
    } catch {
      // A malformed escape is looked up as written.
    }
    const target = (name && (doc.getElementById(name) ?? doc.getElementsByName(name)[0])) || null
    if (target) scrollTo(target)
  })
}

const STEPS = [0.5, 0.75, 1, 1.25, 1.5]

export function DocxPreview({
  storagePath,
  label,
  fill = false,
}: {
  storagePath: string
  label: string
  /** Full screen: take the window's height instead of stopping at 70%. */
  fill?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  // The frame's document and a fresh key per render, so a stale frame is never reused.
  const [doc, setDoc] = useState<{ html: string; key: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let alive = true
    setReady(false)
    setFailed(false)
    setDoc(null)
    setSize(null)
    void (async () => {
      try {
        const blob = await projectFileBlob(storagePath)
        // Draw into fresh detached nodes; only the run still current builds the frame.
        const pages = document.createElement('div')
        const styles = document.createElement('div')
        await renderDocx(blob, pages, styles)
        if (!alive) return
        const ground = box.current ? getComputedStyle(box.current).backgroundColor : ''
        setDoc((old) => ({ html: frameDocument(styles, pages, ground), key: (old?.key ?? 0) + 1 }))
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [storagePath])

  // Fit the page to the panel (under 900 px a page is wider), apply the zoom
  // inside the frame, then size the frame to what it holds.
  const layout = useCallback(() => {
    const d = frame.current?.contentDocument
    const room = (box.current?.clientWidth ?? 0) - 24
    if (!d?.body || !d.documentElement) return
    d.body.style.zoom = '1'
    const section = d.querySelector<HTMLElement>('section.docx')
    const page = section ? section.offsetWidth + 24 : 0
    const nextFit = page > 0 && room > 0 ? Math.min(1, room / page) : 1
    setFit((f) => (Math.abs(f - nextFit) < 0.001 ? f : nextFit))
    const scale = zoom * nextFit
    d.body.style.zoom = String(scale)
    // The wrapper's box is in zoomed pixels; the last page's bottom margin sits below it.
    // The width comes from the page, never from the frame itself, so the frame can shrink again.
    const rect = d.querySelector('.docx-wrapper')?.getBoundingClientRect()
    if (rect) setSize({ width: Math.ceil(page * scale), height: Math.ceil(rect.height + 12 * scale) })
  }, [zoom])

  useLayoutEffect(() => {
    if (!ready) return
    layout()
    const d = frame.current?.contentDocument
    let alive = true
    // Fonts change line breaks, so measure again once they are in.
    void d?.fonts?.ready.then(() => alive && layout())
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return () => void (alive = false)
    const ro = new ResizeObserver(() => layout())
    ro.observe(el)
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [ready, layout])

  // The frame is as tall as its pages, so the box around it is what scrolls.
  const scrollToTarget = useCallback((target: Element) => {
    const el = box.current
    const f = frame.current
    if (el && f && el.scrollHeight > el.clientHeight) {
      // The target's box inside the frame is already in zoomed pixels.
      el.scrollTo({ top: f.offsetTop + target.getBoundingClientRect().top - 8, behavior: 'smooth' })
    } else {
      target.scrollIntoView({ block: 'start' })
    }
  }, [])

  async function download() {
    setDownloadError(null)
    try {
      window.open(await projectFileUrl(storagePath, label), '_blank', 'noopener')
    } catch (err) {
      setDownloadError(authErrorMessage(err, 'Could not prepare that download.'))
    }
  }

  const downloadButton = (
    <Button size="sm" variant="outline" onClick={() => void download()}>
      <Icon name="download" size={14} />
      Download
    </Button>
  )

  const step = STEPS.indexOf(zoom)
  return (
    <div className="space-y-2">
      {failed && (
        <div className="space-y-2">
          <Alert tone="info">
            This kind of file is kept and versioned here but opened elsewhere. Download it, change it
            in the program that made it, and upload it again.
          </Alert>
          {downloadError && <Alert tone="error">{downloadError}</Alert>}
          {downloadButton}
        </div>
      )}
      <div hidden={failed} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-muted">
          A preview. Download to see it exactly as Word shows it.
        </p>
        {downloadButton}
        <div className="ml-auto flex items-center gap-1 text-[12px] text-muted">
          <Button
            size="sm"
            variant="outline"
            aria-label="Zoom out"
            disabled={step <= 0}
            onClick={() => setZoom(STEPS[step - 1])}
          >
            -
          </Button>
          <span className="w-10 text-center font-mono">{Math.round(zoom * fit * 100)}%</span>
          <Button
            size="sm"
            variant="outline"
            aria-label="Zoom in"
            disabled={step >= STEPS.length - 1}
            onClick={() => setZoom(STEPS[step + 1])}
          >
            +
          </Button>
        </div>
      </div>
      <p className="text-[12px] text-muted">
        From Google Docs, download it as Microsoft Word (.docx) before uploading. Converting it to a
        Google Doc and back can change the formatting.
      </p>
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      <div
        ref={box}
        className={`docx-preview relative min-h-[12rem] overflow-auto rounded-xl border border-line ${fill ? 'h-[calc((100dvh/var(--zoom,1))-13rem)]' : 'max-h-[calc(70vh/var(--zoom,1))]'}`}
      >
        {!ready && !failed && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted">
            <Spinner size={15} />
            Drawing the pages…
          </div>
        )}
        {doc && !failed && (
          <iframe
            key={doc.key}
            ref={frame}
            title={label}
            sandbox={FRAME_SANDBOX}
            srcDoc={doc.html}
            onLoad={(e) => {
              const d = e.currentTarget.contentDocument
              if (d) keepAnchorsInside(d, scrollToTarget)
              setReady(true)
            }}
            className="block border-0"
            style={{
              width: size ? `max(100%, ${size.width}px)` : '100%',
              height: size ? `${size.height}px` : '12rem',
              visibility: ready ? 'visible' : 'hidden',
            }}
          />
        )}
      </div>
      </div>
    </div>
  )
}
