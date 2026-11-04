import { useEffect, useRef, useState } from 'react'
import type { GeneralFile } from '../../lib/general/types'
import { generalFileUrl } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { ActionMenu } from '../ui/ActionMenu'
import { Icon } from '../ui/Icon'

type Preview =
  | { kind: 'image' | 'video' | 'audio'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'file'; text: string }

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'log', 'yml', 'yaml', 'ini', 'toml', 'svg'])

async function attachmentPreview(file: GeneralFile, url: string): Promise<Preview> {
  const extension = file.file_name.split('.').pop()?.toLowerCase() ?? ''
  const mime = file.mime_type ?? ''
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return { kind: 'image', url }
  if (mime.startsWith('video/')) return { kind: 'video', url }
  if (mime.startsWith('audio/')) return { kind: 'audio', url }
  const readable = ['pdf', 'docx', 'xlsx', 'zip', 'pptx'].includes(extension) || mime.startsWith('text/') || TEXT_EXTENSIONS.has(extension)
  if (!readable) return { kind: 'file', text: extension.toUpperCase() || 'FILE' }

  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load the attachment preview.')
  const blob = await response.blob()
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
    const document = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    try {
      const page = await document.getPage(1)
      const viewport = page.getViewport({ scale: 0.6 })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not draw the PDF preview.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      return { kind: 'image', url: canvas.toDataURL('image/png') }
    } finally {
      await document.destroy()
    }
  }
  if (extension === 'docx') {
    const { readDocxBytes } = await import('../../lib/general/docx/read')
    const html = readDocxBytes(new Uint8Array(await blob.arrayBuffer())).html
    return { kind: 'text', text: new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '' }
  }
  if (extension === 'xlsx') {
    const { xlsxToWorkbook } = await import('../../lib/general/office')
    const book = await xlsxToWorkbook(new File([blob], file.file_name, { type: mime }))
    return { kind: 'text', text: book.sheets.map((sheet) => `${sheet.name}\n${sheet.rows.slice(0, 12).map((row) => row.join('  |  ')).join('\n')}`).join('\n\n') }
  }
  if (extension === 'zip' || extension === 'pptx') {
    const { strFromU8, unzipSync } = await import('fflate')
    const names: string[] = []
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter: (entry) => {
        if (extension === 'zip') names.push(entry.name)
        return extension === 'pptx' && entry.name === 'ppt/slides/slide1.xml'
      },
    })
    if (extension === 'zip') return { kind: 'text', text: names.slice(0, 30).join('\n') || 'Empty archive' }
    const xml = entries['ppt/slides/slide1.xml']
    if (!xml) return { kind: 'file', text: 'PPTX' }
    const slide = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
    return { kind: 'text', text: [...slide.getElementsByTagNameNS('*', 't')].map((item) => item.textContent).join('\n') }
  }
  return { kind: 'text', text: await blob.slice(0, 12000).text() }
}

export function TaskAttachmentCard({ file, canTrash, onTrash, onError }: {
  file: GeneralFile
  canTrash: boolean
  onTrash: () => void
  onError: (message: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (visible || !card.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    })
    observer.observe(card.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let active = true
    void generalFileUrl(file.file_path)
      .then(async (signedUrl) => {
        const result = await attachmentPreview(file, signedUrl)
        if (active) { setUrl(signedUrl); setPreview(result) }
      })
      .catch(() => {
        if (active) setPreview({ kind: 'file', text: file.file_name.split('.').pop()?.toUpperCase() || 'FILE' })
      })
    return () => { active = false }
  }, [file, visible])

  return (
    <div ref={card} className="relative w-44 shrink-0 overflow-hidden rounded-xl border border-line bg-[var(--surface-sunken)]">
      <button
        type="button"
        aria-label={`Open ${file.file_name}`}
        onClick={() => {
          if (url) window.open(url, '_blank', 'noopener')
          else void generalFileUrl(file.file_path).then((signedUrl) => window.open(signedUrl, '_blank', 'noopener')).catch((error) => onError(authErrorMessage(error, 'Could not open that file.')))
        }}
        className="block w-full text-left"
      >
        <div className="flex h-28 items-center justify-center overflow-hidden bg-white text-slate-800">
          {preview?.kind === 'image' && <img src={preview.url} alt="" className="h-full w-full object-cover" />}
          {preview?.kind === 'video' && <video src={preview.url} muted preload="metadata" className="h-full w-full object-cover" />}
          {preview?.kind === 'audio' && <Icon name="mic" size={34} className="text-slate-500" />}
          {preview?.kind === 'text' && <pre className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 text-[8px] leading-3">{preview.text.slice(0, 900) || 'Empty file'}</pre>}
          {preview?.kind === 'file' && <div className="flex flex-col items-center gap-1 text-slate-500"><Icon name="file" size={32} /><span className="text-[11px] font-semibold">{preview.text}</span><span className="text-[9px]">Preview unavailable</span></div>}
          {!preview && <Icon name="file" size={28} className="text-slate-300" />}
        </div>
        <div className="min-w-0 bg-[#242529] px-2.5 py-1.5 text-white">
          <p className="truncate text-[12px]" title={file.file_name}>{file.file_name}</p>
          <p className="truncate text-[10px] text-white/65">{formatDue(file.created_at)}</p>
        </div>
      </button>
      {canTrash && <div className="absolute right-1 top-1 rounded-md bg-black/60 text-white">
        <ActionMenu label={`Actions for ${file.file_name}`} items={[{ label: 'Move to trash', icon: 'trash', tone: 'danger', onSelect: onTrash }]} />
      </div>}
    </div>
  )
}
