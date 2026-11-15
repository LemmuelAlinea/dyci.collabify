import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { baseOf, endPull, listPulls, mainSeq, pullFile, pushState, recordBase } from '../../lib/api/filePulls'
import {
  commitFiles,
  discardDraftFile,
  projectFileUrl,
  saveDraftFile,
  storagePathAt,
  uploadProjectFile,
} from '../../lib/api/general'
import { writeChangeMessage } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { extensionOf, fileName, isOfficePath, mergeStep, officeAppName } from '../../lib/general/files'
import { newVersionProblem, pulledAgo, stalePushMessage, unknownCopyMessage } from '../../lib/general/newVersion'
import { openTabFor } from '../../lib/general/openTab'
import { pushVerdict } from '../../lib/general/pushCheck'
import type { PushVerdict } from '../../lib/general/pushCheck'
import type { FileAction, FilePull, GeneralRepoSummary } from '../../lib/general/types'
import type { OpenFile } from './FileEditor'
import { HeldPush } from './HeldPush'
import type { GeneralProjectState } from './useGeneralProject'

type Held = PushVerdict & { kind: 'held' }

type Stage =
  | { step: 'idle' }
  | { step: 'working'; what: string }
  | { step: 'held'; picked: File; verdict: Held }
  | { step: 'unknown'; picked: File }
  /** `endPull`: the upload replaced a newer Main knowingly, so the pull ends once it is saved. */
  | { step: 'ready'; picked: File; storagePath: string; action: FileAction; endPull: boolean }

/**
 * An uploaded file's way to change: download it, change it in the program that
 * made it, and upload it again as a new version of the same path. For Word
 * and Excel files the download is a pull (Edit in Word or Excel), and every upload records the
 * Main version it was made from, so a push made from a copy Main has moved
 * past is held instead of quietly replacing someone's work.
 */
