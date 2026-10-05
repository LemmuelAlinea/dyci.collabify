import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import {
  commitFiles,
  discardDraftFile,
  projectFileUrl,
  saveDraftFile,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { summarizeFile, writeChangeMessage } from '../../lib/api/workAi'
import { extensionOf, fileName, isEditable, looksLikeMisreadOfficeFile } from '../../lib/general/files'
import { downloadBlob, htmlToDocx, workbookToXlsx } from '../../lib/general/office'
import { parseWorkbook, serializeWorkbook } from '../../lib/general/sheet'
import type { Workbook } from '../../lib/general/sheet'
import { FILE_KIND_LABEL } from '../../lib/general/types'
import type { FileAction, FileKind, GeneralRepoSummary } from '../../lib/general/types'
import { RichEditor } from './RichEditor'
import { SheetEditor } from './SheetEditor'
import { LazyPdfPreview as PdfPreview } from './LazyPdfPreview'
import type { GeneralProjectState } from './useGeneralProject'

// Monaco is several megabytes; it loads when somebody opens a code file.
const CodeEditor = lazy(() => import('./CodeEditor'))

export type OpenFile = {
  path: string
  kind: FileKind
  content: string
  storagePath: string | null
  /** What saving it would do to Main. */
  action: FileAction
  /** True when what is shown is the draft's copy rather than Main's. */
  fromDraft: boolean
  /** A teammate's shared copy, by who shared it: read-only, never saved from here. */
  sharedBy?: string
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
  const [full, setFull] = useState(false)
  // Whether the browser's own full screen is ours to leave again.
  const ownsScreen = useRef(false)

  // Esc, F11 or the browser's own control can leave full screen; follow it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && ownsScreen.current) {
        ownsScreen.current = false
        setFull(false)
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function leaveScreen() {
    if (ownsScreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    ownsScreen.current = false
  }

  function toggleFull() {
    if (full) {
      leaveScreen()
      setFull(false)
      return
    }
    setFull(true)
    // The whole page rather than the dialog, so menus, confirms and toasts —
    // which render at the end of <body> — still show. Where the browser has no
    // full screen for pages (iPhone), the dialog filling the window is it.
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => {
          ownsScreen.current = true
        })
        .catch(() => {})
    }
  }

  function close() {
    leaveScreen()
    setFull(false)
    onClose()
  }

  return (
    <Modal
      open={Boolean(file)}
      onClose={close}
      title={file ? fileName(file.path) : 'File'}
      description={file?.path}
      size={full ? 'full' : 'xl'}
      headerActions={
        file && (
          <button
            type="button"
            onClick={toggleFull}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            title={full ? 'Exit full screen' : 'Full screen'}
            aria-pressed={full}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-[background-color,color,scale] duration-(--dur-press) hover:bg-[var(--surface-sunken)] hover:text-ink active:scale-[0.97]"
          >
            <Icon name={full ? 'minimize' : 'maximize'} size={17} />
          </button>
        )
      }
    >
      {file && (
        <Body key={file.path + String(file.fromDraft) + (file.sharedBy ?? '')} file={file} repo={repo} state={state} full={full} onClose={close} onSaved={onSaved} />
      )}
    </Modal>
  )
}

