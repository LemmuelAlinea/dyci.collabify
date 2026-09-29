import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ActionMenu } from '../ui/ActionMenu'
import type { ActionMenuItem } from '../ui/ActionMenu'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  createDiscussionFolder,
  deleteDiscussionFolder,
  listDiscussionFolders,
  listDiscussionMessages,
  listDiscussions,
  moveDiscussion,
  renameDiscussion,
  renameDiscussionFolder,
  saveDiscussionFile,
  sendDiscussionMessage,
  startDiscussion,
  stopDiscussion,
  trashDiscussion,
} from '../../lib/api/discussions'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { folderNameProblem } from '../../lib/general/files'
import { downloadBlob, htmlToDocx } from '../../lib/general/office'
import { matches } from '../../lib/general/search'
import type { GeneralDiscussion, GeneralDiscussionFolder, GeneralDiscussionMessage } from '../../lib/general/types'
import { FolderBar } from './FolderBar'
import { RichEditor } from './RichEditor'
import type { GeneralProjectState } from './useGeneralProject'

/** A file name from a discussion's topic. */
const fileBase = (d: GeneralDiscussion) => d.topic.replace(/[/\\:*?"<>|]+/g, ' ').trim() || 'Discussion'

async function download(d: GeneralDiscussion, html: string, as: 'docx' | 'pdf') {
  if (as === 'docx') {
    downloadBlob(await htmlToDocx(html, d.topic), `${fileBase(d)}.docx`)
  } else {
    const { htmlToPdf } = await import('../../lib/general/pdf')
    downloadBlob(await htmlToPdf(html, d.topic), `${fileBase(d)}.pdf`)
  }
}

/**
 * The project's discussion room.
 *
 * One live discussion at a time. Whoever starts it can stop it, and stopping
 * writes the whole conversation into a discussion file the group can edit,
 * download, and draft tasks from. Files sit in folders one level deep.
 */
export function DiscussionTab({ state }: { state: GeneralProjectState }) {
  const projectId = state.project?.id
  const { show } = useToast()
  const [folders, setFolders] = useState<GeneralDiscussionFolder[]>([])
  const [discussions, setDiscussions] = useState<GeneralDiscussion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [starting, setStarting] = useState(false)
  const [naming, setNaming] = useState<
    { kind: 'new-folder' } | { kind: 'folder'; folder: GeneralDiscussionFolder } | { kind: 'file'; discussion: GeneralDiscussion } | null
  >(null)
  const [moving, setMoving] = useState<GeneralDiscussion | null>(null)
  const [opened, setOpened] = useState<GeneralDiscussion | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [f, d] = await Promise.all([listDiscussionFolders(projectId), listDiscussions(projectId)])
      setFolders(f)
      setDiscussions(d)
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

  useLive(load, ['general_discussions', 'general_discussion_folders'])

  const readOnly = state.archived
  const lead = state.me?.level === 'owner' || state.me?.level === 'manager'
  const live = discussions.find((d) => !d.ended_at) ?? null
  const folder = folders.find((f) => f.id === params.get('dfolder')) ?? null

  function openFolder(next: GeneralDiscussionFolder | null) {
    setQuery('')
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (next) p.set('dfolder', next.id)
      else p.delete('dfolder')
      return p
    })
  }

  async function run(action: () => Promise<unknown>, done: string, failedMessage: string) {
    try {
      await action()
      if (done) show(done)
      await load()
    } catch (err) {
      show(authErrorMessage(err, failedMessage), 'error')
    }
  }

  const notice = (
    <Alert tone="info">
      This room is for planning the project: tasks, plans and events. Everything said here is saved
      in the discussion file and can be turned into tasks, so off-topic talk ends up there too.
    </Alert>
  )

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the discussions…
      </div>
    )
  }

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        The discussions did not load. Try again in a moment.
      </Alert>
    )
  }

  if (live) {
    return (
      <div className="space-y-4">
        {notice}
        <LiveRoom
          discussion={live}
          state={state}
          readOnly={readOnly}
          folderName={folders.find((f) => f.id === live.folder_id)?.name ?? null}
          onStopped={load}
        />
      </div>
    )
  }

  const inHere = discussions.filter((d) => d.ended_at && (d.folder_id ?? null) === (folder?.id ?? null))
  const shownFiles = query.trim()
    ? discussions.filter((d) => d.ended_at && matches(query, d.topic, d.started_by ? state.nameOf(d.started_by) : ''))
    : inHere
  const shownFolders = !folder && !query.trim() ? folders : []

  function fileMenu(d: GeneralDiscussion): ActionMenuItem[] {
    const mayTrash = !readOnly && (d.started_by === state.viewerId || lead)
    return [
      { label: 'Open', icon: 'eye', onSelect: () => setOpened(d) },
      {
        label: 'Download .docx',
        icon: 'download',
        onSelect: () => void download(d, d.content_html, 'docx').catch(() => show('Could not build the .docx. Try again.', 'error')),
      },
      {
        label: 'Download .pdf',
        icon: 'download',
        onSelect: () => void download(d, d.content_html, 'pdf').catch(() => show('Could not build the PDF. Try again.', 'error')),
      },
      ...(!readOnly
        ? [
            { label: 'Rename', icon: 'edit' as const, onSelect: () => setNaming({ kind: 'file', discussion: d }) },
            { label: 'Move to folder', icon: 'folder' as const, onSelect: () => setMoving(d) },
          ]
        : []),
      ...(mayTrash
        ? [
            {
              label: 'Move to trash',
              icon: 'trash' as const,
              tone: 'danger' as const,
              separated: true,
              onSelect: () =>
                void run(
                  () => trashDiscussion(d.id),
                  'Discussion moved to Trash. It stays there for 30 days.',
                  'Could not move it to Trash.',
                ),
            },
          ]
        : []),
    ]
  }

  return (
    <div className="space-y-4">
      {notice}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2>Discussion</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {discussions.length} {discussions.length === 1 ? 'discussion' : 'discussions'} · {folders.length}{' '}
            {folders.length === 1 ? 'folder' : 'folders'}
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {!folder && (
              <Button size="sm" variant="outline" onClick={() => setNaming({ kind: 'new-folder' })}>
                <Icon name="folder" size={14} />
                New folder
              </Button>
            )}
            <Button size="sm" onClick={() => setStarting(true)}>
              <Icon name="message" size={14} />
              Start discussion
            </Button>
          </div>
        )}
      </header>

      <Input
        icon="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search discussions"
        aria-label="Search discussions"
        className="max-w-md"
      />

      {!query.trim() && (
        <FolderBar
          rootLabel="Discussions"
          path={folder?.name ?? ''}
          onNavigate={(p) => openFolder(p ? folder : null)}
          actions={
            folder && !readOnly ? (
              <ActionMenu
                label={`Actions for ${folder.name}`}
                items={[
                  { label: 'Rename', icon: 'edit', onSelect: () => setNaming({ kind: 'folder', folder }) },
                  {
                    label: 'Delete folder',
                    icon: 'trash',
                    tone: 'danger',
                    separated: true,
                    onSelect: () =>
                      void run(
                        async () => {
                          await deleteDiscussionFolder(folder.id)
                          openFolder(null)
                        },
                        'Folder deleted',
                        'Could not delete the folder.',
                      ),
                  },
                ]}
              />
            ) : undefined
          }
        />
      )}

      {shownFolders.length === 0 && shownFiles.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
          <Icon name="message" size={26} className="mx-auto text-faint" />
          <p className="mx-auto mt-3 max-w-[32rem] text-[13px] text-muted">
            {query.trim()
              ? `No discussion matches “${query.trim()}”.`
              : folder
                ? 'No discussions in this folder yet. Start one here and its file is saved in this folder.'
                : 'No discussions yet. Start one, and when it stops the whole conversation is saved here as a file.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
          {shownFolders.map((f) => {
            const count = discussions.filter((d) => d.folder_id === f.id && d.ended_at).length
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => openFolder(f)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <Icon name="folder" size={15} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{f.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{count}</span>
                  <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
                </button>
              </li>
            )
          })}
          {shownFiles.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
              <button type="button" onClick={() => setOpened(d)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <Icon name="file" size={15} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{d.topic}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {d.started_by ? state.nameOf(d.started_by) : 'A former member'} · {formatDue(d.started_at)}
                    {query.trim() && d.folder_id ? ` · ${folders.find((f) => f.id === d.folder_id)?.name ?? ''}` : ''}
                  </span>
                </span>
                <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">Document</span>
              </button>
              <ActionMenu label={`Actions for ${d.topic}`} items={fileMenu(d)} />
            </li>
          ))}
        </ul>
      )}

      <StartDialog
        open={starting}
        folderName={folder?.name ?? null}
        onClose={() => setStarting(false)}
        onStart={async (topic) => {
          if (!projectId) return
          await startDiscussion(projectId, folder?.id ?? null, topic)
          show('Discussion started. The group has been told.')
          await load()
        }}
      />

      <NameDialog
        target={naming}
        siblings={folders.map((f) => f.name)}
        onClose={() => setNaming(null)}
        onSave={async (name) => {
          if (!naming || !projectId) return
          if (naming.kind === 'new-folder') await createDiscussionFolder(projectId, name)
          else if (naming.kind === 'folder') await renameDiscussionFolder(naming.folder.id, name)
          else await renameDiscussion(naming.discussion.id, name)
          show(naming.kind === 'new-folder' ? 'Folder made' : 'Renamed')
          await load()
        }}
      />

      <MoveDialog
        discussion={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onMove={async (folderId) => {
          if (!moving) return
          await moveDiscussion(moving.id, folderId)
          show('Moved')
          await load()
        }}
      />

      <FileDialog
        discussion={opened}
        readOnly={readOnly}
        onClose={() => setOpened(null)}
        onSaved={load}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ live room */

function LiveRoom({
  discussion,
  state,
  readOnly,
  folderName,
  onStopped,
}: {
  discussion: GeneralDiscussion
  state: GeneralProjectState
  readOnly: boolean
  folderName: string | null
  onStopped: () => Promise<void>
}) {
  const { show } = useToast()
  const [messages, setMessages] = useState<GeneralDiscussionMessage[] | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setMessages(await listDiscussionMessages(discussion.id))
    } catch {
      setMessages((prev) => prev ?? [])
    }
  }, [discussion.id])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_discussion_messages'], { every: 10_000 })

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages?.length])

  const starterHere = state.members.some((m) => m.user_id === discussion.started_by)
  const lead = state.me?.level === 'owner' || state.me?.level === 'manager'
  const mayStop = !readOnly && (discussion.started_by === state.viewerId || (lead && !starterHere))

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await sendDiscussionMessage(discussion.id, text)
      setBody('')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that. Try again.'), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-label="Live discussion" className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <span className="h-2 w-2 shrink-0 rounded-full bg-success-500" aria-hidden />
            <span className="truncate">{discussion.topic}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            Started by {discussion.started_by ? state.nameOf(discussion.started_by) : 'a former member'} ·{' '}
            {formatDue(discussion.started_at)}
            {folderName ? ` · saves in ${folderName}` : ''}
          </p>
        </div>
        {mayStop ? (
          <Button size="sm" variant="outline" onClick={() => setStopping(true)}>
            <Icon name="check" size={14} />
            Stop discussion
          </Button>
        ) : (
          <p className="text-[12px] text-faint">Only whoever started it can stop it.</p>
        )}
      </header>

      <div className="max-h-[28rem] min-h-[14rem] space-y-3 overflow-y-auto px-4 py-4">
        {messages === null ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner size={14} />
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">
            Nothing said yet. Open with what this discussion should decide.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === state.viewerId
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] ${
                    mine ? 'bg-navy-600 text-white dark:bg-navy-500' : 'surface-sunken text-ink'
                  }`}
                >
                  {!mine && (
                    <p className="mb-0.5 text-[11px] font-medium text-muted">
                      {m.sender_id ? state.nameOf(m.sender_id) : 'A former member'}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[10.5px] ${mine ? 'text-white/70' : 'text-faint'}`}>
                    {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      {!readOnly && (
        <div className="flex items-end gap-2 border-t border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <Textarea
              rows={2}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Plans, tasks, dates… Enter sends, Shift+Enter for a new line"
              aria-label="Message"
            />
          </div>
          <Button loading={sending} disabled={!body.trim()} onClick={() => void send()}>
            Send
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={stopping}
        onClose={() => setStopping(false)}
        onConfirm={async () => {
          await stopDiscussion(discussion.id)
          show('Discussion stopped and saved as a file')
          await onStopped()
        }}
        title="Stop this discussion?"
        body="The whole conversation is saved as a discussion file everyone in the group can edit and download. Nobody can send more messages to it."
        confirmLabel="Stop and save"
        tone="primary"
      />
    </section>
  )
}

/* ------------------------------------------------------------------ dialogs */

function StartDialog({
  open,
  folderName,
  onClose,
  onStart,
}: {
  open: boolean
  folderName: string | null
  onClose: () => void
  onStart: (topic: string) => Promise<void>
}) {
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTopic('')
      setError(null)
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a discussion"
      description={`Everyone on the project is told. ${folderName ? `Its file is saved in ${folderName}.` : 'Its file is saved at the top of Discussions.'}`}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onStart(topic)
                onClose()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not start the discussion.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Start discussion
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="What is it about?" optional>
          {(id) => (
            <Input
              id={id}
              maxLength={120}
              placeholder="Sprint 2 plan and who does what"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          )}
        </Field>
        <p className="text-[12px] text-muted">Left empty, it is named by today's date and time.</p>
      </div>
    </Modal>
  )
}

