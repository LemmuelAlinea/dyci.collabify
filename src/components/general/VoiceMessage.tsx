import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { Linkify } from '../ui/Linkify'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { editDiscussionTranscript, transcribeVoice } from '../../lib/api/discussions'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralDiscussionMessage } from '../../lib/general/types'
import { clock } from '../../lib/voice'

/** A run still 'pending' this long after sending was never started; offer to start it. */
const NEVER_STARTED_MS = 20_000

/**
 * A voice message in a discussion: the recording, then what it says. The
 * sender may correct the transcript while the discussion is live; that text
 * is what goes into the discussion file.
 */
export function VoiceMessage({
  m,
  url,
  mine,
  canEdit,
  onChanged,
}: {
  m: GeneralDiscussionMessage
  url: string | undefined
  mine: boolean
  canEdit: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [busy, setBusy] = useState(false)
  // Still pending after this long means the sender's tab never started it.
  const [late, setLate] = useState(false)

  useEffect(() => {
    if (m.transcript_status !== 'pending') return
    const left = NEVER_STARTED_MS - (Date.now() - new Date(m.created_at).getTime())
    const timer = window.setTimeout(() => setLate(true), Math.max(0, left))
    return () => window.clearTimeout(timer)
  }, [m.transcript_status, m.created_at])

  const status = m.transcript_status
  const quiet = mine ? 'text-white/70' : 'text-muted'
  const waiting = status === 'working' || (status === 'pending' && !late)

  async function retry() {
    setBusy(true)
    const out = await transcribeVoice(m.id)
    if (out.result !== 'ok') show(out.message ?? 'The recording could not be transcribed. Try again.', 'error')
    await onChanged()
    setBusy(false)
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      <p className={`flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase ${quiet}`}>
        <Icon name="mic" size={11} />
        Voice message · <span className="font-mono normal-case">{clock(m.audio_ms ?? 0)}</span>
      </p>

      {url ? (
        <audio controls preload="metadata" src={url} className="block h-9 w-full min-w-0" aria-label="Play voice message" />
      ) : (
        <p className={`flex items-center gap-2 text-[12px] ${quiet}`}>
          <Spinner size={12} />
          Loading the recording…
        </p>
      )}

      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={4}
            maxLength={8000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="!bg-[var(--surface)] !text-ink"
            aria-label="Transcript"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}
              className={mine ? '!text-white/80 hover:!bg-white/10' : ''}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              className="!rounded-lg"
              onClick={async () => {
                setBusy(true)
                try {
                  await editDiscussionTranscript(m.id, draft)
                  setEditing(false)
                  await onChanged()
                } catch (err) {
                  show(authErrorMessage(err, 'Could not save the transcript. Try again.'), 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : status === 'done' ? (
        <div>
          {m.body.trim() ? (
            <p className="whitespace-pre-wrap break-words">
              <Linkify text={m.body} tone="inherit" />
            </p>
          ) : (
            <p className={`text-[12px] italic ${quiet}`}>No speech was heard in this recording.</p>
          )}
          <p className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] ${quiet}`}>
            {m.transcript_edited_at ? 'Transcript corrected by the sender' : 'Transcribed automatically'}
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(m.body)
                  setEditing(true)
                }}
                className="font-medium underline underline-offset-2 hover:opacity-80"
              >
                Edit transcript
              </button>
            )}
          </p>
        </div>
      ) : waiting ? (
        <p className={`flex items-center gap-2 text-[12px] ${quiet}`}>
          <Spinner size={12} />
          Writing the transcript…
        </p>
      ) : (
        <p className={`flex flex-wrap items-center gap-x-2 text-[12px] ${quiet}`}>
          {status === 'failed' ? 'This recording could not be transcribed.' : 'Not transcribed yet.'}
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className="font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          >
            {busy ? 'Transcribing…' : 'Transcribe'}
          </button>
        </p>
      )}
    </div>
  )
}
