import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  discardDraft,
  discardDraftFile,
  submitDraft,
  syncDraft,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { describeDraft, fileText } from '../../lib/general/files'
import { FILE_ACTION_LABEL } from '../../lib/general/types'
import type {
  DraftConflict,
  GeneralDraft,
  GeneralDraftFile,
  GeneralRepoSummary,
} from '../../lib/general/types'
import { DiffView } from './DiffView'
import type { OpenFile } from './FileEditor'

/**
 * Your working copy, and the one button that hands it over.
 *
 * Everything here is yours alone until you submit. That is what makes it worth
 * having: a chapter can sit half-rewritten for a week without the group seeing
 * a mess, and the group is asked to approve one finished thought rather than
 * every save along the way.
 */
export function DraftPanel({
  draft,
  files,
  conflicts,
  repo,
  mainOf,
  onOpen,
  onDone,
}: {
  draft: GeneralDraft | null
  files: GeneralDraftFile[]
  conflicts: DraftConflict[]
  repo: GeneralRepoSummary
  /** What Main says for a path, so the diff shows what submitting would do. */
  mainOf: (path: string) => string
  onOpen: (file: OpenFile) => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const behind = draft !== null && draft.base_seq !== repo.commit_count

  async function run(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      show(done)
      await onDone()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (files.length === 0) {
    return (
      <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
        <Icon name="edit" size={26} className="mx-auto text-faint" />
        <h3 className="mt-3 text-[15px]">Your draft is empty</h3>
        <p className="mx-auto mt-1.5 max-w-[32rem] text-[13px] text-muted">
          Open a file, change it, and save it here. Nothing you put in a draft reaches the project
          until you submit it for review.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {describeDraft(files)}
          {draft && <span className="text-faint"> · started from commit {draft.base_seq}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDiscarding(true)}>
            Discard it all
          </Button>
          <Button size="sm" disabled={busy || behind} onClick={() => setSubmitting(true)}>
            Submit for review
          </Button>
        </div>
      </div>

      {behind && (
        <Alert tone="error">
          The project moved to commit {repo.commit_count} while you were working, and your draft
          started from {draft?.base_seq}.
          {conflicts.length > 0 ? (
            <>
              {' '}
              {conflicts.length === 1 ? 'This file was' : 'These files were'} changed underneath
              you: {conflicts.map((c) => c.path).join(', ')}. Open{' '}
              {conflicts.length === 1 ? 'it' : 'them'} and check your wording still fits, then bring
              your draft up to date.
            </>
          ) : (
            ' None of your files were touched, so bringing it up to date is safe.'
          )}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                async () => void (await syncDraft(repo.id)),
                'Your draft is up to date',
                'Could not bring it up to date.',
              )
            }
            className="font-medium underline"
          >
            Bring it up to date
          </button>
          .
        </Alert>
      )}

      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
        {files.map((f) => {
          const clashing = conflicts.some((c) => c.path === f.path)
          return (
            <li key={f.id}>
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                <button
                  type="button"
                  onClick={() => setOpen(open === f.path ? null : f.path)}
                  aria-expanded={open === f.path}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Icon
                    name={open === f.path ? 'chevronDown' : 'chevronRight'}
                    size={14}
                    className="shrink-0 text-faint"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                    {f.path}
                  </span>
                </button>
                <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                  {FILE_ACTION_LABEL[f.action]}
                </span>
                {clashing && (
                  <span className="shrink-0 rounded-md bg-amber-400/25 px-2 py-0.5 text-[12px] font-medium text-amber-800 dark:text-amber-200">
                    Changed in Main
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onOpen({
                      path: f.path,
                      kind: f.kind,
                      content: f.content,
                      storagePath: f.storage_path,
                      action: f.action,
                      fromDraft: true,
                    })
                  }
                >
                  Open
                </Button>
                <button
                  type="button"
                  aria-label={`Drop ${f.path} from your draft`}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => discardDraftFile(repo.id, f.path),
                      'Dropped from your draft',
                      'Could not drop it.',
                    )
                  }
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {open === f.path && (
                <div className="px-4 pb-4 sm:px-5">
                  <DiffView
                    before={f.action === 'added' ? '' : fileText(f.kind, mainOf(f.path))}
                    after={f.action === 'removed' ? '' : fileText(f.kind, f.content)}
                    caption={`What your draft would do to ${f.path}, line by line`}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <SubmitDialog
        open={submitting}
        onClose={() => setSubmitting(false)}
        count={files.length}
        onSubmit={async (title, body) => {
          await submitDraft(repo.id, title, body)
          show('Submitted for review')
          await onDone()
        }}
      />

      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        onConfirm={async () => {
          await discardDraft(repo.id)
          show('Draft discarded')
          await onDone()
        }}
        title="Discard everything in your draft?"
        body={`${describeDraft(files)}. This cannot be undone, and nothing in Main changes.`}
        confirmLabel="Discard it all"
        tone="danger"
      />
    </div>
  )
}

function SubmitDialog({
  open,
  onClose,
  count,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  count: number
  onSubmit: (title: string, body: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit your draft"
      description={`All ${count} ${count === 1 ? 'file' : 'files'} go over as one change.`}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (!title.trim()) return setError('Say what this change is, in a few words.')
              setError(null)
              setBusy(true)
              try {
                await onSubmit(title, body)
                setTitle('')
                setBody('')
                onClose()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not submit it.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Submit for review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="What this change is">
          {(id) => (
            <Input
              id={id}
              maxLength={200}
              placeholder="Rewrote chapter 3 after the adviser's comments"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Anything the reviewer should know" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={20000}
              placeholder="What you were unsure about, or what you would like them to look at."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
