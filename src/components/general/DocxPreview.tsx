import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { projectFileBlob, projectFileUrl } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import './docxPreview.css'

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
const FILES = import.meta.glob(
  '/node_modules/@fontsource/{tinos,arimo,carlito,caladea}/files/*-latin{,-ext}-{400,700}-{normal,italic}.woff2',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

let fontsRegistered = false

/** Register the metric twins once; an installed Word font wins, the twin fills in. */
export function registerWordFonts() {
  if (fontsRegistered || typeof FontFace === 'undefined' || !document.fonts) return
  fontsRegistered = true
  for (const [path, url] of Object.entries(FILES)) {
    const m = /\/([a-z]+)-(latin(?:-ext)?)-(400|700)-(normal|italic)\.woff2$/.exec(path)
    if (!m) continue
    const [, name, subset, weight, style] = m
    const family = TWINS[name]
    const face = new FontFace(family, `local("${family}"), url("${url}") format("woff2")`, {
      weight,
      style,
      unicodeRange: RANGES[subset],
      display: 'swap',
    })
    document.fonts.add(face)
    void face.load().catch(() => {})
  }
}

/** Draw a .docx into `container` as pages; its styles go into `styleContainer`. */
export async function renderDocx(blob: Blob, container: HTMLElement, styleContainer: HTMLElement) {
  const { renderAsync } = await import('docx-preview')
  await renderAsync(blob, container, styleContainer, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    experimental: true,
    useBase64URL: true,
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
  const pages = useRef<HTMLDivElement>(null)
  const styles = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)

  useEffect(() => {
    let alive = true
    setReady(false)
    setFailed(false)
    registerWordFonts()
    void (async () => {
      try {
        const blob = await projectFileBlob(storagePath)
        if (!alive || !pages.current || !styles.current) return
        pages.current.replaceChildren()
        styles.current.replaceChildren()
        await renderDocx(blob, pages.current, styles.current)
        if (alive) setReady(true)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [storagePath])

  // Under 900 px a page is wider than the panel: shrink it to fit.
  const measure = useCallback(() => {
    const section = pages.current?.querySelector<HTMLElement>('section.docx')
    if (!section || !box.current) return
    const page = parseFloat(section.style.width) || section.offsetWidth
    const room = box.current.clientWidth - 24
    setFit(page > 0 && room > 0 ? Math.min(1, room / page) : 1)
  }, [])
  useLayoutEffect(() => {
    if (!ready) return
    measure()
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready, measure])

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

  if (failed) {
    return (
      <div className="space-y-2">
        <Alert tone="info">
          This kind of file is kept and versioned here but opened elsewhere. Download it, change it
          in the program that made it, and upload it again.
        </Alert>
        {downloadError && <Alert tone="error">{downloadError}</Alert>}
        {downloadButton}
      </div>
    )
  }

  const step = STEPS.indexOf(zoom)
  return (
    <div className="space-y-2">
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
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      <div
        ref={box}
        aria-label={label}
        className={`docx-preview relative min-h-[12rem] overflow-auto rounded-xl border border-line ${fill ? 'h-[calc((100dvh/var(--zoom,1))-13rem)]' : 'max-h-[calc(70vh/var(--zoom,1))]'}`}
      >
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted">
            <Spinner size={15} />
            Drawing the pages…
          </div>
        )}
        <div ref={styles} hidden />
        <div ref={pages} style={{ zoom: zoom * fit }} />
      </div>
    </div>
  )
}
