import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { useNow } from '../../hooks/useNow'
import { callAction } from '../../lib/api/meetingCall'
import { listMeetingRecordings } from '../../lib/api/meetings'
import type { MeetingRecording } from '../../lib/api/meetings'
import { Button } from '../ui/Button'

export function CallRecording({ meetingId, canHost, inCall = false }: {
  meetingId: string
  canHost: boolean
  inCall?: boolean
}) {
  const [rows, setRows] = useState<MeetingRecording[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const now = useNow()
  const video = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(0)
  const resumePlay = useRef(false)
  const playbackFailures = useRef(0)
  const load = useCallback(async () => {
    try { setRows(await listMeetingRecordings(meetingId)); setError('') }
    catch { setRows([]); setError('Could not load recordings.') }
  }, [meetingId])
  useEffect(() => { void load() }, [load])
  useLive(load, [], { every: inCall ? 5000 : 30000 })

  const active = rows.find((row) => row.status === 'starting' || row.status === 'recording')
  const visibleRows = rows.filter((row) => !row.expires_at || Date.parse(row.expires_at) > now)

  async function change() {
    if (!canHost || busy) return
    const stopping = active?.status === 'recording'
    const message = stopping
      ? 'Stop recording this call? The video will be available to its current audience for 30 days.'
      : 'Start recording? Everyone in this call will see a recording notice. The video will be available to its current audience for 30 days.'
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      await callAction(stopping ? 'record_stop' : 'record_start', meetingId)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not change the recording.') }
    finally { setBusy(false) }
  }

  const renew = useCallback(async (id: string) => {
    if (video.current) {
      resumeAt.current = video.current.currentTime
      resumePlay.current = !video.current.paused
    }
    try {
      const result = await callAction('record_url', meetingId, undefined, id)
      if (!('url' in result)) throw new Error('Could not open this recording.')
      setUrl(result.url)
      setError('')
    } catch (err) {
      setPlaying(null)
      setUrl('')
      setError(err instanceof Error ? err.message : 'Could not open this recording.')
    }
  }, [meetingId])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => void renew(playing), 45_000)
    return () => window.clearInterval(timer)
  }, [playing, renew])

  if (inCall) return <div className="flex flex-wrap items-center gap-2 text-sm">
    {active ? <span role="status" className="rounded-full bg-danger-500/15 px-3 py-1 font-medium text-danger-700 dark:text-danger-300">
      {active.status === 'starting' ? 'Starting recording…' : 'Recording in progress'}
    </span> : rows.some((row) => row.status === 'processing') ? <span role="status" className="text-muted">Recording is processing.</span> : null}
    {canHost && <Button size="sm" variant="outline" onClick={() => void change()} loading={busy} disabled={active?.status === 'starting'}>
      {active ? 'Stop recording' : 'Start recording'}
    </Button>}
    {active?.status === 'recording' && <span className="text-xs text-muted">A recording segment stops after three hours.</span>}
    {error && <span role="alert" className="text-danger-600">{error}</span>}
  </div>

  return <section aria-label="Meeting recordings" className="space-y-3 border-t border-line pt-4">
    <h2 className="font-semibold text-ink">Recordings</h2>
    {!visibleRows.length && <p className="text-sm text-muted">No recordings for this meeting.</p>}
    {visibleRows.map((row) => <div key={row.id} className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium text-ink">{new Date(row.started_at).toLocaleString()}</p>
          <p className="text-xs text-muted">{row.status === 'ready' && row.expires_at
            ? `Available until ${new Date(row.expires_at).toLocaleDateString()}`
            : row.status === 'failed' ? 'Recording failed.' : 'Recording is processing.'}</p></div>
        {row.status === 'ready' && row.expires_at && Date.parse(row.expires_at) > now &&
          <Button size="sm" variant="outline" onClick={() => {
            if (playing === row.id) { setPlaying(null); setUrl('') }
            else { resumeAt.current = 0; resumePlay.current = false; playbackFailures.current = 0; setPlaying(row.id); void renew(row.id) }
          }}>{playing === row.id ? 'Close video' : 'Play video'}</Button>}
      </div>
      {playing === row.id && url && <video ref={video} controls className="mt-3 aspect-video w-full rounded-lg bg-black"
        src={url} onLoadedMetadata={() => {
          if (!video.current) return
          video.current.currentTime = resumeAt.current
          playbackFailures.current = 0
          if (resumePlay.current) void video.current.play().catch(() => undefined)
        }} onError={() => {
          if (playbackFailures.current++) {
            setPlaying(null)
            setError('Could not play this recording.')
          }
          else void renew(row.id)
        }} />}
    </div>)}
    {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}
  </section>
}
