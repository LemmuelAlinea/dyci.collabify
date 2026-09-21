import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  commitFiles,
  discardDraftFile,
  projectFileUrl,
  saveDraftFile,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { extensionOf, fileName, isEditable, looksLikeMisreadOfficeFile } from '../../lib/general/files'
import { downloadBlob, htmlToDocx, workbookToXlsx } from '../../lib/general/office'
import { parseWorkbook, serializeWorkbook } from '../../lib/general/sheet'
import type { Workbook } from '../../lib/general/sheet'
import { FILE_KIND_LABEL } from '../../lib/general/types'
import type { FileAction, FileKind, GeneralRepoSummary } from '../../lib/general/types'
import { RichEditor } from './RichEditor'
import { SheetEditor } from './SheetEditor'
import { PdfPreview } from './PdfPreview'
import type { GeneralProjectState } from './useGeneralProject'

export type OpenFile = {
  path: string
  kind: FileKind
  content: string
  storagePath: string | null
  /** What saving it would do to Main. */
  action: FileAction
  /** True when what is shown is the draft's copy rather than Main's. */
  fromDraft: boolean
}

/**
 * One file, open.
 *
 * Two ways out of here, and which one somebody gets is the whole permission
 * model: **Save to my draft** for everybody, and **Commit to Main** as well for
 * whoever holds `edit_files`. A draft save never touches Main, so a person can
 * leave a chapter half-written for a week without anybody seeing it.
 */
export function FileEditor({
  file,
  repo,
  state,
  onClose,
  onSaved,
}: {
  file: OpenFile | null
  repo: GeneralRepoSummary
  state: GeneralProjectState
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  return (
    <Modal
      open={Boolean(file)}
      onClose={onClose}
      title={file ? fileName(file.path) : 'File'}
      description={file?.path}
      size="xl"
    >
      {file && (
        <Body key={file.path + String(file.fromDraft)} file={file} repo={repo} state={state} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  )
}

function Body({
  file,
  repo,
  state,
  onClose,
  onSaved,
}: {
  file: OpenFile
  repo: GeneralRepoSummary
  state: GeneralProjectState
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const mayCommit = state.can('edit_files') && !state.archived
  const misreadOfficeFile = file.kind === 'text' && looksLikeMisreadOfficeFile(file.content)
  const frozen = state.archived || !isEditable(file.kind) || misreadOfficeFile
  const name = fileName(file.path)
  const isPdf = file.kind === 'binary' && extensionOf(file.path) === 'pdf'

  const [text, setText] = useState(file.kind === 'sheet' ? '' : file.content)
  const [book, setBook] = useState<Workbook>(() =>
    file.kind === 'sheet' ? parseWorkbook(file.content) : { sheets: [] },
  )
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = file.kind === 'sheet' ? serializeWorkbook(book) : text
  const dirty = current !== file.content

  useEffect(() => {
    setError(null)
  }, [current])

  async function save(toMain: boolean) {
    if (busy) return
    setError(null)
    if (toMain && !message.trim()) {
      return setError('Say what you changed. A history without messages is a list of dates.')
    }
    setBusy(true)
    try {
      if (toMain) {
        await commitFiles({
          repoId: repo.id,
          message,
          baseSeq: repo.commit_count,
          files: [
            {
              path: file.path,
              action: file.action,
              kind: file.kind,
              content: current,
              storage_path: file.storagePath,
            },
          ],
        })
        // What was in the draft for this path is now what Main says, and a
        // draft row claiming to add a file that exists can never be submitted.
        await discardDraftFile(repo.id, file.path)
        show(`Committed as ${repo.commit_count + 1}`)
      } else {
        await saveDraftFile({
          repoId: repo.id,
          path: file.path,
          action: file.action,
          kind: file.kind,
          content: current,
          storagePath: file.storagePath,
        })
        show('Saved to your draft')
      }
      onClose()
      await onSaved()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that.'))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    try {
      if (file.kind === 'binary' && file.storagePath) {
        window.open(await projectFileUrl(file.storagePath, name), '_blank', 'noopener')
        return
      }
      if (file.kind === 'rich') {
        downloadBlob(await htmlToDocx(current, name), replaceExtension(name, 'docx'))
      } else if (file.kind === 'sheet') {
        downloadBlob(await workbookToXlsx(book), replaceExtension(name, 'xlsx'))
      } else {
        downloadBlob(new Blob([current], { type: 'text/plain;charset=utf-8' }), name)
      }
    } catch (err) {
      show(authErrorMessage(err, 'Could not prepare that download.'), 'error')
    }
  }

  async function dropMisreadDraft() {
    if (busy || !file.fromDraft) return
    setBusy(true)
    try {
      await discardDraftFile(repo.id, file.path)
      show('Dropped from your draft')
      onClose()
      await onSaved()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not drop that draft file.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="rounded-md surface-sunken px-2 py-0.5">{FILE_KIND_LABEL[file.kind]}</span>
        {file.fromDraft ? (
          <span className="rounded-md bg-amber-400/25 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
            Your draft
          </span>
        ) : (
          <span className="rounded-md surface-sunken px-2 py-0.5">
            Main, commit {repo.commit_count}
          </span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void download()}>
          <Icon name="download" size={14} />
          Download
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {misreadOfficeFile && (
        <Alert tone="error">
          This Word or Excel file was uploaded as text, so the original document contents are not
          recoverable from this draft. Drop it, then upload the file again; the new upload will be
          saved as an editable document.
        </Alert>
      )}

      {file.kind === 'binary' && !isPdf && (
        <Alert tone="info">
          This kind of file is kept and versioned here but opened elsewhere. Download it, change it
          in the program that made it, and upload it again.
        </Alert>
      )}

      {isPdf && (
        file.storagePath ? <PdfPreview storagePath={file.storagePath} label={name} /> : null
      )}

      {!mayCommit && !state.archived && isEditable(file.kind) && (
        <Alert tone="info">
          Saving puts this in your draft. Nobody else sees it until you submit your draft for
          review.
        </Alert>
      )}

      {file.kind === 'rich' && (
        <RichEditor value={text} onChange={setText} readOnly={frozen} />
      )}
      {file.kind === 'sheet' && <SheetEditor workbook={book} onChange={setBook} readOnly={frozen} />}
      {file.kind === 'text' && !misreadOfficeFile && (
        <Field label="Contents">
          {(id) => (
            <Textarea
              id={id}
              rows={18}
              maxLength={400000}
              readOnly={frozen}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="!font-mono !text-[12px] !leading-relaxed"
            />
          )}
        </Field>
      )}

      {misreadOfficeFile && file.fromDraft && (
        <Button variant="outline" onClick={() => void dropMisreadDraft()} loading={busy}>
          Drop this bad draft file
        </Button>
      )}

      {!frozen && (
        <div className="flex flex-wrap items-end gap-2">
          {mayCommit && (
            <div className="min-w-[14rem] flex-1">
              <Field label="Commit message">
                {(id) => (
                  <Input
                    id={id}
                    maxLength={200}
                    placeholder="Reworded the sampling paragraph"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}
          <Button variant="outline" onClick={() => void save(false)} loading={busy} disabled={!dirty}>
            Save to my draft
          </Button>
          {mayCommit && (
            <Button onClick={() => void save(true)} loading={busy} disabled={!dirty}>
              Commit to Main
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function replaceExtension(name: string, extension: string) {
  const i = name.lastIndexOf('.')
  return `${i <= 0 ? name : name.slice(0, i)}.${extension}`
}
