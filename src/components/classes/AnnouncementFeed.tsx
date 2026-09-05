import { useState } from 'react'
import type { FormEvent } from 'react'
import { Avatar } from '../app/Avatar'
import { NOTICE_HOURS } from '../../lib/program'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert, Field, Input } from '../ui/Field'
import { FileDrop, formatBytes } from '../ui/FileDrop'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import {
  attachmentUrl,
  createAnnouncement,
  deleteAnnouncement,
  setPinned,
  updateAnnouncement,
} from '../../lib/api/announcements'
import { authErrorMessage } from '../../lib/authError'
import type { Announcement } from '../../lib/types'

function when(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function AttachmentRow({ attachment }: { attachment: Announcement['attachments'][number] }) {
  const { show } = useToast()
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          window.open(await attachmentUrl(attachment), '_blank', 'noopener')
        } catch (err) {
          show(authErrorMessage(err, 'Could not open that file.'), 'error')
        }
      }}
      className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
    >
      <Icon name="file" size={17} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{attachment.file_name}</span>
      <span className="shrink-0 text-[11.5px] text-faint">{formatBytes(attachment.size_bytes)}</span>
    </button>
  )
}

/**
 * Whether this announcement is still on the students' screens.
 *
 * The rule is the policy's — a student simply cannot read one older than the
 * window. This is only so the professor's own feed, which keeps everything, can
 * show which of their announcements the class can still see.
 */
const isLive = (iso: string) =>
  Date.now() - new Date(iso).getTime() < NOTICE_HOURS * 60 * 60 * 1000

