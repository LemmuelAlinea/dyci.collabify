import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import { createDoc, listDocs } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import type { GeneralDocSummary } from '../../lib/general/types'
import { DocDialog } from './DocDialog'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * The project's written work.
 *
 * A research paper, a terminal report, a concept note — the things a school
 * project is finally judged on. They live here rather than as attachments so
 * they can be written together and so the record of who wrote what survives.
 */
export function DocsTab({ state }: { state: GeneralProjectState }) {
  const [docs, setDocs] = useState<GeneralDocSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const projectId = state.project?.id

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      setDocs(await listDocs(projectId))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_docs', 'general_doc_changes'])

  const mayAdd = state.can('edit_files') && !state.archived
  const shown = docs.find((d) => d.id === open) ?? null

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the documents…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Documents</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Written together. Anybody on the project can propose a change; whoever can edit files
            reviews it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!state.can('edit_files') && !state.archived && (
            <RequestAccessButton state={state} permission="edit_files" />
          )}
          {mayAdd && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              New document
            </Button>
          )}
        </div>
      </div>

      {failed && (
        <Alert tone="error" onRetry={load}>
          The documents did not load. Try again in a moment.
        </Alert>
      )}

      {docs.length === 0 && !failed ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          No documents yet. A paper, a report or a concept note all start here.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setOpen(d.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-sunken)] sm:px-5"
              >
                <Icon name="file" size={16} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{d.title}</span>
                  <span className="block text-[12px] text-faint">
                    v{d.version}
                    {d.last_author ? ` · ${state.nameOf(d.last_author)}` : ''}
                    {d.last_written_at ? ` · ${formatDue(d.last_written_at)}` : ''}
                  </span>
                </span>
                {d.open_change_count > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-400/25 px-2 py-0.5 text-[12px] font-medium text-amber-800 dark:text-amber-200">
                    {d.open_change_count} waiting
                  </span>
                )}
                <Icon name="chevronRight" size={15} className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <DocDialog doc={shown} state={state} onClose={() => setOpen(null)} />
      <NewDocDialog
        open={adding}
        onClose={() => setAdding(false)}
        projectId={projectId}
        onDone={async () => {
          await Promise.all([load(), state.reload()])
        }}
      />
    </div>
  )
}

function NewDocDialog({
  open,
  onClose,
  projectId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  projectId: string | undefined
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!projectId || busy) return
    if (!title.trim()) return setError('Give the document a title.')
    setError(null)
    setBusy(true)
    try {
      await createDoc(projectId, title, body)
      show('Document added')
      setTitle('')
      setBody('')
      onClose()
      await onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that document.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New document"
      description="Version 1 is written the moment you add it."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Add document
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              maxLength={200}
              placeholder="Chapter 1 — the problem and its background"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Start it off" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={8}
              maxLength={400000}
              placeholder="Paste what you have, or leave it empty and write it here."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="!font-mono !text-[13px]"
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
