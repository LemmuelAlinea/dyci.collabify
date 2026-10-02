import { useState } from 'react'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Icon } from '../../ui/Icon'
import { Textarea } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { addComment, deleteComment, editComment } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { fullName } from '../../../lib/types'
import type { TeachingViewRole, TaskComment } from '../../../lib/types'
import { LIMIT } from '../../../lib/limits'
import { Linkify } from '../../ui/Linkify'

function ago(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CommentList({
  taskId,
  comments,
  viewerId, role,
  canPost,
  onChanged,
}: {
  taskId: string
  comments: TaskComment[]
  viewerId: string | undefined
  role: TeachingViewRole
  /** A professor reads the thread but does not join it. */
  canPost: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<TaskComment | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deleting, setDeleting] = useState<TaskComment | null>(null)

  async function post() {
    if (!draft.trim() || !viewerId) return
    setBusy(true)
    try {
      await addComment(taskId, draft, viewerId)
      setDraft('')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not post that.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Laid out as the work task dialog lays its comments out: a tinted bubble
  // each, the name and time on one line, and a short form underneath.
  return (
    <div>
      <ul className="mt-2 space-y-2">
        {comments.map((c) => {
          const mine = c.author_id === viewerId
          const isEditing = editing?.id === c.id
          return (
            <li key={c.id} className="rounded-xl surface-sunken px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] font-medium text-ink">
                  {c.author ? fullName(c.author) : 'Somebody'}
                  <span className="ml-2 font-normal text-faint">
                    {ago(c.created_at)}
                    {c.edited_at && ' · edited'}
                  </span>
                </p>
                {!isEditing && (mine || role === 'professor') && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    {mine && (
                      <button
                        type="button"
                        aria-label="Edit comment"
                        onClick={() => {
                          setEditing(c)
                          setEditDraft(c.body)
                        }}
                        className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-ink"
                      >
                        <Icon name="edit" size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Remove comment"
                      onClick={() => setDeleting(c)}
                      className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-destructive-600 dark:hover:text-destructive-400"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                )}
              </div>

              {isEditing ? (
                <div className="mt-1.5 space-y-2">
                  <Textarea
                    rows={2}
                    maxLength={LIMIT.commentBody}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    aria-label="Edit comment"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={!editDraft.trim()}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await editComment(c.id, editDraft)
                          setEditing(null)
                          await onChanged()
                        } catch (err) {
                          show(authErrorMessage(err, 'Could not save that.'), 'error')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-ink">
                  <Linkify text={c.body} />
                </p>
              )}
            </li>
          )
        })}
        {comments.length === 0 && <li className="text-[13px] text-faint">No comments yet.</li>}
      </ul>

      {canPost ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void post()
          }}
        >
          <Textarea
            rows={2}
            maxLength={LIMIT.commentBody}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment"
            aria-label="Write a comment"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={busy} disabled={!draft.trim()}>
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-[12px] text-faint">
          {role === 'professor'
            ? 'You can read the thread and remove anything that does not belong.'
            : 'Only this group can comment here.'}
        </p>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteComment(deleting.id)
          show('Comment deleted')
          await onChanged()
        }}
        title="Delete this comment?"
        body="It disappears from the thread for everyone. This cannot be undone."
        confirmLabel="Delete comment"
      />
    </div>
  )
}
