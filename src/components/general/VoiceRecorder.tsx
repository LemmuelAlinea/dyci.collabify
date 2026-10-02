import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { VOICE_MAX_MS } from '../../lib/api/discussions'
import { clock } from '../../lib/voice'

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']

type Phase = 'asking' | 'recording' | 'ready' | 'error'

/**
 * Records one voice message, up to five minutes, then lets the sender play it
 * back before sending. Starts listening as soon as it mounts; the mic is
 * released when it stops or goes away.
 */
export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (blob: Blob, ms: number) => Promise<void>
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<Phase>('asking')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<{ blob: Blob; ms: number; url: string } | null>(null)
  const [sending, setSending] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const chunks: Blob[] = []

    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = media
        const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
        const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 })
        recorder.current = rec
        rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
        rec.onstop = () => {
          window.clearInterval(timer)
          media.getTracks().forEach((t) => t.stop())
          if (cancelled) return
          const ms = Math.min(performance.now() - startedAt.current, VOICE_MAX_MS)
          const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })
          setTake({ blob, ms, url: URL.createObjectURL(blob) })
          setPhase('ready')
        }
        startedAt.current = performance.now()
        rec.start(1000)
        setPhase('recording')
        timer = window.setInterval(() => {
          const ms = performance.now() - startedAt.current
          setElapsed(ms)
          if (ms >= VOICE_MAX_MS && rec.state === 'recording') rec.stop()
        }, 250)
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string }).name
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Collabify cannot use your microphone. Allow it in your browser’s site settings, then try again.'
            : name === 'NotFoundError'
              ? 'No microphone was found. Plug one in, then try again.'
              : 'The microphone could not start. Try again.',
        )
        setPhase('error')
      }
    })()

    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url)
  }, [take])

  if (phase === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line surface-sunken px-3 py-2.5">
        <Icon name="alert" size={16} className="shrink-0 text-danger-600 dark:text-danger-400" />
        <p className="min-w-[180px] flex-1 text-[13px] text-ink">{error}</p>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    )
  }

  if (phase === 'ready' && take) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line surface-sunken px-3 py-2">
        <audio controls src={take.url} className="h-9 min-w-[200px] flex-1" aria-label="Your recording" />
        <span className="font-mono text-[12px] text-muted">{clock(take.ms)}</span>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={sending}>
          Discard
        </Button>
        <Button
          size="sm"
          loading={sending}
          onClick={async () => {
            setSending(true)
            try {
              await onSend(take.blob, take.ms)
            } finally {
              setSending(false)
            }
          }}
        >
          Send
        </Button>
      </div>
    )
  }

  const left = VOICE_MAX_MS - elapsed
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line surface-sunken px-3 py-2">
      <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-danger-500 motion-safe:animate-ping opacity-60" />
        <span className="relative h-3 w-3 rounded-full bg-danger-500" />
      </span>
      <p className="min-w-[140px] flex-1 text-[13px] text-ink" aria-live="polite">
        {phase === 'asking' ? (
          'Waiting for the microphone…'
        ) : (
          <>
            Recording <span className="font-mono">{clock(elapsed)}</span>
            {left < 30_000 && <span className="text-muted"> · {clock(left)} left</span>}
          </>
        )}
      </p>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        disabled={phase !== 'recording'}
        onClick={() => recorder.current?.state === 'recording' && recorder.current.stop()}
      >
        <Icon name="check" size={14} />
        Done
      </Button>
    </div>
  )
}
