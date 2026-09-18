import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { Tabs } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  addDocComment,
  answerDocChange,
  deleteDoc,
  deleteDocComment,
  getDocVersion,
  listDocChanges,
  listDocComments,
  listDocVersions,
  proposeDocChange,
  renameDoc,
  withdrawDocChange,
  writeDoc,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { documentFileName } from '../../lib/general/diff'
import { formatDue } from '../../lib/general/dates'
import { DOC_CHANGE_LABEL } from '../../lib/general/types'
import type {
  GeneralDocChange,
  GeneralDocComment,
  GeneralDocSummary,
  GeneralDocVersion,
} from '../../lib/general/types'
import { DiffView } from './DiffView'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type DocTab = 'write' | 'changes' | 'history'

/**
 * One document, with the three things a school paper needs: writing it, the
 * changes people have proposed to it, and what it used to say.
 *
 * Who may do what comes from `edit_files` and nothing else. Somebody who holds
 * it writes; everybody else on the project proposes, which is the same work
 * reaching the document through a review rather than around one.
 */
export function DocDialog({
  doc,
  state,
  onClose,
}: {
  doc: GeneralDocSummary | null
  state: GeneralProjectState
  onClose: () => void
}) {
  return (
    <Modal open={Boolean(doc)} onClose={onClose} title={doc?.title ?? 'Document'} size="xl">
      {doc && <DocBody key={doc.id} doc={doc} state={state} onClose={onClose} />}
    </Modal>
  )
}

function DocBody({
  doc,
  state,
  onClose,
}: {
  doc: GeneralDocSummary
  state: GeneralProjectState
  onClose: () => void
}) {
  const [tab, setTab] = useState<DocTab>('write')
  const [versions, setVersions] = useState<GeneralDocVersion[]>([])
  const [changes, setChanges] = useState<GeneralDocChange[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([listDocVersions(doc.id), listDocChanges(doc.id)])
      setVersions(v)
      setChanges(c)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [doc.id])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_doc_versions', 'general_doc_changes'])

  const open = changes.filter((c) => c.status === 'open')

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the document…
      </div>
    )
  }

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        This document did not load. Try again in a moment.
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
      <Tabs<DocTab>
        tabs={[
          { id: 'write', label: 'Document', icon: 'file' },
          { id: 'changes', label: 'Changes', icon: 'refresh', count: open.length },
          { id: 'history', label: 'History', icon: 'clock', count: versions.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'write' && (
        <WriteTab doc={doc} state={state} versions={versions} onDone={load} onClose={onClose} />
      )}
      {tab === 'changes' && (
        <ChangesTab doc={doc} state={state} changes={changes} versions={versions} onDone={load} />
      )}
      {tab === 'history' && <HistoryTab doc={doc} state={state} versions={versions} />}
    </div>
  )
}

/* ------------------------------------------------------------------- write */

