import { useRef, useState } from 'react'
import { endPull, mainSeq, pullFile, pushState, recordBase } from '../../lib/api/filePulls'
import { projectFileUrl, saveDraftFile, storagePathAt, uploadProjectFile } from '../../lib/api/general'
import { warmWordPdf } from '../../lib/api/wordPdf'
import { authErrorMessage } from '../../lib/authError'
import { KEEP, actionFor, buildTree, fileName, folderNameProblem, isOfficePath, isWordPath, joinPath, kindForPath, mergeStep, nodesAt, officeAppName, pathProblem, pathWithPickedExtension } from '../../lib/general/files'
import { OFFICE_WARNING, readAsText, xlsxToWorkbook } from '../../lib/general/office'
import { newVersionProblem, stalePushMessage, unknownCopyMessage } from '../../lib/general/newVersion'
import { openTabFor } from '../../lib/general/openTab'
import { pushVerdict } from '../../lib/general/pushCheck'
import type { PushVerdict } from '../../lib/general/pushCheck'
import { serializeWorkbook } from '../../lib/general/sheet'
import type { GeneralDraftFile, GeneralRepoSummary, GeneralTreeFile } from '../../lib/general/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { HeldPush } from './HeldPush'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

type Held = PushVerdict & { kind: 'held' }

/** What the dialog waits on before it saves anything. */
type Pending =
  | { step: 'confirm'; existing: string[] }
  | { step: 'held'; verdict: Held; path: string }
  | { step: 'unknown'; path: string }

type Step = 'choose' | 'folder' | 'file' | 'upload-folder'

const CHOICES: { step: Step; icon: IconName; title: string; body: string }[] = [
  { step: 'folder', icon: 'folder', title: 'New folder', body: 'Make an empty folder here and name it.' },
  { step: 'file', icon: 'file', title: 'Upload a file', body: 'Add one file from your computer.' },
  { step: 'upload-folder', icon: 'upload', title: 'Upload a folder', body: 'Add a whole folder from your computer.' },
]

const FILE_ACCEPT =
  '.docx,.doc,.odt,.rtf,.xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.markdown,.ts,.tsx,.js,.jsx,.json,.html,.css,.scss,.sql,.py,.java,.c,.cpp,.h,.cs,.php,.rb,.go,.rs,.sh,.yml,.yaml,.xml,.env,.toml,.ini,.kt,.swift,.dart,.vue,.mjs,.cjs,.less,.hpp,.cc,.hh,.kts,.lua,.r,.pl,.scala,.ps1,.bat,.graphql,.gql,.svelte,.log,.properties,.conf,.cfg,.gradle'

