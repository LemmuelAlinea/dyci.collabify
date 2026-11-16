import { excelSourceAt, storagePathAt } from '../../lib/api/general'
import { fileText, isComparableExcel, isPreviewableWord } from '../../lib/general/files'
import type { GeneralBlob } from '../../lib/general/types'
import { DiffView } from './DiffView'
import { ExcelDiff } from './ExcelDiff'
import { WordDiff } from './WordDiff'

/**
 * What one commit did to one file: a Word file by its words, an Excel file by its
 * cells, any other upload as a note, and text line by line. History's commits and
 * a file's own history both show it.
 */
export function VersionDiff({
  file,
  commitSeq,
  before,
}: {
  file: Pick<GeneralBlob, 'repo_id' | 'path' | 'seq' | 'action' | 'kind' | 'content' | 'storage_path'>
  commitSeq: number
  /** The text the path held before this commit; '' when it had none. */
  before: string
}) {
  const f = file
  if (f.kind === 'binary' && isPreviewableWord(f.path)) {
    return (
      <WordDiff
        key={`${f.path}:${f.storage_path}`}
        before={f.seq > 1 ? () => storagePathAt(f.repo_id, f.path, f.seq - 1) : null}
        after={f.action === 'removed' ? null : f.storage_path}
        caption={`What commit ${commitSeq} did to ${f.path}, by its words`}
      />
    )
  }
  if (f.kind === 'binary' && isComparableExcel(f.path)) {
    return (
      <ExcelDiff
        key={`${f.path}:${f.storage_path}`}
        before={f.seq > 1 ? () => excelSourceAt(f.repo_id, f.path, f.seq - 1) : null}
        after={f.action === 'removed' ? null : f.storage_path}
        caption={`What commit ${commitSeq} did to ${f.path}, by its cells`}
      />
    )
  }
  if (f.kind === 'binary') {
    return <p className="text-[12px] text-muted">An uploaded file. Its contents are not compared here.</p>
  }
  return (
    <DiffView
      before={fileText(f.kind, before)}
      after={f.action === 'removed' ? '' : fileText(f.kind, f.content)}
      caption={`What commit ${commitSeq} did to ${f.path}, line by line`}
    />
  )
}
