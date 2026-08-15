import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../../components/ui/Button'
import { Alert, Field, Input } from '../../../components/ui/Field'
import { FileDrop, formatBytes } from '../../../components/ui/FileDrop'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import {
  deleteResource,
  listResources,
  resourceUrl,
  uploadResource,
} from '../../../lib/api/resources'
import { authErrorMessage } from '../../../lib/authError'
import type { ResourceKind, TeachingResource } from '../../../lib/types'

type Copy = {
  title: string
  eyebrow: string
  intro: string
  emptyTitle: string
  emptyBody: string
  addLabel: string
  titleLabel: string
  titlePlaceholder: string
}

export function ResourceLibrary({ kind, copy }: { kind: ResourceKind; copy: Copy }) {
  const { profile } = useAuth()
  const { show } = useToast()

  const [items, setItems] = useState<TeachingResource[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<TeachingResource | null>(null)

  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    document.title = `${copy.title} · Collabify`
  }, [copy.title])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      setItems(await listResources(profile.id, kind))
      setLoadError(null)
    } catch (err) {
      setLoadError(authErrorMessage(err, `Could not load your ${copy.title.toLowerCase()}.`))
      setItems([])
    }
  }, [profile, kind, copy.title])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setTitle('')
    setFile(null)
    setFormError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !file) {
      setFormError('Pick a file to upload.')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      await uploadResource({ professorId: profile.id, kind, title, file })
      setAddOpen(false)
      resetForm()
      show(`${copy.titleLabel} uploaded`)
      await load()
    } catch (err) {
      setFormError(authErrorMessage(err, 'Could not upload that file.'))
    } finally {
      setBusy(false)
    }
  }

  async function open(resource: TeachingResource) {
    try {
      window.open(await resourceUrl(resource.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">{copy.eyebrow}</p>
          <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">{copy.title}</h1>
          <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">{copy.intro}</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="!rounded-xl">
          <Icon name="plus" size={17} />
          {copy.addLabel}
        </Button>
      </header>

      <div className="mt-8">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {items === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="file"
            title={copy.emptyTitle}
            body={copy.emptyBody}
            action={
              <Button onClick={() => setAddOpen(true)} className="!rounded-xl">
                {copy.addLabel}
              </Button>
            }
          />
        ) : (
          <ul className="surface divide-y divide-[var(--line)] rounded-card border border-line shadow-card">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl surface-sunken text-muted">
                  <Icon name="file" size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{r.title}</p>
                  <p className="truncate text-[12.5px] text-faint">
                    {r.file_name} · {formatBytes(r.size_bytes)} ·{' '}
                    {new Date(r.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => open(r)}
                    aria-label={`Open ${r.title}`}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="eye" size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(r)}
                    aria-label={`Delete ${r.title}`}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false)
          resetForm()
        }}
        title={copy.addLabel}
        description="Classes can point at this once it's uploaded."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAddOpen(false)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button form="resource-form" type="submit" loading={busy} className="!rounded-xl">
              Upload
            </Button>
          </>
        }
      >
        <form id="resource-form" onSubmit={submit} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Field label={copy.titleLabel}>
            {(id) => (
              <Input
                id={id}
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={copy.titlePlaceholder}
              />
            )}
          </Field>
          <Field label="File">
            {() => <FileDrop file={file} onPick={setFile} maxSize={10} />}
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteResource(pendingDelete)
          show(`${pendingDelete.title} deleted`)
          await load()
        }}
        title={`Delete ${pendingDelete?.title ?? ''}?`}
        body="The file is removed for good. Any class pointing at it keeps working, but the link goes away."
        confirmLabel="Delete"
      />
    </div>
  )
}