export function NewItemDialog({
  open,
  onClose,
  repo,
  tree,
  draftFiles,
  folder,
  names = () => 'Someone',
  onDone,
}: {
  open: boolean
  onClose: () => void
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  draftFiles: GeneralDraftFile[]
  folder: string
  names?: (id: string) => string
  onDone: (landAt: string) => Promise<void>
}) {
  const { show } = useToast()
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<File | null>(null)
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  // After Get theirs: the program to combine the two in.
  const [gotTheirs, setGotTheirs] = useState<'Word' | 'Excel' | null>(null)
  const [pickKey, setPickKey] = useState(0)
  // Held or unknown files the person chose to replace anyway, across the checks.
  const overrides = useRef(new Set<string>())

  const siblings = (
    nodesAt(buildTree([...tree, ...(draftFiles as unknown as GeneralTreeFile[])]), folder) ?? []
  ).map((n) => n.name)
  const where = folder || 'the top level'

  function close() {
    if (busy) return
    setStep('choose')
    setName('')
    setPicked(null)
    setFolderFiles([])
    setError(null)
    setPending(null)
    setBlocked(null)
    setGotTheirs(null)
    overrides.current = new Set()
    onClose()
  }

  /** A changed pick or name voids every answer given for the old one. */
  function pickChanged() {
    setPending(null)
    setBlocked(null)
    setGotTheirs(null)
    overrides.current = new Set()
  }

  /** `base`: for a Word or Excel file, the Main version it was made from, recorded right after the upload. */
  async function savePickedFile(file: File, target: string, base: number | undefined) {
    const k = kindForPath(target)
    let content = ''
    let storagePath: string | null = null
    if (k === 'sheet') content = serializeWorkbook(await xlsxToWorkbook(file))
    else if (k === 'text') content = await readAsText(file)
    else {
      storagePath = await uploadProjectFile(repo.project_id, file)
      if (base !== undefined) await recordBase(repo.id, target, storagePath, base)
      // The PDF preview starts now, so it is ready when someone opens the file.
      if (isWordPath(file.name)) warmWordPdf(storagePath)
    }
    await saveDraftFile({ repoId: repo.id, path: target, action: actionFor(target, tree), kind: k, content, storagePath })
  }

  function plan(): { targets: string[]; files: File[] } {
    if (step === 'file' && picked) {
      return { targets: [joinPath(folder, pathWithPickedExtension(name.trim() || picked.name, picked.name))], files: [picked] }
    }
    if (step === 'upload-folder') {
      return {
        targets: folderFiles.map((f) =>
          joinPath(folder, ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/')),
        ),
        files: folderFiles,
      }
    }
    return { targets: [], files: [] }
  }

  const inMain = (t: string) => tree.some((f) => f.path === t)
  const inDraft = (t: string) => draftFiles.some((f) => f.path === t)

  async function submit() {
    if (busy) return
    setPending(null)
    setBlocked(null)
    setGotTheirs(null)
    overrides.current = new Set()
    if (step === 'folder') {
      const problem = folderNameProblem(name, siblings)
      if (problem) return setError(problem)
      const landAt = joinPath(folder, name.trim())
      const bad = pathProblem(joinPath(landAt, KEEP))
      if (bad) return setError(bad)
      return save([joinPath(landAt, KEEP)], [], landAt, 'Folder added to your draft', new Set())
    }
    if (step === 'file' && !picked) return setError('Choose a file from your computer.')
    if (step === 'upload-folder' && folderFiles.length === 0) return setError('Choose a folder from your computer.')
    const { targets, files } = plan()
    const problem = targets.map(pathProblem).find(Boolean)
    if (problem) return setError(problem)
    const existing = targets.filter((t) => inMain(t) || inDraft(t))
    // Text and sheets are edited in the app, so an upload never replaces them.
    const edited = existing.find((t) => kindForPath(t) !== 'binary')
    if (edited) {
      return setError(
        inMain(edited)
          ? 'The project already has a file with that name here. Open it instead, or pick another name.'
          : 'Your draft already has a file with that name here. Open it instead, or pick another name.',
      )
    }
    for (let i = 0; i < targets.length; i += 1) {
      if (!existing.includes(targets[i])) continue
      const bad = newVersionProblem(targets[i], files[i])
      if (bad) return setError(bad)
    }
    setError(null)
    if (existing.length > 0) return setPending({ step: 'confirm', existing })
    return save(targets, files, folder, step === 'file' ? 'Added to your draft' : 'Folder added to your draft', new Set())
  }

  // Every Word or Excel file that replaces an existing name gets the open file's push check
  // first, and nothing is saved until all of them pass. Each such upload then
  // records the Main version it was made from: the live pull's, else Main's now.
  async function save(targets: string[], files: File[], landAt: string, done: string, overridden: Set<string>) {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const bases = new Map<string, number>()
      for (const t of targets) {
        if (!isOfficePath(t)) continue
        if (overridden.has(t) || !(inMain(t) || inDraft(t))) {
          bases.set(t, await mainSeq(repo.id, t))
          continue
        }
        const from = await pushState(repo.id, t)
        const verdict = pushVerdict(from, inMain(t))
        if (verdict.kind === 'held') {
          setPending({ step: 'held', verdict, path: t })
          setBusy(false)
          return
        }
        if (verdict.kind === 'unknown') {
          setPending({ step: 'unknown', path: t })
          setBusy(false)
          return
        }
        bases.set(t, from ? from.base_seq : await mainSeq(repo.id, t))
      }
      setPending(null)
      if (step === 'folder') {
        await saveDraftFile({ repoId: repo.id, path: targets[0], action: 'added', kind: 'text', content: '' })
      } else {
        for (let i = 0; i < files.length; i += 1) await savePickedFile(files[i], targets[i], bases.get(targets[i]))
      }
      // Saved past a hold: the stale pull has nothing left to hold.
      for (const t of overridden) if (targets.includes(t)) await endPull(repo.id, t).catch(() => {})
      show(done)
      setBusy(false)
      close()
      await onDone(landAt)
    } catch (err) {
      setError(stalePushMessage(err, null) ?? authErrorMessage(err, 'Could not add it to your draft. Try again in a moment.'))
      setBusy(false)
    }
  }

  function go(overrideNow?: string) {
    if (overrideNow) overrides.current.add(overrideNow)
    const { targets, files } = plan()
    return save(targets, files, folder, step === 'file' ? 'Added to your draft' : 'Folder added to your draft', overrides.current)
  }

  function getTheirs(path: string, verdict: Held) {
    setError(null)
    setBlocked(null)
    return openTabFor(async () => {
      await pullFile(repo.id, path, true)
      const storagePath = await storagePathAt(repo.id, path, verdict.mainSeq)
      if (!storagePath) throw new Error('That version has no file to download. Open the file again and retry.')
      return projectFileUrl(storagePath, fileName(path))
    })
      .then((link) => {
        // The pull moved the person's base to Main, so the picked copy must not be saved as is.
        setBlocked(link)
        setPending(null)
        setPicked(null)
        setFolderFiles([])
        setName('')
        setPickKey((k) => k + 1)
        setGotTheirs(officeAppName(path))
        overrides.current = new Set()
        if (!link) show(`Downloaded the newer version. ${mergeStep(path, true)}, then upload the result here.`)
      })
      .catch((err: unknown) => setError(authErrorMessage(err, 'Could not download it. Try again in a moment.')))
  }

  const office = picked && kindForPath(picked.name) === 'sheet'
  const word = picked && isOfficePath(picked.name)

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'choose' ? 'New' : CHOICES.find((c) => c.step === step)?.title ?? 'New'}
      description={`It goes into your draft, in ${where}.`}
      size="sm"
      focusField={step === 'folder'}
      footer={
        step === 'choose' ? undefined : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                // A confirm given on this step must not carry to the next one.
                pickChanged()
                setStep('choose')
                setError(null)
              }}
              disabled={busy}
            >
              Back
            </Button>
            <Button loading={busy} disabled={pending?.step === 'held'} onClick={() => void submit()}>
              {step === 'folder' ? 'Create folder' : 'Add to my draft'}
            </Button>
          </>
        )
      }
    >
      {step === 'choose' ? (
        <div className="grid gap-2">
          {CHOICES.map((c) => (
            <button
              key={c.step}
              type="button"
              onClick={() => setStep(c.step)}
              className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left hover:border-line-strong hover:bg-[var(--surface-sunken)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg surface-sunken text-ink">
                <Icon name={c.icon} size={17} />
              </span>
              <span>
                <span className="block text-[14px] font-medium text-ink">{c.title}</span>
                <span className="block text-[12px] text-muted">{c.body}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {gotTheirs && !pending && (
            <Alert tone="info">
              You have the newer version now. {gotTheirs === 'Excel' ? mergeStep('x.xlsx', true) : mergeStep('x.docx', true)}, then pick the combined copy here.
              {blocked && (
                <>
                  {' '}
                  <a href={blocked} target="_blank" rel="noopener" className="font-medium underline">
                    Download it again
                  </a>
                </>
              )}
            </Alert>
          )}
          {pending?.step === 'confirm' && (
            <div className="space-y-2 rounded-xl border border-warning-300 bg-warning-50 px-3.5 py-3 text-[13px] text-warning-800 dark:border-warning-400/40 dark:bg-warning-400/15 dark:text-warning-300">
              {step === 'file' && pending.existing.length === 1 ? (
                <p>
                  <span className="font-mono">{fileName(pending.existing[0])}</span> is already here. Upload it as a new version to
                  replace it in your draft, or rename it to keep both.
                </p>
              ) : (
                <p>
                  Upload {pending.existing.length} {pending.existing.length === 1 ? 'file' : 'files'} as new versions? They replace
                  the files already here with the same names, in your draft.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void go()}>
                  {step === 'file' && pending.existing.length === 1 ? 'Upload as a new version' : 'Upload'}
                </Button>
                {step === 'file' && pending.existing.length === 1 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setPending(null)}>
                    Rename
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {pending?.step === 'held' && (
            <HeldPush
              state={pending.verdict}
              path={pending.path}
              repoId={repo.id}
              names={names}
              blockedUrl={blocked}
              onGetTheirs={() => getTheirs(pending.path, pending.verdict)}
              onReplaceAnyway={() => {
                // Recorded as made from Main's newest version; the pull ends once it is saved.
                void go(pending.path)
              }}
            />
          )}
          {pending?.step === 'unknown' && (
            <div className="space-y-2 rounded-xl border border-warning-300 bg-warning-50 px-3.5 py-3 text-[13px] text-warning-800 dark:border-warning-400/40 dark:bg-warning-400/15 dark:text-warning-300">
              <p className="font-mono">{fileName(pending.path)}</p>
              <p>{unknownCopyMessage(tree.find((f) => f.path === pending.path)?.created_at ?? null)}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void go(pending.path)}>
                  Continue
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {step === 'folder' && (
            <Field label="Folder name">
              {(id) => <Input id={id} maxLength={120} placeholder="Chapter 1" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          {step === 'file' && (
            <>
              <Field label="File">
                {(id) => (
                  <input
                    id={id}
                    key={pickKey}
                    type="file"
                    accept={FILE_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      pickChanged()
                      setPicked(f)
                      if (f) setName(fileName(f.name))
                    }}
                    className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
                  />
                )}
              </Field>
              {picked && (
                <Field label="Save it as">
                  {(id) => (
                    <Input
                      id={id}
                      maxLength={200}
                      value={name}
                      onChange={(e) => {
                        pickChanged()
                        setName(e.target.value)
                      }}
                      className="!font-mono"
                    />
                  )}
                </Field>
              )}
              {office && <Alert tone="info">{OFFICE_WARNING}</Alert>}
              {word && (
                <Alert tone="info">
                  Kept exactly as uploaded. From {picked && officeAppName(picked.name) === 'Excel' ? 'Google Sheets' : 'Google Docs'}, download it as a Microsoft {picked && officeAppName(picked.name) === 'Excel' ? 'Excel (.xlsx)' : 'Word (.docx)'} file first.
                </Alert>
              )}
            </>
          )}
          {step === 'upload-folder' && (
            <>
              <Field label="Folder">
                {(id) => (
                  <input
                    id={id}
                    key={pickKey}
                    type="file"
                    multiple
                    {...{ webkitdirectory: '', directory: '' }}
                    onChange={(e) => {
                      pickChanged()
                      setFolderFiles([...(e.target.files ?? [])])
                    }}
                    className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
                  />
                )}
              </Field>
              {folderFiles.length > 0 && (
                <p className="text-[12px] text-muted">
                  {folderFiles.length} {folderFiles.length === 1 ? 'file' : 'files'} selected.
                </p>
              )}
            </>
          )}
        </form>
      )}
    </Modal>
  )
}
