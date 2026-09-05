import { useState } from 'react'
import { Avatar } from '../../app/Avatar'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Icon } from '../../ui/Icon'
import { Textarea } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { addComment, deleteComment, editComment } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { fullName } from '../../../lib/types'
import type { Role, TaskComment } from '../../../lib/types'

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
  viewerId,
  role,
  canPost,
  onChanged,
}: {
  taskId: string
  comments: TaskComment[]
  viewerId: string | undefined
  role: Role
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

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-[13px] text-muted">
          Nothing said yet. Ask the question here rather than in a chat nobody can find later.
        </p>
      ) : (
        <ul className="space-y-3.5">
          {comments.map((c) => {
            const mine = c.author_id === viewerId
            const isEditing = editing?.id === c.id
            return (
              <li key={c.id} className="flex gap-2.5">
                {c.author ? (
                  <Avatar profile={c.author} size={30} />
                ) : (
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full surface-sunken text-faint">
                    <Icon name="user" size={15} />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium text-ink">
                      {c.author ? fullName(c.author) : 'Somebody'}
                    </span>
                    <span className="font-mono text-[12px] text-faint">
                      {ago(c.created_at)}
                      {c.edited_at && ' · edited'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-1.5 space-y-2">
                      <Textarea
                        rows={3}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        aria-label="Edit comment"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="!rounded-lg"
                          loading={busy}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
                      {c.body}
                    </p>
                  )}

                  {!isEditing && (mine || role === 'professor') && (
                    <div className="mt-1 flex items-center gap-3">
                      {mine && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(c)
                            setEditDraft(c.body)
                          }}
                          className="text-[12px] text-faint transition-colors hover:text-ink"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleting(c)}
                        className="text-[12px] text-faint transition-colors hover:text-red-600 dark:hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canPost ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask something, or say what you changed."
            aria-label="Write a comment"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="!rounded-lg"
              loading={busy}
              disabled={!draft.trim()}
              onClick={post}
            >
              <Icon name="message" size={15} />
              Comment
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-faint">
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
