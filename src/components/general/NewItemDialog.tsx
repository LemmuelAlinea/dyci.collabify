import { useState } from 'react'
import { saveDraftFile, uploadProjectFile } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { KEEP, actionFor, buildTree, fileName, folderNameProblem, joinPath, kindForPath, nodesAt, pathProblem, pathWithPickedExtension } from '../../lib/general/files'
import { docxToHtml, OFFICE_WARNING, readAsText, xlsxToWorkbook } from '../../lib/general/office'
import { serializeWorkbook } from '../../lib/general/sheet'
import type { GeneralDraftFile, GeneralRepoSummary, GeneralTreeFile } from '../../lib/general/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

type Step = 'choose' | 'folder' | 'file' | 'upload-folder'

const CHOICES: { step: Step; icon: IconName; title: string; body: string }[] = [
  { step: 'folder', icon: 'folder', title: 'New folder', body: 'Make an empty folder here and name it.' },
  { step: 'file', icon: 'file', title: 'Upload a file', body: 'Add one file from your computer.' },
  { step: 'upload-folder', icon: 'upload', title: 'Upload a folder', body: 'Add a whole folder from your computer.' },
]

const FILE_ACCEPT =
  '.docx,.doc,.odt,.rtf,.xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.markdown,.ts,.tsx,.js,.jsx,.json,.html,.css,.scss,.sql,.py,.java,.c,.cpp,.h,.cs,.php,.rb,.go,.rs,.sh,.yml,.yaml,.xml,.env,.toml,.ini,.kt,.swift,.dart,.vue'

export function NewItemDialog({
  open,
  onClose,
  repo,
  tree,
  draftFiles,
  folder,
  onDone,
}: {
  open: boolean
  onClose: () => void
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  draftFiles: GeneralDraftFile[]
  folder: string
  onDone: (landAt: string) => Promise<void>
}) {
  const { show } = useToast()
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<File | null>(null)
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    onClose()
  }

  async function savePickedFile(file: File, target: string) {
    const k = kindForPath(target)
    let content = ''
    let storagePath: string | null = null
    if (k === 'rich') content = (await docxToHtml(file)).html
    else if (k === 'sheet') content = serializeWorkbook(await xlsxToWorkbook(file))
    else if (k === 'text') content = await readAsText(file)
    else storagePath = await uploadProjectFile(repo.project_id, file)
    await saveDraftFile({ repoId: repo.id, path: target, action: actionFor(target, tree), kind: k, content, storagePath })
  }

  async function submit() {
    if (busy) return
    let targets: string[] = []
    let files: File[] = []
    let landAt = folder
    let done = ''

    if (step === 'folder') {
      const problem = folderNameProblem(name, siblings)
      if (problem) return setError(problem)
      landAt = joinPath(folder, name.trim())
      targets = [joinPath(landAt, KEEP)]
      done = 'Folder added to your draft'
    } else if (step === 'file') {
      if (!picked) return setError('Choose a file from your computer.')
      const target = joinPath(folder, pathWithPickedExtension(name.trim() || picked.name, picked.name))
      targets = [target]
      files = [picked]
      done = 'Added to your draft'
    } else if (step === 'upload-folder') {
      if (folderFiles.length === 0) return setError('Choose a folder from your computer.')
      files = folderFiles
      targets = folderFiles.map((f) =>
        joinPath(folder, ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/')),
      )
      done = 'Folder added to your draft'
    }

    const problem = targets.map(pathProblem).find(Boolean)
    if (problem) return setError(problem)
    if (targets.some((t) => tree.some((f) => f.path === t))) {
      return setError('The project already has a file with that name here. Open it instead, or pick another name.')
    }
    if (targets.some((t) => draftFiles.some((f) => f.path === t))) {
      return setError('Your draft already has a file with that name here. Open it instead, or pick another name.')
    }

    setError(null)
    setBusy(true)
    try {
      if (step === 'folder') {
        await saveDraftFile({ repoId: repo.id, path: targets[0], action: 'added', kind: 'text', content: '' })
      } else {
        for (let i = 0; i < files.length; i += 1) await savePickedFile(files[i], targets[i])
      }
      show(done)
      setBusy(false)
      close()
      await onDone(landAt)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add it to your draft. Try again in a moment.'))
      setBusy(false)
    }
  }

  const office = picked && ['rich', 'sheet'].includes(kindForPath(picked.name))

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
            <Button variant="ghost" onClick={() => { setStep('choose'); setError(null) }} disabled={busy}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
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
                    type="file"
                    accept={FILE_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setPicked(f)
                      if (f) setName(fileName(f.name))
                    }}
                    className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
                  />
                )}
              </Field>
              {picked && (
                <Field label="Save it as">
                  {(id) => <Input id={id} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className="!font-mono" />}
                </Field>
              )}
              {office && <Alert tone="info">{OFFICE_WARNING}</Alert>}
            </>
          )}
          {step === 'upload-folder' && (
            <>
              <Field label="Folder">
                {(id) => (
                  <input
                    id={id}
                    type="file"
                    multiple
                    {...{ webkitdirectory: '', directory: '' }}
                    onChange={(e) => setFolderFiles([...(e.target.files ?? [])])}
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
