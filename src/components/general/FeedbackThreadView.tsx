import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { getFeedbackThread, replyFeedback, setFeedbackStatus } from '../../lib/api/feedback'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  canPostFeedback,
  canSetFeedbackStatus,
  feedbackAuthor,
} from '../../lib/general/feedback'
import type { FeedbackStatus, FeedbackThread } from '../../lib/general/feedback'
import { AttachPicker, FeedbackFiles, StatusChip } from './FeedbackParts'
import { PersonBadge } from './RoleBadge'
import type { GeneralProjectState } from './useGeneralProject'

function Byline({
  authorId,
  at,
  state,
}: {
  authorId: string | null
  at: string
  state: GeneralProjectState
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      <span className="font-medium text-ink">{feedbackAuthor(authorId, state.nameOf)}</span>
      {authorId && <PersonBadge userId={authorId} roles={state} />}
      <span className="text-faint">{formatDue(at)}</span>
    </p>
  )
}

/** One post: its words and files, its replies, a reply box, and the status select for those who set it. */
export function FeedbackThreadView({
  state,
  feedbackId,
  refreshKey,
  onChanged,
  onBack,
}: {
  state: GeneralProjectState
  feedbackId: string
  /** Bumps when something under Feedback changed elsewhere. */
  refreshKey: number
  /** A post, reply or status changed here; the list needs to follow. */
  onChanged: () => void
  onBack: () => void
}) {
  const { show } = useToast()
  const [thread, setThread] = useState<FeedbackThread | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [setting, setSetting] = useState(false)

  // The parent keys this by post, so a different post starts clean.
  useEffect(() => {
    let live = true
    getFeedbackThread(feedbackId)
      .then((t) => {
        if (!live) return
        setThread(t)
        setError(null)
        setLoaded(true)
      })
      .catch((err) => {
        if (!live) return
        setError(authErrorMessage(err, 'Could not load this feedback.'))
        setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [feedbackId, refreshKey])

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink lg:hidden"
    >
      <Icon name="arrowLeft" size={14} />
      All feedback
    </button>
  )

  if (!loaded) {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
          <Spinner size={16} />
          Loading the feedback…
        </div>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="space-y-4">
        {back}
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <Alert tone="info">That feedback is gone. Pick another post from the list.</Alert>
        )}
      </div>
    )
  }

  const { post, replies } = thread
  const mayPost = canPostFeedback(state.myRole) && !state.archived
  const maySet = canSetFeedbackStatus(state.myRole) && !state.archived
  const postFiles = thread.files.filter((f) => !f.reply_id)

  async function changeStatus(next: FeedbackStatus) {
    if (next === post.status) return
    setSetting(true)
    try {
      await setFeedbackStatus(post.id, next)
      onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the status. Try again.'), 'error')
    } finally {
      setSetting(false)
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await replyFeedback(post.project_id, post.id, reply, files)
      setReply('')
      setFiles([])
      onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send your reply. Try again.'), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      {back}
      <article className="rounded-card border border-line surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">{FEEDBACK_KIND_LABEL[post.kind]}</span>
          <StatusChip status={post.status} />
        </div>
        <h2 className="mt-2 break-words">{post.title}</h2>
        <div className="mt-2">
          <Byline authorId={post.author_id} at={post.created_at} state={state} />
        </div>
        <p className="mt-4 text-[14px] leading-relaxed whitespace-pre-wrap break-words text-ink">{post.body}</p>
        <FeedbackFiles files={postFiles} />
        {maySet && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <label htmlFor="feedback-status" className="text-[13px] font-medium text-ink">
              Status
            </label>
            <div className="w-[190px]">
              <Select
                id="feedback-status"
                value={post.status}
                disabled={setting}
                onChange={(e) => void changeStatus(e.target.value as FeedbackStatus)}
                options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS_LABEL[s] }))}
              />
            </div>
          </div>
        )}
      </article>

      <section aria-label="Replies" className="space-y-3">
        <h3 className="eyebrow">{replies.length === 1 ? '1 reply' : `${replies.length} replies`}</h3>
        {replies.length === 0 && <p className="text-[14px] text-muted">No replies yet.</p>}
        {replies.map((r) => (
          <div key={r.id} className="rounded-card border border-line surface-sunken p-4">
            <Byline authorId={r.author_id} at={r.created_at} state={state} />
            <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-wrap break-words text-ink">{r.body}</p>
            <FeedbackFiles files={thread.files.filter((f) => f.reply_id === r.id)} />
          </div>
        ))}
      </section>

      {mayPost && (
        <form onSubmit={(e) => void send(e)} className="space-y-3">
          <Textarea
            aria-label="Reply"
            rows={3}
            placeholder="Write a reply"
            maxLength={4000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <AttachPicker files={files} onChange={setFiles} disabled={sending} />
          <div className="flex justify-end">
            <Button type="submit" loading={sending} disabled={!reply.trim()}>
              Send reply
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
