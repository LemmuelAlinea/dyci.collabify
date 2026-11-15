import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { projectFileSize } from '../../lib/api/general'
import { fileName, isKeep } from '../../lib/general/files'
import { formatBytes } from '../../lib/formatBytes'
import type { FileKind } from '../../lib/general/types'

export type PropertyFile = {
  path: string
  kind: FileKind
  content: string
  storage_path: string | null
  created_at?: string
  updated_at?: string
}

export type PropertyTarget = { path: string; files: PropertyFile[] }

export function PropertiesDialog({ target, onClose }: { target: PropertyTarget | null; onClose: () => void }) {
  const [size, setSize] = useState<string>('Calculating…')

  useEffect(() => {
    if (!target) return
    let current = true
    setSize('Calculating…')
    Promise.all(target.files.filter((file) => !isKeep(file.path)).map(async (file) => {
      if (file.kind !== 'binary') return new TextEncoder().encode(file.content).length
      return file.storage_path ? projectFileSize(file.storage_path) : null
    })).then((sizes) => {
      if (current) setSize(sizes.some((value) => value === null) ? 'Unavailable' : formatBytes(sizes.reduce<number>((sum, value) => sum + (value ?? 0), 0)))
    }).catch(() => { if (current) setSize('Unavailable') })
    return () => { current = false }
  }, [target])

  const updated = target?.files.map((file) => file.updated_at ?? file.created_at).filter((date): date is string => Boolean(date)).sort().at(-1)

  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Properties" size="sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-[13px]">
        <dt className="text-muted">Name</dt><dd className="min-w-0 break-words text-ink">{target ? fileName(target.path) : ''}</dd>
        <dt className="text-muted">Updated</dt><dd className="text-ink">{updated ? new Date(updated).toLocaleString() : 'Unavailable'}</dd>
        <dt className="text-muted">Size</dt><dd className="text-ink">{size}</dd>
      </dl>
    </Modal>
  )
}
