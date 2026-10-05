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
import { useAutoGrow } from '../../hooks/useAutoGrow'
import { useFocusWhile } from '../../lib/focusMode'
import {
  createDiscussionFolder,
  createDiscussionPoll,
  deleteDiscussionFolder,
  deleteDiscussionMessage,
  editDiscussionMessage,
  isDiscussionModerator,
  discussionPollActions,
  listDiscussionFiles,
  listDiscussionPolls,
  sendDiscussionFiles,
  DISCUSSION_FILE_LIMIT,
  DISCUSSION_FILES_PER_MESSAGE,
  listDiscussionFolders,
  listDiscussionMessages,
  listDiscussions,
  moveDiscussion,
  renameDiscussion,
  renameDiscussionFolder,
  saveDiscussionFile,
  sendDiscussionMessage,
  sendDiscussionVoice,
  startDiscussion,
  stopDiscussion,
  transcribeVoice,
  trashDiscussion,
  voiceUrls,
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
import { Linkify } from '../ui/Linkify'
import { DriveLinkCards } from '../ui/DriveLinkCards'
import { CreatePollDialog } from '../messages/CreatePollDialog'
import { PollCard } from '../messages/PollCard'
import type { Poll } from '../../lib/types'
import { VoiceMessage } from './VoiceMessage'
import { VoiceRecorder } from './VoiceRecorder'
import { DiscussionFiles } from './DiscussionFiles'
import { formatBytes } from '../../lib/formatBytes'
import type { GeneralDiscussionFile } from '../../lib/general/types'
import { canRecordVoice } from '../../lib/voice'

const NOTICE_KEY = 'collabify.discussion-notice-closed'

/** Whether this person closed the room's notice. Remembered in this browser only. */
function noticeClosed() {
  try {
    return localStorage.getItem(NOTICE_KEY) === 'true'
  } catch {
    return false
  }
}

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
  const [noticeOpen, setNoticeOpen] = useState(() => !noticeClosed())

  function toggleNotice(open: boolean) {
    setNoticeOpen(open)
    try {
      localStorage.setItem(NOTICE_KEY, String(!open))
    } catch {
      // Private window or blocked storage: it just shows again next time.
    }
  }

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
  // Opening the tab while a discussion runs puts you in its room; Leave room
  // steps out to the list, and the page's banner comes back.
  const [left, setLeft] = useState<string | null>(null)
  const inRoom = Boolean(live && left !== live.id)
  useFocusWhile(inRoom)
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

  const notice = noticeOpen ? (
    <Alert tone="info" onClose={() => toggleNotice(false)}>
      This room is for planning the project: tasks, plans and events. Everything said here is saved
      in the discussion file and can be turned into tasks, so off-topic talk ends up there too.
    </Alert>
  ) : (
    <button
      type="button"
      onClick={() => toggleNotice(true)}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
    >
      <Icon name="info" size={14} />
      What this room is for
    </button>
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

  if (live && inRoom) {
    return (
      <div className="space-y-4">
        {notice}
        <LiveRoom
          discussion={live}
          state={state}
          readOnly={readOnly}
          folderName={folders.find((f) => f.id === live.folder_id)?.name ?? null}
          onStopped={load}
          onLeave={() => setLeft(live.id)}
        />
      </div>
    )
  }

  const liveCard = live && (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line surface px-4 py-3">
      <p className="flex min-w-0 items-center gap-2 text-[14px] text-ink">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success-500" aria-hidden />
        <span className="truncate">
          <span className="font-semibold">{live.topic}</span>
          <span className="text-muted"> is running now</span>
        </span>
      </p>
      <Button size="sm" onClick={() => setLeft(null)}>
        Rejoin
      </Button>
    </div>
  )

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
      {liveCard}

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
  onLeave,
}: {
  discussion: GeneralDiscussion
  state: GeneralProjectState
  readOnly: boolean
  folderName: string | null
  onStopped: () => Promise<void>
  /** Steps out of the room to the list; the discussion keeps running. */
  onLeave: () => void
}) {
  const { show } = useToast()
  const [messages, setMessages] = useState<GeneralDiscussionMessage[] | null>(null)
  const [polls, setPolls] = useState(new Map<string, Poll>())
  const [urls, setUrls] = useState(new Map<string, string>())
  const [pollOpen, setPollOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [shared, setShared] = useState(new Map<string, GeneralDiscussionFile[]>())
  const [staged, setStaged] = useState<File[]>([])
  const pickRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  useAutoGrow(boxRef, body)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState<GeneralDiscussionMessage | null>(null)
  const [moderator, setModerator] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const signed = useRef(new Set<string>())
  const load = useCallback(async () => {
    try {
      const [rows, found, files] = await Promise.all([
        listDiscussionMessages(discussion.id),
        listDiscussionPolls(discussion.id),
        listDiscussionFiles(discussion.id),
      ])
      setMessages(rows)
      setPolls(found)
      setShared(files)
      // Each recording is signed once; the link lasts an hour, longer than a room stays open.
      const fresh = rows
        .map((m) => m.audio_path)
        .filter((p): p is string => Boolean(p) && !signed.current.has(p as string))
      if (fresh.length > 0) {
        fresh.forEach((p) => signed.current.add(p))
        const more = await voiceUrls(fresh).catch(() => new Map<string, string>())
        setUrls((prev) => new Map([...prev, ...more]))
      }
    } catch {
      setMessages((prev) => prev ?? [])
    }
  }, [discussion.id])

  useEffect(() => {
    void load()
  }, [load])

  // Owners, Managers and a class board's group leader may delete anyone's message.
  useEffect(() => {
    if (readOnly) return
    let live = true
    isDiscussionModerator(discussion.project_id)
      .then((yes) => {
        if (live) setModerator(Boolean(yes))
      })
      .catch(() => {
        if (live) setModerator(false)
      })
    return () => {
      live = false
    }
  }, [discussion.project_id, readOnly])

  async function saveEdit() {
    if (!editing || savingEdit) return
    const target = messages?.find((m) => m.id === editing.id)
    if (target?.kind === 'text' && !editing.body.trim()) {
      show('A message needs some words. Delete it instead.', 'error')
      return
    }
    setSavingEdit(true)
    try {
      await editDiscussionMessage(editing.id, editing.body)
      setEditing(null)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save that edit. Try again.'), 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  useLive(
    load,
    ['general_discussion_messages', 'general_discussion_polls', 'general_discussion_poll_options', 'general_discussion_poll_votes', 'general_discussion_files'],
    { every: 10_000 },
  )

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages?.length])

  const starterHere = state.members.some((m) => m.user_id === discussion.started_by)
  const lead = state.me?.level === 'owner' || state.me?.level === 'manager'
  const mayStop = !readOnly && (discussion.started_by === state.viewerId || (lead && !starterHere))

  function pick(list: FileList | null) {
    if (!list) return
    const next: File[] = []
    for (const file of Array.from(list)) {
      if (file.size > DISCUSSION_FILE_LIMIT) {
        show(`${file.name} is ${formatBytes(file.size)}. Files can be up to 25 MB; share a link to anything bigger.`, 'error')
        continue
      }
      next.push(file)
    }
    setStaged((prev) => {
      const all = [...prev, ...next]
      if (all.length > DISCUSSION_FILES_PER_MESSAGE) {
        show(`Send up to ${DISCUSSION_FILES_PER_MESSAGE} files at a time.`, 'error')
      }
      return all.slice(0, DISCUSSION_FILES_PER_MESSAGE)
    })
    if (pickRef.current) pickRef.current.value = ''
  }

  async function send() {
    const text = body.trim()
    if ((!text && staged.length === 0) || sending) return
    setSending(true)
    try {
      if (staged.length > 0) {
        await sendDiscussionFiles({ projectId: discussion.project_id, discussionId: discussion.id, body: text, files: staged })
        setStaged([])
      } else {
        await sendDiscussionMessage(discussion.id, text)
      }
      setBody('')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that. Try again.'), 'error')
    } finally {
      setSending(false)
    }
  }

  async function sendVoice(blob: Blob, ms: number) {
    try {
      const id = await sendDiscussionVoice({ projectId: discussion.project_id, discussionId: discussion.id, blob, ms })
      setRecording(false)
      await load()
      // Not awaited: the transcript arrives on its own and the room picks it up.
      void transcribeVoice(id).then(load)
    } catch (err) {
      show(authErrorMessage(err, 'Could not send the recording. Try again.'), 'error')
    }
  }

  return (
    <section
      aria-label="Live discussion"
      className="flex h-[max(460px,calc(100dvh-15rem))] flex-col overflow-hidden rounded-panel border border-line surface"
    >
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
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onLeave}>
            <Icon name="arrowLeft" size={14} />
            Leave room
          </Button>
          {mayStop ? (
            <Button size="sm" variant="outline" onClick={() => setStopping(true)}>
              <Icon name="check" size={14} />
              Stop discussion
            </Button>
          ) : (
            <p className="text-[12px] text-faint">Only whoever started it can stop it.</p>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
            const poll = m.kind === 'poll' ? polls.get(m.id) : undefined
            // A poll sits on a plain card whoever sent it, so its options read the same for everyone.
            const mine = m.sender_id === state.viewerId
            const navy = mine && m.kind !== 'poll'
            const isEditing = editing?.id === m.id
            const mayEdit = !readOnly && mine && (m.kind === 'text' || m.kind === 'file')
            const mayDelete = !readOnly && (mine || moderator)
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  // A poll or a player needs a width of its own to fill; on a phone
                  // that is nearly the whole row, on a wide screen at most 360px.
                  className={`flex min-w-0 items-start gap-1 ${mine ? 'flex-row-reverse' : ''} ${
                    m.kind === 'text' && !isEditing ? 'max-w-[80%]' : 'w-[min(92%,360px)]'
                  }`}
                >
                <div
                  className={`min-w-0 rounded-2xl px-3.5 py-2 text-[13px] ${
                    m.kind === 'text' && !isEditing ? '' : 'flex-1'
                  } ${
                    navy
                      ? 'bg-navy-600 text-white dark:bg-navy-500'
                      : m.kind === 'poll'
                        ? 'surface border border-line text-ink'
                        : 'surface-sunken text-ink'
                  }`}
                >
                  {!mine && (
                    <p className="mb-0.5 text-[11px] font-medium text-muted">
                      {m.sender_id ? state.nameOf(m.sender_id) : 'A former member'}
                    </p>
                  )}
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        rows={2}
                        maxLength={4000}
                        autoFocus
                        aria-label={m.kind === 'file' ? 'Caption' : 'Message'}
                        value={editing.body}
                        onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditing(null)
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void saveEdit()
                          }
                        }}
                        className="!bg-[var(--surface)] !text-ink"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={navy ? '!text-white hover:!bg-white/10' : ''}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                        <Button size="sm" loading={savingEdit} onClick={() => void saveEdit()}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : m.kind === 'poll' ? (
                    poll ? (
                      <PollCard
                        poll={poll}
                        viewerId={state.viewerId ?? ''}
                        canManage={!readOnly && lead}
                        onChanged={load}
                        actions={discussionPollActions}
                        notAllowed="Only whoever made this poll, or an Owner or Manager, can do that."
                      />
                    ) : (
                      <p className="font-medium">{m.body}</p>
                    )
                  ) : m.kind === 'file' ? (
                    <>
                      {m.body.trim() && (
                        <p className="mb-2 whitespace-pre-wrap break-words"><Linkify text={m.body} tone="inherit" /></p>
                      )}
                      <DiscussionFiles files={shared.get(m.id) ?? []} mine={navy} />
                    </>
                  ) : m.kind === 'voice' ? (
                    <VoiceMessage
                      m={m}
                      url={m.audio_path ? urls.get(m.audio_path) : undefined}
                      mine={navy}
                      canEdit={!readOnly && mine}
                      onChanged={load}
                    />
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} tone="inherit" /></p>
                      <DriveLinkCards text={m.body} tone="inherit" className="mt-2" />
                    </>
                  )}
                  <p className={`mt-0.5 text-right text-[10.5px] ${navy ? 'text-white/70' : 'text-faint'}`}>
                    {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {m.edited_at && ' · edited'}
                  </p>
                </div>
                {!isEditing && (mayEdit || mayDelete) && (
                  <ActionMenu
                    label="Message actions"
                    size="sm"
                    align={mine ? 'end' : 'start'}
                    items={[
                      mayEdit && {
                        label: m.kind === 'file' ? 'Edit caption' : 'Edit',
                        icon: 'edit',
                        onSelect: () => setEditing({ id: m.id, body: m.body }),
                      },
                      mayDelete && {
                        label: 'Delete',
                        icon: 'trash',
                        tone: 'danger',
                        separated: mayEdit,
                        onSelect: () => setDeleting(m),
                      },
                    ]}
                  />
                )}
                </div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      {!readOnly && recording && (
        <div className="border-t border-line px-4 py-3">
          <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} />
        </div>
      )}

      {!readOnly && !recording && staged.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-line px-4 pt-3" aria-label="Files to send">
          {staged.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-lg surface-sunken py-1.5 pr-1.5 pl-2.5">
              <Icon name="file" size={14} className="text-muted" />
              <span className="max-w-[180px] truncate text-[12px] text-ink">{file.name}</span>
              <span className="text-[11px] text-faint">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => setStaged((list) => list.filter((_, n) => n !== i))}
                aria-label={`Remove ${file.name}`}
                className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-ink"
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && !recording && (
        <div className={`flex items-end gap-2 px-4 py-3 ${staged.length > 0 ? '' : 'border-t border-line'}`}>
          <input ref={pickRef} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
          {/* A phone gets one clip button for these three; wider screens show them side by side. */}
          <div className="sm:hidden">
            <ActionMenu
              label="Attach"
              icon="clip"
              align="start"
              triggerClassName="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
              items={[
                { label: 'Attach files', icon: 'upload', onSelect: () => pickRef.current?.click() },
                { label: 'Create a poll', icon: 'chart', onSelect: () => setPollOpen(true) },
                canRecordVoice() && { label: 'Voice message', icon: 'mic', onSelect: () => setRecording(true) },
              ]}
            />
          </div>
          <div className="hidden shrink-0 items-end gap-1 sm:flex">
            <button
              type="button"
              onClick={() => pickRef.current?.click()}
              aria-label="Attach files"
              title="Attach files (up to 25 MB each)"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              <Icon name="upload" size={18} />
            </button>
            <button
              type="button"
              onClick={() => setPollOpen(true)}
              aria-label="Create a poll"
              title="Create a poll"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              <Icon name="chart" size={18} />
            </button>
            {canRecordVoice() && (
              <button
                type="button"
                onClick={() => setRecording(true)}
                aria-label="Record a voice message"
                title="Record a voice message (up to 5 minutes)"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
              >
                <Icon name="mic" size={18} />
              </button>
            )}
          </div>
          <textarea
            ref={boxRef}
            rows={1}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Plans, tasks, dates… Enter sends"
            aria-label="Message"
            className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-[var(--control-line)] bg-[var(--surface)] px-3.5 py-2 text-[14px] leading-6 text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12"
          />
          <Button loading={sending} disabled={!body.trim() && staged.length === 0} onClick={() => void send()}>
            Send
          </Button>
        </div>
      )}

      <CreatePollDialog
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        conversationId={discussion.id}
        where="this discussion"
        create={(input) => createDiscussionPoll({ discussionId: discussion.id, ...input })}
        onCreated={load}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          const id = deleting.id
          await deleteDiscussionMessage(id)
          setMessages((prev) => prev?.filter((x) => x.id !== id) ?? prev)
          await load()
        }}
        title="Delete this message?"
        body={
          deleting?.kind === 'poll'
            ? 'It is removed for everyone, with its votes, and is left out of the discussion file.'
            : deleting?.kind === 'file'
              ? 'It is removed for everyone, with the files it shared, and is left out of the discussion file.'
              : 'It is removed for everyone and is left out of the discussion file.'
        }
        confirmLabel="Delete"
        tone="danger"
      />

      <ConfirmDialog
        open={stopping}
        onClose={() => setStopping(false)}
        onConfirm={async () => {
          await stopDiscussion(discussion.id)
          show('Discussion stopped and saved as a file')
          await onStopped()
        }}
        title="Stop this discussion?"
        body="The whole conversation is saved as a discussion file everyone in the group can edit and download, with each poll's results and each voice message's transcript. Polls close, and nobody can send more messages to it."
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
