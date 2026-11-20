import { useEffect, useMemo, useState } from 'react'
import { RoomAudioRenderer, VideoTrack, useIsMuted, useIsSpeaking, useParticipantAttribute, useParticipantTracks, useSpeakingParticipants, useTracks } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core'
import { Track } from 'livekit-client'
import { Icon } from '../ui/Icon'

const trackKey = (track: TrackReferenceOrPlaceholder) => `${track.participant.identity}:${track.source}`

function CallTile({ track, pinned, maximized, onPin, onMaximize }: {
  track: TrackReferenceOrPlaceholder
  pinned: boolean
  maximized: boolean
  onPin: () => void
  onMaximize: () => void
}) {
  const handRaised = useParticipantAttribute('collabify.hand', { participant: track.participant }) === '1'
  const mirrored = useParticipantAttribute('collabify.mirror', { participant: track.participant }) === '1'
  const isSpeaking = useIsSpeaking(track.participant)
  const microphone = useParticipantTracks([Track.Source.Microphone], track.participant.identity)[0]
  const isMuted = useIsMuted(microphone ?? { participant: track.participant, source: Track.Source.Microphone })
  const microphoneOn = !!microphone && !isMuted
  const name = track.participant.name || 'Member'
  return <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border-2 bg-slate-800 text-white ${isSpeaking ? 'border-success-500' : 'border-transparent'}`}>
    {track.publication?.track ? <VideoTrack trackRef={track as typeof track & { publication: NonNullable<typeof track.publication> }}
      className={`h-full w-full object-contain ${mirrored && track.source === Track.Source.Camera ? 'scale-x-[-1]' : ''}`} manageSubscription={false} /> : <span className="text-3xl font-semibold">{track.participant.name?.charAt(0) || '?'}</span>}
    {handRaised && <span aria-label="Hand raised" className="absolute left-2 top-2 rounded-full bg-black/60 p-1 text-lg">✋</span>}
    <div className="absolute right-2 top-2 flex gap-1">
      <button type="button" onClick={onPin} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${name}`} title={`${pinned ? 'Unpin' : 'Pin'} ${name}`}
        aria-pressed={pinned} className="grid h-8 w-8 place-items-center rounded-lg surface text-ink"><Icon name="pin" size={17} /></button>
      <button type="button" onClick={onMaximize} aria-label={`${maximized ? 'Restore' : 'Maximize'} ${name}`} title={`${maximized ? 'Restore' : 'Maximize'} ${name}`}
        className="grid h-8 w-8 place-items-center rounded-lg surface text-ink"><Icon name={maximized ? 'minimize' : 'maximize'} size={17} /></button>
    </div>
    <span className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs">
      <span className="truncate">{track.participant.name || 'Member'}{track.source === Track.Source.ScreenShare ? ' · screen' : ''}</span>
      <span aria-label={microphoneOn ? 'Microphone on' : 'Microphone off'} className="shrink-0"><Icon name={microphoneOn ? 'mic' : 'micOff'} size={14} /></span>
    </span>
  </div>
}

export function CallStage() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }])
  const speakers = useSpeakingParticipants()
  const [view, setView] = useState<'speaker' | 'grid'>('grid')
  const [grid, setGrid] = useState(9)
  const [page, setPage] = useState(0)
  const [pinned, setPinned] = useState<string | null>(null)
  const [maximized, setMaximized] = useState<string | null>(null)
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const ordered = useMemo(() => [...tracks].sort((a, b) =>
    Number(trackKey(b) === pinned) - Number(trackKey(a) === pinned) ||
    Number(b.source === Track.Source.ScreenShare) - Number(a.source === Track.Source.ScreenShare)), [tracks, pinned])
  const pageSize = phone ? Math.min(grid, 4) : grid
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize))
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])
  const featured = ordered.find((track) => trackKey(track) === pinned) ||
    ordered.find((track) => track.source === Track.Source.ScreenShare) ||
    ordered.find((track) => track.participant.identity === speakers[0]?.identity) || ordered[0]
  const expanded = ordered.find((track) => trackKey(track) === maximized)
  const focus = expanded || (pinned ? ordered.find((track) => trackKey(track) === pinned) : undefined) || (view === 'speaker' ? featured : undefined)
  const selected = focus ? [focus] : ordered.slice(page * pageSize, (page + 1) * pageSize)
  const others = focus ? ordered.filter((track) => trackKey(track) !== trackKey(focus)) : []

  useEffect(() => {
    if (!maximized) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMaximized(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [maximized])

  const tile = (track: TrackReferenceOrPlaceholder, isMaximized = false) => {
    const key = trackKey(track)
    return <CallTile key={key} track={track} pinned={pinned === key} maximized={isMaximized}
      onPin={() => setPinned(pinned === key ? null : key)}
      onMaximize={() => setMaximized(isMaximized ? null : key)} />
  }

  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <RoomAudioRenderer />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span>{ordered.length} video tiles</span>
      <div className="flex items-center gap-2">
        <select aria-label="View" value={view} onChange={(event) => { setView(event.target.value as typeof view); setPage(0) }} className="rounded border border-line surface px-2 py-1 text-ink">
          <option value="grid">Grid</option><option value="speaker">Speaker</option>
        </select>
        {view === 'grid' && !focus && <select aria-label="Grid size" value={grid} onChange={(event) => { setGrid(Number(event.target.value)); setPage(0) }} className="rounded border border-line surface px-2 py-1 text-ink">
          <option value="4">4</option><option value="9">9</option><option value="16">16</option>
        </select>}
      </div>
    </div>
    <div className={focus ? 'flex min-h-0 flex-1 flex-col gap-2 lg:h-[min(70dvh,52rem)] lg:flex-row' : 'flex min-h-[12rem] flex-1 flex-wrap content-start gap-2'}>
      {focus ? <>
        <div aria-label="Featured video" className="min-h-[18rem] min-w-0 flex-1">{tile(focus, trackKey(focus) === maximized)}</div>
        {others.length > 0 && <div aria-label="Other participants" className="flex max-h-44 shrink-0 gap-2 overflow-auto lg:max-h-none lg:w-52 lg:flex-col xl:w-64">
          {others.map((track) => <div key={trackKey(track)} className="aspect-video w-40 shrink-0 lg:w-full">{tile(track)}</div>)}
        </div>}
      </> : selected.map((track) => <div key={trackKey(track)} className="aspect-video w-full max-w-[22rem]">{tile(track)}</div>)}
      {selected.length === 0 && <p className="col-span-full m-auto text-sm text-muted">Waiting for video…</p>}
    </div>
    {view === 'grid' && !focus && pages > 1 && <div className="flex justify-center gap-3 text-sm">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
  </div>
}
