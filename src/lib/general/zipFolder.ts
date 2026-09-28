import { filesUnder } from './files'
import { repoFileAsUpload } from './repoAttach'
import type { GeneralTreeFile } from './types'

/**
 * A folder of Main as one .zip, each file as somebody would download it on its
 * own: documents as .docx, sheets as .xlsx, uploads as they were. Built in the
 * browser, one file at a time, so a large folder reports progress rather than
 * appearing to hang.
 */
export async function zipFolder(
  files: GeneralTreeFile[],
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { zipSync } = await import('fflate')
  const inside = filesUnder(files, folder)
  const prefix = folder ? `${folder}/` : ''
  const entries: Record<string, Uint8Array> = {}
  for (let i = 0; i < inside.length; i++) {
    const file = await repoFileAsUpload(inside[i], true)
    const name = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name
    entries[name] = new Uint8Array(await file.arrayBuffer())
    onProgress?.(i + 1, inside.length)
  }
  // Already-compressed formats (docx, xlsx, images, PDFs) gain nothing from a
  // second pass, so a light level keeps it quick.
  const zipped = zipSync(entries, { level: 1 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