export function AnnouncementFeed({
  classId,
  authorId,
  announcements,
  canManage,
  onChanged,
}: {
  classId: string
  authorId: string
  announcements: Announcement[]
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [staged, setStaged] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setBody('')
    setFiles([])
    setStaged(null)
    setError(null)
  }

  function openComposer() {
    reset()
    setEditing(null)
    setComposerOpen(true)
  }

  function openEditor(a: Announcement) {
    reset()
    setTitle(a.title)
    setBody(a.body)
    setEditing(a)
    setComposerOpen(true)
  }

  function stageFile(file: File | null) {
    if (!file) return setStaged(null)
    setFiles((f) => [...f, file])
    setStaged(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (editing) {
        await updateAnnouncement(editing.id, { title, body })
        show('Announcement updated')
      } else {
        await createAnnouncement({ classId, authorId, title, body, files })
        show('Announcement posted')
      }
      setComposerOpen(false)
      reset()
      await onChanged()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that announcement.'))
    } finally {
      setBusy(false)
    }
  }

  async function togglePin(a: Announcement) {
    try {
      await setPinned(classId, a.id, !a.pinned)
      show(a.pinned ? 'Unpinned' : 'Pinned to the top for its day')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the pin.'), 'error')
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* Only the professor is told this. A student never sees an
              announcement that has gone, so there is nothing to explain. */}
          <p className="max-w-[62ch] text-[12.5px] text-muted">
            An announcement is on your students' screens for {NOTICE_HOURS} hours and then
            comes off on its own. You keep all of them here. To say something again, post it
            again.
          </p>
          <Button onClick={openComposer} className="!rounded-xl">
            <Icon name="plus" size={17} />
            New announcement
          </Button>
        </div>
      )}

      {announcements.length === 0 ? (
        <EmptyState
          icon="message"
          art="announcements"
          title="No announcements yet"
          body={
            canManage
              ? 'Post one and everyone in the class gets a notification. It stays on their screens for a day.'
              : 'When your professor posts something, it shows up here.'
          }
          action={
            canManage ? (
              <Button onClick={openComposer} className="!rounded-xl">
                Write the first one
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li
              key={a.id}
              className={`surface rounded-card border p-4 shadow-card sm:p-5 md:p-6 ${
                a.pinned && isLive(a.created_at)
                  ? 'border-amber-300 dark:border-amber-400/50'
                  : 'border-line'
              } ${canManage && !isLive(a.created_at) ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="mb-2 flex flex-wrap items-center gap-1.5">
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/18 px-2.5 py-1 font-mono text-[9.5px] tracking-wider text-amber-700 uppercase dark:text-amber-300">
                        <Icon name="target" size={11} />
                        Pinned
                      </span>
                    )}
                    {/* Only the professor ever sees this — a student cannot
                        read an announcement that has gone. */}
                    {canManage && !isLive(a.created_at) && (
                      <span className="inline-flex items-center gap-1.5 rounded-full surface-sunken px-2.5 py-1 font-mono text-[9.5px] tracking-wider text-faint uppercase">
                        <Icon name="clock" size={11} />
                        Off the class feed
                      </span>
                    )}
                  </span>
                  <h3 className="text-[18px] leading-snug">{a.title}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-faint">
                    {a.author && (
                      <span className="flex items-center gap-1.5">
                        <Avatar
                          profile={{
                            first_name: a.author.first_name,
                            last_name: a.author.last_name,
                            avatar_url: a.author.avatar_url,
                          }}
                          size={18}
                        />
                        {a.author.first_name} {a.author.last_name}
                      </span>
                    )}
                    <span>·</span>
                    <span>{when(a.created_at)}</span>
                    {a.edited_at && <span className="italic">· edited</span>}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => togglePin(a)}
                      aria-label={a.pinned ? 'Unpin announcement' : 'Pin announcement'}
                      title={a.pinned ? 'Unpin' : 'Pin to the top for its day'}
                      className={`grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-[var(--surface-sunken)] ${
                        a.pinned ? 'text-amber-500 dark:text-amber-300' : 'text-muted hover:text-ink'
                      }`}
                    >
                      <Icon name="target" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditor(a)}
                      aria-label="Edit announcement"
                      className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(a)}
                      aria-label="Delete announcement"
                      className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-3 text-[14.5px] leading-relaxed whitespace-pre-wrap text-muted">
                {a.body}
              </p>

              {a.attachments.length > 0 && (
                <div className="mt-4 space-y-2">
                  {a.attachments.map((att) => (
                    <AttachmentRow key={att.id} attachment={att} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title={editing ? 'Edit announcement' : 'New announcement'}
        description={
          editing
            ? 'Students see an "edited" marker after you save.'
            : 'Everyone in the class gets a notification.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposerOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="announcement-form" type="submit" loading={busy} className="!rounded-xl">
              {editing ? 'Save changes' : 'Post announcement'}
            </Button>
          </>
        }
      >
        <form id="announcement-form" onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Final defense schedule"
              />
            )}
          </Field>
          <Field label="Message">
            {(id) => (
              <Textarea
                id={id}
                required
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What your students need to know, and by when."
              />
            )}
          </Field>

          {!editing && (
            <Field label="Attachments" optional>
              {() => (
                <div className="space-y-2">
                  {files.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-3 rounded-xl border border-line surface-sunken px-4 py-2.5"
                    >
                      <Icon name="file" size={17} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{f.name}</span>
                      <span className="text-[11.5px] text-faint">{formatBytes(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((list) => list.filter((_, n) => n !== i))}
                        aria-label={`Remove ${f.name}`}
                        className="grid h-7 w-7 place-items-center rounded-full text-faint hover:text-ink"
                      >
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  ))}
                  <FileDrop file={staged} onPick={stageFile} maxSize={10} hint="Up to 10 MB each" />
                </div>
              )}
            </Field>
          )}

          {editing && editing.attachments.length > 0 && (
            <p className="text-[12.5px] text-faint">
              Attachments cannot be changed while editing. Delete the announcement and post
              again to swap them.
            </p>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteAnnouncement(pendingDelete)
          show('Announcement deleted')
          await onChanged()
        }}
        title="Delete this announcement?"
        body={
          <>
            <strong className="text-ink">{pendingDelete?.title}</strong> and any files attached
            to it are removed for everyone. Notifications already sent stay in students'
            inboxes.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  )
}