function Body({
  file,
  repo,
  state,
  full,
  onClose,
  onSaved,
}: {
  file: OpenFile
  repo: GeneralRepoSummary
  state: GeneralProjectState
  full: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const readOnly = state.archived || file.sharedBy !== undefined
  const mayCommit = state.can('commit_main') && !readOnly
  const misreadOfficeFile = file.kind === 'text' && looksLikeMisreadOfficeFile(file.content)
  const frozen = readOnly || !isEditable(file.kind) || misreadOfficeFile
  const name = fileName(file.path)
  const isPdf = file.kind === 'binary' && extensionOf(file.path) === 'pdf'
  // Summaries read Main's version, so a shared copy or a draft has none.
  const summarizable = !file.fromDraft && file.sharedBy === undefined && (isEditable(file.kind) || isPdf) && Boolean(state.project)

  const [text, setText] = useState(file.kind === 'sheet' ? '' : file.content)
  const [book, setBook] = useState<Workbook>(() =>
    file.kind === 'sheet' ? parseWorkbook(file.content) : { sheets: [] },
  )
  const [message, setMessage] = useState('')
  const [writing, setWriting] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [points, setPoints] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What was last saved: the file as opened, until Ctrl+S saves it in place.
  const [baseline, setBaseline] = useState(file.content)
  const [inDraft, setInDraft] = useState(file.fromDraft)

  const current = file.kind === 'sheet' ? serializeWorkbook(book) : text
  const dirty = current !== baseline

  useEffect(() => {
    setError(null)
  }, [current])

  /** `stay` keeps the file open, the way Ctrl+S does in an editor. */
  async function save(toMain: boolean, stay = false) {
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
        if (stay) {
          setBaseline(current)
          setInDraft(true)
          await onSaved()
          return
        }
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
        {file.sharedBy !== undefined ? (
          <span className="rounded-md surface-sunken px-2 py-0.5">Shared by {file.sharedBy}</span>
        ) : inDraft ? (
          <span className="rounded-md bg-amber-400/25 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
            Your draft
          </span>
        ) : (
          <span className="rounded-md surface-sunken px-2 py-0.5">
            Main, commit {repo.commit_count}
          </span>
        )}
        {summarizable && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            loading={summarizing}
            onClick={async () => {
              if (!state.project) return
              setSummarizing(true)
              setError(null)
              try {
                const res = await summarizeFile(state.project.id, file.path)
                if (res.result !== 'ok') setError(res.message)
                else setPoints(res.points)
              } catch (err) {
                setError(authErrorMessage(err, 'Could not summarize it. Try again in a moment.'))
              } finally {
                setSummarizing(false)
              }
            }}
          >
            {!summarizing && <Icon name="spark" size={14} />}
            Summarize
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={summarizable ? '' : 'ml-auto'}
          onClick={() => void download()}
        >
          <Icon name="download" size={14} />
          Download
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {points && (
        <section className="rounded-xl border border-line surface-sunken px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="eyebrow">Key points · AI</p>
            <button
              type="button"
              onClick={() => setPoints(null)}
              aria-label="Hide the summary"
              className="-mt-1 -mr-1 grid h-6 w-6 place-items-center rounded-md text-faint hover:text-ink"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-ink">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">From the version in Main. Check the file before you rely on it.</p>
        </section>
      )}

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
        file.storagePath ? <PdfPreview storagePath={file.storagePath} label={name} fill={full} /> : null
      )}

      {!mayCommit && !readOnly && isEditable(file.kind) && (
        <Alert tone="info">
          Saving puts this in your draft. Nobody else sees it until you submit your draft for
          review.
        </Alert>
      )}

      {file.kind === 'rich' && (
        <RichEditor value={text} onChange={setText} readOnly={frozen} fill={full} />
      )}
      {file.kind === 'sheet' && (
        <SheetEditor workbook={book} onChange={setBook} readOnly={frozen} projectId={state.project?.id} fill={full} />
      )}
      {file.kind === 'text' && !misreadOfficeFile && (
        <Suspense
          fallback={
            <div className="flex h-[60vh] min-h-[22rem] items-center justify-center gap-2 rounded-xl border border-line surface-sunken text-[13px] text-muted">
              <Spinner size={14} />
              Opening the code editor…
            </div>
          }
        >
          <CodeEditor
            path={file.path}
            value={file.content}
            onChange={(next) => setText(next.slice(0, 400000))}
            onSave={() => {
              if (!frozen && current !== baseline) void save(false, true)
            }}
            readOnly={frozen}
            fill={full}
          />
        </Suspense>
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
          {mayCommit && (
            <Button
              variant="ghost"
              loading={writing}
              disabled={!dirty || !state.project}
              aria-label="Write the commit message for me"
              title="Write the commit message from what changed"
              onClick={async () => {
                if (!state.project) return
                setWriting(true)
                setError(null)
                try {
                  const res = await writeChangeMessage(state.project.id, {
                    files: [{ path: file.path, kind: file.kind, content: current }],
                  })
                  if (res.result !== 'ok') setError(res.message)
                  else setMessage(res.title)
                } catch (err) {
                  setError(authErrorMessage(err, 'Could not write it. Write it yourself, or try again.'))
                } finally {
                  setWriting(false)
                }
              }}
            >
              {!writing && <Icon name="spark" size={15} />}
              Write it
            </Button>
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
