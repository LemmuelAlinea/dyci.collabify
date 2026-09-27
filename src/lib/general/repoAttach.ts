import { projectFileBlob } from '../api/general'
import { fileName } from './files'
import { parseWorkbook } from './sheet'
import type { GeneralTreeFile } from './types'

function replaceExtension(name: string, extension: string) {
  const i = name.lastIndexOf('.')
  return `${i <= 0 ? name : name.slice(0, i)}.${extension}`
}

/**
 * A file from the project's Files, as the file somebody would get by
 * downloading it: a document as .docx, a sheet as .xlsx, anything uploaded
 * as it was. Attaching it to a task keeps that copy, so the task shows what
 * the file said when it was attached even after Main moves on.
 */
export async function repoFileAsUpload(file: GeneralTreeFile, keepPath = false): Promise<File> {
  // Picked through a folder, a file keeps where it came from: docs/report.docx.
  const name = keepPath ? file.path : fileName(file.path)
  if (file.kind === 'binary') {
    if (!file.storage_path) throw new Error('That file has nothing stored behind it.')
    const blob = await projectFileBlob(file.storage_path)
    return new File([blob], name, { type: blob.type })
  }
  if (file.kind === 'rich' || file.kind === 'sheet') {
    // Loaded on demand: the Word and Excel writers are large.
    const office = await import('./office')
    if (file.kind === 'rich') {
      const blob = await office.htmlToDocx(file.content, name)
      return new File([blob], replaceExtension(name, 'docx'), { type: blob.type })
    }
    const blob = await office.workbookToXlsx(parseWorkbook(file.content))
    return new File([blob], replaceExtension(name, 'xlsx'), { type: blob.type })
  }
  return new File([file.content], name, { type: 'text/plain' })
}