function NameDialog({
  target,
  siblings,
  onClose,
  onSave,
}: {
  target: { kind: 'new-folder' } | { kind: 'folder'; folder: GeneralDiscussionFolder } | { kind: 'file'; discussion: GeneralDiscussion } | null
  siblings: string[]
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    setError(null)
    setName(target.kind === 'folder' ? target.folder.name : target.kind === 'file' ? target.discussion.topic : '')
  }, [target])

  const isFolder = target?.kind !== 'file'

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target?.kind === 'new-folder' ? 'New folder' : isFolder ? 'Rename folder' : 'Rename discussion'}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              const clean = name.trim()
              const others = target?.kind === 'folder' ? siblings.filter((s) => s !== target.folder.name) : siblings
              const problem = isFolder ? folderNameProblem(clean, others) : clean ? null : 'Give it a name.'
              if (problem) return setError(problem)
              setBusy(true)
              setError(null)
              try {
                await onSave(clean)
                onClose()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not save the name.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            {target?.kind === 'new-folder' ? 'Make folder' : 'Rename'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => <Input id={id} maxLength={isFolder ? 80 : 120} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}

function MoveDialog({
  discussion,
  folders,
  onClose,
  onMove,
}: {
  discussion: GeneralDiscussion | null
  folders: GeneralDiscussionFolder[]
  onClose: () => void
  onMove: (folderId: string | null) => Promise<void>
}) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (discussion) {
      setTarget(discussion.folder_id ?? '')
      setError(null)
    }
  }, [discussion])

  return (
    <Modal
      open={discussion !== null}
      onClose={onClose}
      title="Move to folder"
      description={discussion?.topic}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onMove(target || null)
                onClose()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not move it.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Folder">
          {(id) => (
            <Select
              id={id}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              options={[{ value: '', label: 'No folder (top of Discussions)' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}

/** A discussion file, open to read, edit and download. */
function FileDialog({
  discussion,
  readOnly,
  onClose,
  onSaved,
}: {
  discussion: GeneralDiscussion | null
  readOnly: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const [html, setHtml] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!discussion) return
    setHtml(discussion.content_html)
    setExpected(discussion.updated_at)
    setError(null)
  }, [discussion])

  const dirty = discussion !== null && html !== discussion.content_html

  return (
    <Modal open={discussion !== null} onClose={onClose} title={discussion?.topic ?? 'Discussion'} size="xl">
      {discussion && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="rounded-md surface-sunken px-2 py-0.5">Discussion file</span>
            <span>Last saved {formatDue(discussion.updated_at)}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => void download(discussion, html, 'docx').catch(() => show('Could not build the .docx. Try again.', 'error'))}
            >
              <Icon name="download" size={14} />
              .docx
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void download(discussion, html, 'pdf').catch(() => show('Could not build the PDF. Try again.', 'error'))}
            >
              <Icon name="download" size={14} />
              .pdf
            </Button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <RichEditor value={html} onChange={setHtml} readOnly={readOnly} />
          {!readOnly && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button
                loading={busy}
                disabled={!dirty}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    setExpected(await saveDiscussionFile(discussion.id, html, expected))
                    show('Saved')
                    await onSaved()
                  } catch (err) {
                    setError(authErrorMessage(err, 'Could not save the file.'))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