function WriteTab({
  doc,
  state,
  versions,
  onDone,
  onClose,
}: {
  doc: GeneralDocSummary
  state: GeneralProjectState
  versions: GeneralDocVersion[]
  onDone: () => Promise<void>
  onClose: () => void
}) {
  const { show } = useToast()
  const current = versions.find((v) => v.version === doc.version)
  const mayWrite = state.can('edit_files')
  const [draft, setDraft] = useState(current?.body ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Somebody else's save reaches a form nobody is typing in, and leaves one
  // that is alone — the same rule the project's own fields follow.
  const seen = current?.id
  useEffect(() => {
    setDraft(current?.body ?? '')
  }, [seen]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = draft !== (current?.body ?? '')

  async function save() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      if (mayWrite) {
        await writeDoc(doc.id, draft, doc.version, note)
        show('Saved as version ' + (doc.version + 1))
      } else {
        if (!state.viewerId) return
        if (!note.trim()) {
          setError('Say what you changed, so whoever reviews it knows what to look for.')
          return
        }
        await proposeDocChange({
          docId: doc.id,
          projectId: doc.project_id,
          authorId: state.viewerId,
          baseVersion: doc.version,
          body: draft,
          note,
        })
        show('Change proposed')
      }
      setNote('')
      await Promise.all([onDone(), state.reload()])
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that.'))
    } finally {
      setBusy(false)
    }
  }

  function download(extension: 'md' | 'txt') {
    const blob = new Blob([current?.body ?? ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = documentFileName(doc.title, doc.version, extension)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="rounded-md surface-sunken px-2 py-0.5 font-mono">v{doc.version}</span>
        {current?.author_id && (
          <span>
            {state.nameOf(current.author_id)} · {formatDue(current.created_at)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => download('md')}>
            <Icon name="download" size={14} />
            Download
          </Button>
          {state.can('edit_files') && !state.archived && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {!mayWrite && !state.archived && (
        <Alert tone="info">
          You can write here, but your wording reaches the document as a change for somebody to
          review. <RequestAccessButton state={state} permission="edit_files" />
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <Field label={mayWrite ? 'The document' : 'Your version of the document'}>
        {(id) => (
          <Textarea
            id={id}
            rows={18}
            value={draft}
            maxLength={400000}
            readOnly={state.archived}
            onChange={(e) => setDraft(e.target.value)}
            className="!font-mono !text-[13px] !leading-relaxed"
          />
        )}
      </Field>

      {!state.archived && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Field label={mayWrite ? 'What you changed' : 'What you changed, for the reviewer'} optional={mayWrite}>
              {(id) => (
                <Input
                  id={id}
                  maxLength={mayWrite ? 500 : 2000}
                  placeholder="Reworded the sampling paragraph"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
            {mayWrite ? 'Save a version' : 'Propose this change'}
          </Button>
        </div>
      )}

      <RenameDialog doc={doc} open={renaming} onClose={() => setRenaming(false)} onDone={state.reload} />

      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await deleteDoc(doc.id)
          show('Document removed')
          onClose()
          await state.reload()
        }}
        title={`Remove ${doc.title}?`}
        body="Its versions, proposed changes and comments go with it. This cannot be undone."
        confirmLabel="Remove document"
        tone="danger"
      />
    </div>
  )
}

function RenameDialog({
  doc,
  open,
  onClose,
  onDone,
}: {
  doc: GeneralDocSummary
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [title, setTitle] = useState(doc.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename the document"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (!title.trim()) return setError('Give the document a title.')
              setBusy(true)
              try {
                await renameDoc(doc.id, title)
                show('Document renamed')
                onClose()
                await onDone()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not rename it.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title">
          {(id) => (
            <Input id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- changes */

function ChangesTab({
  doc,
  state,
  changes,
  versions,
  onDone,
}: {
  doc: GeneralDocSummary
  state: GeneralProjectState
  changes: GeneralDocChange[]
  versions: GeneralDocVersion[]
  onDone: () => Promise<void>
}) {
  if (changes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
        Nobody has proposed a change to this document yet.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {changes.map((c) => (
        <ChangeRow key={c.id} change={c} doc={doc} state={state} versions={versions} onDone={onDone} />
      ))}
    </ul>
  )
}

function ChangeRow({
  change,
  doc,
  state,
  versions,
  onDone,
}: {
  change: GeneralDocChange
  doc: GeneralDocSummary
  state: GeneralProjectState
  versions: GeneralDocVersion[]
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(change.status === 'open')
  const [base, setBase] = useState<string | null>(null)
  const [comments, setComments] = useState<GeneralDocComment[]>([])
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const mine = change.author_id === state.viewerId
  const mayAnswer = state.can('edit_files') && change.status === 'open'
  const stale = change.status === 'open' && change.base_version !== doc.version

  const load = useCallback(async () => {
    if (!open) return
    const known = versions.find((v) => v.version === change.base_version)
    setBase(known?.body ?? (await getDocVersion(doc.id, change.base_version))?.body ?? '')
    setComments(await listDocComments(change.id))
  }, [open, change.id, change.base_version, doc.id, versions])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      show(done)
      await Promise.all([onDone(), state.reload()])
      await load()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-line surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
            {change.note || 'A change with no note'}
          </span>
        </button>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {DOC_CHANGE_LABEL[change.status]}
        </span>
      </div>

      <p className="mt-1 pl-6 text-[12px] text-faint">
        {change.author_id ? state.nameOf(change.author_id) : 'A former member'} · against v
        {change.base_version} · {formatDue(change.created_at)}
      </p>

      {change.decided_note && (
        <p className="mt-2 ml-6 rounded-lg surface-sunken px-3 py-2 text-[13px] text-muted">
          {change.decided_by ? state.nameOf(change.decided_by) : 'Somebody'} said: {change.decided_note}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 pl-6">
          {stale && (
            <Alert tone="error">
              This was written against version {change.base_version} and the document is now on
              version {doc.version}. It cannot be applied until its author brings it up to date.
            </Alert>
          )}

          {base !== null && (
            <DiffView
              before={base}
              after={change.body}
              caption="What this change would do to the document, line by line"
            />
          )}

          <section>
            <h4 className="text-[13px] font-medium text-ink">Comments</h4>
            <ul className="mt-1.5 space-y-1.5">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-lg surface-sunken px-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    <span className="font-medium">
                      {c.author_id ? state.nameOf(c.author_id) : 'A former member'}
                    </span>{' '}
                    <span className="whitespace-pre-wrap break-words text-muted">{c.body}</span>
                  </span>
                  {!state.archived && (c.author_id === state.viewerId || state.can('edit_files')) && (
                    <button
                      type="button"
                      aria-label="Remove comment"
                      disabled={busy}
                      onClick={() =>
                        void run(() => deleteDocComment(c.id), 'Comment removed', 'Could not remove it.')
                      }
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-faint hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </li>
              ))}
              {comments.length === 0 && <li className="text-[12px] text-faint">No comments yet.</li>}
            </ul>

            {!state.archived && state.viewerId && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!body.trim()) return
                  void run(
                    () => addDocComment(change.id, doc.project_id, state.viewerId as string, body),
                    'Comment posted',
                    'Could not post that comment.',
                  ).then(() => setBody(''))
                }}
              >
                <Input
                  aria-label="Write a comment"
                  placeholder="Ask a question or say what you would change"
                  maxLength={5000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="!h-9 !text-[13px]"
                />
                <Button type="submit" size="sm" variant="outline" className="!h-9 shrink-0">
                  Comment
                </Button>
              </form>
            )}
          </section>

          {!state.archived && (
            <div className="flex flex-wrap items-center gap-2">
              {mine && change.status === 'open' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => withdrawDocChange(change.id),
                      'Change withdrawn',
                      'Could not withdraw it.',
                    )
                  }
                >
                  Withdraw
                </Button>
              )}
              {mayAnswer && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="A note back"
                    placeholder="A note back (optional)"
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="!h-9 !w-[16rem] !text-[13px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => void (await answerDocChange(change.id, false, note)),
                        'Change declined',
                        'Could not decline it.',
                      )
                    }
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={stale}
                    onClick={() =>
                      void run(
                        async () => void (await answerDocChange(change.id, true, note)),
                        'Change applied',
                        'Could not apply it.',
                      )
                    }
                  >
                    Apply
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/* ----------------------------------------------------------------- history */

function HistoryTab({
  doc,
  state,
  versions,
}: {
  doc: GeneralDocSummary
  state: GeneralProjectState
  versions: GeneralDocVersion[]
}) {
  const [comparing, setComparing] = useState<number | null>(null)
  const newest = versions.find((v) => v.version === doc.version)
  const chosen = versions.find((v) => v.version === comparing)
  const previous = chosen ? versions.find((v) => v.version === chosen.version - 1) : undefined

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
            <span className="w-12 shrink-0 font-mono text-[12px] text-faint">v{v.version}</span>
            <span className="min-w-0 flex-1 text-[13px] text-ink">
              {v.note || 'No note'}
              <span className="block text-[12px] text-faint">
                {v.author_id ? state.nameOf(v.author_id) : 'A former member'} ·{' '}
                {formatDue(v.created_at)}
                {v.change_id ? ' · from a reviewed change' : ''}
              </span>
            </span>
            {v.version > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setComparing(comparing === v.version ? null : v.version)}
              >
                {comparing === v.version ? 'Hide' : 'What changed'}
              </Button>
            )}
          </li>
        ))}
        {versions.length === 0 && (
          <li className="px-3.5 py-6 text-center text-[13px] text-muted">No versions yet.</li>
        )}
      </ul>

      {chosen && previous && (
        <section>
          <h4 className="mb-1.5 text-[13px] font-medium text-ink">
            v{previous.version} to v{chosen.version}
          </h4>
          <DiffView before={previous.body} after={chosen.body} />
        </section>
      )}

      {newest && (
        <p className="text-[12px] text-faint">
          Version {newest.version} is what the document says now.
        </p>
      )}
    </div>
  )
}