export function WordVersionPanel({
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
  const word = isOfficePath(file.path)
  const app = officeAppName(file.path)
  const name = fileName(file.path)
  const canEdit =
    !state.readOnly && file.sharedBy === undefined && state.myRole !== 'stakeholder' && !state.classTeacher
  const mayCommit = canEdit && state.can('commit_main')
  const existsInMain = file.mainAt !== undefined ? file.mainAt !== null : !(file.fromDraft && file.action === 'added')
  const baseAction: FileAction = existsInMain ? 'changed' : 'added'

  const [pulls, setPulls] = useState<FilePull[]>([])
  const [stage, setStage] = useState<Stage>({ step: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState(false)
  // A download link, when the browser blocked the tab it was opening in.
  const [blocked, setBlocked] = useState<string | null>(null)
  // The draft copy downloaded with Edit in Word or Excel: its recorded base carries to the next upload.
  const [draftCopy, setDraftCopy] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const refreshPulls = useCallback(async () => {
    if (!word) return
    try {
      const all = await listPulls(repo.id)
      setPulls(all.filter((p) => p.path === file.path))
    } catch {
      // A heads-up only; the file works without it.
    }
  }, [word, repo.id, file.path])

  useEffect(() => {
    void refreshPulls()
  }, [refreshPulls])

  // Both downloads open their tab inside the click (openTabFor), before any await.
  function editInOffice() {
    const storagePath = file.storagePath
    if (!storagePath || busy) return
    setError(null)
    setBlocked(null)
    setBusy(true)
    void openTabFor(async () => {
      // A file Main has never had has nothing to fall behind: it only downloads.
      if (existsInMain) await pullFile(repo.id, file.path, !file.fromDraft)
      return projectFileUrl(storagePath, name)
    })
      .then(async (link) => {
        setBlocked(link)
        setDraftCopy(file.fromDraft ? storagePath : null)
        if (!link) show(`Downloaded. Edit it in ${app}, then upload it here as a new version.`)
        await refreshPulls()
      })
      .catch((err: unknown) => setError(authErrorMessage(err, 'Could not download it. Try again in a moment.')))
      .finally(() => setBusy(false))
  }

  async function doneEditing() {
    setError(null)
    try {
      await endPull(repo.id, file.path)
      await refreshPulls()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not end your pull. Try again in a moment.'))
    }
  }

  function getTheirs(verdict: Held) {
    setError(null)
    setBlocked(null)
    return openTabFor(async () => {
      await pullFile(repo.id, file.path, true)
      const storagePath = await storagePathAt(repo.id, file.path, verdict.mainSeq)
      if (!storagePath) throw new Error('That version has no file to download. Open the file again and retry.')
      return projectFileUrl(storagePath, name)
    })
      .then(async (link) => {
        setBlocked(link)
        // They now hold Main's version, so the pull's fresh base is the one to carry.
        setDraftCopy(null)
        setStage({ step: 'idle' })
        if (!link) show(`Downloaded the newer version. ${mergeStep(file.path, true)}, then upload the result here.`)
        await refreshPulls()
      })
      .catch((err: unknown) => setError(authErrorMessage(err, 'Could not download it. Try again in a moment.')))
  }

  /** Uploads the copy and, for a Word or Excel file, records the Main version it was made from. */
  async function upload(picked: File, action: FileAction, base: number | null, endAfter = false) {
    if (!state.project) return setStage({ step: 'idle' })
    setStage({ step: 'working', what: `Uploading ${picked.name}…` })
    try {
      const storagePath = await uploadProjectFile(state.project.id, picked)
      if (base !== null) await recordBase(repo.id, file.path, storagePath, base)
      setStage({ step: 'ready', picked, storagePath, action, endPull: endAfter })
    } catch (err) {
      setStage({ step: 'idle' })
      setError(authErrorMessage(err, 'Could not upload it. Try again in a moment.'))
    }
  }

  async function onPick(picked: File) {
    setError(null)
    const problem = newVersionProblem(file.path, picked)
    if (problem) return setError(problem)
    if (!word) return upload(picked, baseAction, null)
    setStage({ step: 'working', what: 'Checking Main…' })
    try {
      // A draft copy downloaded here keeps its own base; otherwise the live pull's.
      const carried = draftCopy ? await baseOf(draftCopy) : null
      const from = carried ?? (await pushState(repo.id, file.path))
      const verdict = pushVerdict(from, existsInMain)
      if (verdict.kind === 'held') return setStage({ step: 'held', picked, verdict })
      if (verdict.kind === 'unknown') return setStage({ step: 'unknown', picked })
      await upload(picked, baseAction, from ? from.base_seq : await mainSeq(repo.id, file.path))
    } catch (err) {
      setStage({ step: 'idle' })
      setError(authErrorMessage(err, 'Could not check Main. Try again in a moment.'))
    }
  }

  /** Continue past the unknown warning: the copy counts as made from Main's version now. */
  async function continueUnknown(picked: File) {
    setError(null)
    setStage({ step: 'working', what: 'Checking Main…' })
    try {
      await upload(picked, baseAction, await mainSeq(repo.id, file.path))
    } catch (err) {
      setStage({ step: 'idle' })
      setError(authErrorMessage(err, 'Could not check Main. Try again in a moment.'))
    }
  }

  async function save(ready: Extract<Stage, { step: 'ready' }>, toMain: boolean) {
    if (busy) return
    setError(null)
    if (toMain && !message.trim()) return setError('Say what you changed. A history without messages is a list of dates.')
    setBusy(true)
    try {
      if (toMain) {
        await commitFiles({
          repoId: repo.id,
          message,
          baseSeq: repo.commit_count,
          files: [{ path: file.path, action: ready.action, kind: 'binary', content: '', storage_path: ready.storagePath }],
        })
        // Main now says what the draft said for this path.
        await discardDraftFile(repo.id, file.path)
        show(`Committed as ${repo.commit_count + 1}`)
      } else {
        await saveDraftFile({
          repoId: repo.id,
          path: file.path,
          action: ready.action,
          kind: 'binary',
          storagePath: ready.storagePath,
        })
        show('Saved to your draft')
      }
      // A knowing replacement is saved, so the stale pull has nothing left to hold.
      if (ready.endPull) await endPull(repo.id, file.path).catch(() => {})
      onClose()
      await onSaved()
    } catch (err) {
      setError(stalePushMessage(err, null) ?? authErrorMessage(err, 'Could not save that.'))
    } finally {
      setBusy(false)
    }
  }

  const others = pulls.filter((p) => p.user_id !== state.viewerId)
  const mine = pulls.find((p) => p.user_id === state.viewerId)

  if (!canEdit && others.length === 0) return null

  return (
    <section aria-label="New versions" className="space-y-3 rounded-xl border border-line surface-sunken px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[12rem] flex-1 space-y-0.5 text-[12px] text-muted">
          {others.map((p) => (
            <p key={p.user_id}>
              {state.nameOf(p.user_id)} pulled this {pulledAgo(p.pulled_at)}
            </p>
          ))}
          {canEdit && mine && (
            <p className="flex flex-wrap items-center gap-x-2">
              You pulled this {pulledAgo(mine.pulled_at)}
              <button
                type="button"
                onClick={() => void doneEditing()}
                className="font-medium text-navy-600 underline-offset-2 hover:underline dark:text-navy-200"
              >
                I'm done editing
              </button>
            </p>
          )}
          {canEdit && others.length === 0 && !mine && (
            <p>
              {word
                ? `Edit it in ${app}, then upload it here as a new version.`
                : 'Change it in the program that made it, then upload it here as a new version.'}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {word && file.storagePath && (
              <Button size="sm" variant="outline" disabled={busy} onClick={editInOffice}>
                <Icon name="edit" size={14} />
                Edit in {app}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || stage.step === 'working'}
              onClick={() => picker.current?.click()}
            >
              <Icon name="upload" size={14} />
              Upload a new version
            </Button>
            <input
              ref={picker}
              type="file"
              hidden
              accept={extensionOf(file.path) ? `.${extensionOf(file.path)}` : undefined}
              onChange={(e) => {
                const picked = e.target.files?.[0]
                e.target.value = ''
                if (picked) void onPick(picked)
              }}
            />
          </div>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {blocked && (
        <p className="text-[13px] text-ink">
          Your browser blocked the download.{' '}
          <a href={blocked} target="_blank" rel="noopener" className="font-medium text-navy-600 underline dark:text-navy-200">
            Download {name}
          </a>
        </p>
      )}

      {stage.step === 'working' && (
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <Spinner size={14} />
          {stage.what}
        </p>
      )}

      {stage.step === 'held' && (
        <HeldPush
          state={stage.verdict}
          path={file.path}
          repoId={repo.id}
          names={state.nameOf}
          onGetTheirs={() => getTheirs(stage.verdict)}
          onReplaceAnyway={() => {
            // The copy is recorded as made from Main's newest version; the pull ends once it is saved.
            void upload(stage.picked, stage.verdict.removed ? 'added' : baseAction, stage.verdict.mainSeq, true)
          }}
        />
      )}

      {stage.step === 'unknown' && (
        <div className="space-y-2 rounded-xl border border-warning-300 bg-warning-50 px-3.5 py-3 text-[13px] text-warning-800 dark:border-warning-400/40 dark:bg-warning-400/15 dark:text-warning-300">
          <p>{unknownCopyMessage(file.mainAt ?? null)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void continueUnknown(stage.picked)}>
              Continue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage({ step: 'idle' })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {stage.step === 'ready' && (
        <div className="space-y-3 rounded-lg border border-line surface px-3 py-3">
          <p className="text-[13px] text-ink">
            <span className="font-mono">{stage.picked.name}</span> is uploaded. Save it to your draft
            {mayCommit ? ' or commit it to Main' : ''}; until then nothing changes.
          </p>
          {!mayCommit && (
            <p className="text-[12px] text-muted">
              Saving puts this in your draft. Nobody else sees it until you submit your draft for review.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {mayCommit && (
              <div className="min-w-[14rem] flex-1">
                <Field label="Commit message">
                  {(id) => (
                    <Input
                      id={id}
                      maxLength={200}
                      placeholder="Combined the adviser's notes into chapter 2"
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
                disabled={!state.project}
                aria-label="Write the commit message for me"
                title="Write the commit message from what changed"
                onClick={async () => {
                  if (!state.project) return
                  setWriting(true)
                  setError(null)
                  try {
                    const res = await writeChangeMessage(state.project.id, {
                      files: [{ path: file.path, kind: 'binary', storage_path: stage.storagePath }],
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
            <Button variant="ghost" disabled={busy} onClick={() => setStage({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" loading={busy} onClick={() => void save(stage, false)}>
              Save to my draft
            </Button>
            {mayCommit && (
              <Button loading={busy} onClick={() => void save(stage, true)}>
                Commit to Main
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
