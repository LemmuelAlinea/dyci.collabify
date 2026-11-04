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
const CODE_EXTENSIONS = new Set(['html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'json', 'xml', 'yml', 'yaml', 'toml'])

function fileType(file: GeneralFile) {
  const extension = file.file_name.split('.').pop()?.toLowerCase() ?? ''
  const mime = file.mime_type ?? ''
  const label = extension.toUpperCase()
  if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return { label, color: '#3B82F6' }
  if (extension === 'pdf') return { label: 'PDF', color: '#EF4444' }
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(extension)) return { label, color: '#22C55E' }
  if (['ppt', 'pptx', 'odp'].includes(extension)) return { label, color: '#F97316' }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return { label, color: '#A855F7' }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi'].includes(extension)) return { label, color: '#F43F5E' }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(extension)) return { label, color: '#06B6D4' }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return { label, color: '#D97706' }
  if (CODE_EXTENSIONS.has(extension)) return { label: 'CODE', color: '#38BDF8' }
  if (['db', 'sqlite', 'sqlite3', 'mdb', 'accdb'].includes(extension)) return { label: 'DB', color: '#14B8A6' }
  if (['exe', 'msi', 'dll', 'apk'].includes(extension)) return { label: 'EXE', color: '#64748B' }
  return { label: 'FILE', color: '#6B7280' }
}

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
  const type = fileType(file)
  const solid = !preview || preview.kind === 'file' || preview.kind === 'audio'
  const glass = {
    background: `linear-gradient(150deg, ${type.color}66, rgba(13, 26, 54, 0.66) 75%)`,
    borderColor: `${type.color}88`,
    boxShadow: `0 10px 26px rgba(0, 0, 0, 0.18), 0 0 18px ${type.color}30, inset 0 1px rgba(255, 255, 255, 0.2)`,
  }
  const download = () => {
    void generalFileUrl(file.file_path, file.file_name)
      .then((downloadUrl) => {
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = file.file_name
        document.body.append(link)
        link.click()
        link.remove()
      })
      .catch((error) => onError(authErrorMessage(error, 'Could not download that file.')))
  }

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
    <div ref={card} className="relative w-52 shrink-0 overflow-hidden rounded-2xl border backdrop-blur-xl" style={glass}>
      <button
        type="button"
        aria-label={`Open ${file.file_name}`}
        onClick={() => {
          if (url) window.open(url, '_blank', 'noopener')
          else void generalFileUrl(file.file_path).then((signedUrl) => window.open(signedUrl, '_blank', 'noopener')).catch((error) => onError(authErrorMessage(error, 'Could not open that file.')))
        }}
        className="block w-full text-left"
      >
        <div className="relative h-32 overflow-hidden p-2" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${type.color} 64%, #0b1933), color-mix(in srgb, ${type.color} 38%, #0b1933) 65%, rgba(10, 21, 45, 0.56))` }}>
          <div className={`flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-white/35 shadow-[0_3px_12px_rgba(0,0,0,0.2)] ${solid ? 'text-white backdrop-blur-md' : 'bg-white text-slate-800'}`}>
            {preview?.kind === 'image' && <img src={preview.url} alt="" className="h-full w-full object-cover" />}
            {preview?.kind === 'video' && <video src={preview.url} muted preload="metadata" className="h-full w-full object-cover" />}
            {preview?.kind === 'audio' && <div className="flex flex-col items-center gap-1"><Icon name="mic" size={28} /><span className="text-[12px] font-semibold">{type.label}</span></div>}
            {preview?.kind === 'text' && <pre className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 pt-7 text-[8px] leading-3">{preview.text.slice(0, 900) || 'Empty file'}</pre>}
            {preview?.kind === 'file' && <div className="flex flex-col items-center gap-1"><Icon name="file" size={28} /><span className="text-[12px] font-semibold">{type.label}</span><span className="text-[9px]">Preview unavailable</span></div>}
            {!preview && <span className="text-[12px] font-semibold">{type.label}</span>}
          </div>
          {!solid && <span className="absolute inset-x-2 top-2 flex h-5 items-center justify-center rounded-t-lg border-b border-white/20 text-[10px] font-bold text-white backdrop-blur-sm" style={{ backgroundColor: `color-mix(in srgb, ${type.color} 62%, #0b1933)` }}>{type.label}</span>}
        </div>
        <div className="min-w-0 border-t border-white/15 bg-[rgba(10,21,45,0.68)] px-3 py-2 text-white backdrop-blur-md">
          <p className="truncate text-[12px]" title={file.file_name}>{file.file_name}</p>
          <p className="truncate text-[10px] text-white/65">{formatDue(file.created_at)}</p>
        </div>
      </button>
      <div className="absolute right-3 top-3 rounded-lg border border-white/30 bg-black/30 text-white backdrop-blur-md">
        <ActionMenu label={`Actions for ${file.file_name}`} items={[
          { label: 'Download', icon: 'download', onSelect: download },
          canTrash && { label: 'Move to trash', icon: 'trash', tone: 'danger', onSelect: onTrash },
        ]} />
      </div>
    </div>
  )
}
