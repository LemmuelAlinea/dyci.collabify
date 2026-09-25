import { useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  archiveDraftPath,
  discardDraft,
  submitDraftFolder,
  submitDraftFile,
  syncDraft,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { buildTree, describeDraft, fileText } from '../../lib/general/files'
import type { TreeNode } from '../../lib/general/files'
import { FILE_ACTION_LABEL } from '../../lib/general/types'
import type {
  DraftConflict,
  GeneralDraft,
  GeneralDraftFile,
  GeneralRepoSummary,
} from '../../lib/general/types'
import { fullName } from '../../lib/types'
import { DiffView } from './DiffView'
import type { OpenFile } from './FileEditor'
import type { GeneralProjectState } from './useGeneralProject'

type SubmitTarget = { type: 'file' | 'folder'; path: string }

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
  state,
  mainOf,
  onOpen,
  onDone,
}: {
  draft: GeneralDraft | null
  files: GeneralDraftFile[]
  conflicts: DraftConflict[]
  repo: GeneralRepoSummary
  state: GeneralProjectState
  /** What Main says for a path, so the diff shows what submitting would do. */
  mainOf: (path: string) => string
  onOpen: (file: OpenFile) => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [submitting, setSubmitting] = useState<SubmitTarget | null>(null)
  const [archiving, setArchiving] = useState<SubmitTarget | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)

  const behind = draft !== null && draft.base_seq !== repo.commit_count
  const nodes = buildTree(files as unknown as Parameters<typeof buildTree>[0])

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
        {nodes.map((node) => (
          <DraftNode
            key={node.path}
            node={node}
            depth={0}
            busy={busy}
            behind={behind}
            conflicts={conflicts}
            mainOf={mainOf}
            onOpen={onOpen}
            onArchive={setArchiving}
            onSubmit={setSubmitting}
          />
        ))}
      </ul>

      <SubmitDialog
        target={submitting}
        onClose={() => setSubmitting(null)}
        reviewers={state.members.filter(
          (member) => member.user_id !== state.viewerId && member.profile?.status !== 'rejected',
        )}
        onSubmit={async (title, body, reviewerId) => {
          if (!submitting) return
          if (submitting.type === 'folder') {
            await submitDraftFolder(repo.id, submitting.path, title, body, reviewerId)
          } else {
            await submitDraftFile(repo.id, submitting.path, title, body, reviewerId)
          }
          show('Submitted for review')
          await onDone()
        }}
      />

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return
          await archiveDraftPath(repo.id, archiving.path, true)
          show(archiving.type === 'folder' ? 'Folder archived' : 'File archived')
          await onDone()
        }}
        title={`Archive ${archiving?.type ?? 'item'}?`}
        body="It leaves My draft and moves to the project archive. You can restore it there or delete it permanently."
        confirmLabel="Archive"
        tone="primary"
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

function DraftNode({
  node,
  depth,
  busy,
  behind,
  conflicts,
  mainOf,
  onOpen,
  onArchive,
  onSubmit,
}: {
  node: TreeNode
  depth: number
  busy: boolean
  behind: boolean
  conflicts: DraftConflict[]
  mainOf: (path: string) => string
  onOpen: (file: OpenFile) => void
  onArchive: (target: SubmitTarget) => void
  onSubmit: (target: SubmitTarget) => void
}) {
  const [open, setOpen] = useState(depth === 0)

  if (node.type === 'folder') {
    return (
      <li>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5" style={{ paddingLeft: `${depth * 1.25 + 1.25}rem` }}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
            <Icon name="folder" size={15} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.path}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
          </button>
          <DraftActionMenu
            disabled={busy}
            submitDisabled={behind}
            onSubmit={() => onSubmit({ type: 'folder', path: node.path })}
            onArchive={() => onArchive({ type: 'folder', path: node.path })}
          />
        </div>
        {open && (
          <ul>
            {node.children.map((child) => (
              <DraftNode
                key={child.path}
                node={child}
                depth={depth + 1}
                busy={busy}
                behind={behind}
                conflicts={conflicts}
                mainOf={mainOf}
                onOpen={onOpen}
                onArchive={onArchive}
                onSubmit={onSubmit}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const f = node.file as unknown as GeneralDraftFile
  const clashing = conflicts.some((c) => c.path === f.path)

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5" style={{ paddingLeft: `${depth * 1.25 + 1.25}rem` }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{f.path}</span>
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
        <DraftActionMenu
          disabled={busy}
          submitDisabled={behind}
          onSubmit={() => onSubmit({ type: 'file', path: f.path })}
          onArchive={() => onArchive({ type: 'file', path: f.path })}
        />
      </div>
      {open && (
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
}

function DraftActionMenu({
  disabled,
  submitDisabled,
  onSubmit,
  onArchive,
}: {
  disabled: boolean
  submitDisabled: boolean
  onSubmit: () => void
  onArchive: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Draft actions"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
      >
        <Icon name="dots" size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line surface shadow-lg">
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() => {
              setOpen(false)
              onSubmit()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)] disabled:opacity-50"
          >
            <Icon name="refresh" size={14} />
            Submit for review
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onArchive()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)]"
          >
            <Icon name="archive" size={14} />
            Archive
          </button>
        </div>
      )}
    </div>
  )
}

function SubmitDialog({
  target,
  onClose,
  reviewers,
  onSubmit,
}: {
  target: SubmitTarget | null
  onClose: () => void
  reviewers: GeneralProjectState['members']
  onSubmit: (title: string, body: string, reviewerId: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = reviewers.map((member) => ({
    value: member.user_id,
    label: member.profile ? fullName(member.profile) : 'A member',
  }))

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={`Submit this ${target?.type ?? 'file'}`}
      description={target ? `${target.path} goes over as one change.` : undefined}
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
              if (!reviewerId) return setError('Choose who should review this.')
              setError(null)
              setBusy(true)
              try {
                await onSubmit(title, body, reviewerId)
                setTitle('')
                setBody('')
                setReviewerId('')
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
        <Field label="Who should review this?">
          {(id) => (
            <Select
              id={id}
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
              placeholder="Choose a project member"
              options={options}
            />
          )}
        </Field>
        {options.length === 0 && (
          <Alert tone="error">Add another project member before submitting for review.</Alert>
        )}
      </div>
    </Modal>
  )
}
