import { useEffect, useMemo, useState } from 'react'
import { RoomAudioRenderer, VideoTrack, useIsMuted, useIsSpeaking, useParticipantAttribute, useParticipantTracks, useSpeakingParticipants, useTracks } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core'
import { Track } from 'livekit-client'
import { Icon } from '../ui/Icon'

function CallTile({ track }: { track: TrackReferenceOrPlaceholder }) {
  const handRaised = useParticipantAttribute('collabify.hand', { participant: track.participant }) === '1'
  const isSpeaking = useIsSpeaking(track.participant)
  const microphone = useParticipantTracks([Track.Source.Microphone], track.participant.identity)[0]
  const isMuted = useIsMuted(microphone ?? { participant: track.participant, source: Track.Source.Microphone })
  const microphoneOn = !!microphone && !isMuted
  return <div className={`relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl border-2 bg-slate-800 text-white ${isSpeaking ? 'border-success-500' : 'border-transparent'}`}>
    {track.publication?.track ? <VideoTrack trackRef={track as typeof track & { publication: NonNullable<typeof track.publication> }}
      className="h-full w-full object-contain" manageSubscription={false} /> : <span className="text-3xl font-semibold">{track.participant.name?.charAt(0) || '?'}</span>}
    {handRaised && <span aria-label="Hand raised" className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-lg">✋</span>}
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
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const ordered = useMemo(() => [...tracks].sort((a, b) => Number(b.source === Track.Source.ScreenShare) - Number(a.source === Track.Source.ScreenShare)), [tracks])
  const pageSize = phone ? Math.min(grid, 4) : grid
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize))
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])
  const selected = view === 'speaker'
    ? ordered.filter((track) => track.source === Track.Source.ScreenShare).slice(0, 1).length
      ? ordered.filter((track) => track.source === Track.Source.ScreenShare).slice(0, 1)
      : ordered.filter((track) => track.participant.identity === speakers[0]?.identity).slice(0, 1).length
        ? ordered.filter((track) => track.participant.identity === speakers[0]?.identity).slice(0, 1)
        : ordered.slice(0, 1)
    : ordered.slice(page * pageSize, (page + 1) * pageSize)

  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <RoomAudioRenderer />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span>{ordered.length} video tiles</span>
      <div className="flex items-center gap-2">
        <select aria-label="View" value={view} onChange={(event) => { setView(event.target.value as typeof view); setPage(0) }} className="rounded border border-line surface px-2 py-1 text-ink">
          <option value="grid">Grid</option><option value="speaker">Speaker</option>
        </select>
        {view === 'grid' && <select aria-label="Grid size" value={grid} onChange={(event) => { setGrid(Number(event.target.value)); setPage(0) }} className="rounded border border-line surface px-2 py-1 text-ink">
          <option value="4">4</option><option value="9">9</option><option value="16">16</option>
        </select>}
      </div>
    </div>
    <div className={`grid min-h-[16rem] flex-1 gap-2 ${view === 'speaker' ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
      {selected.map((track) => <CallTile key={`${track.participant.identity}:${track.source}`} track={track} />)}
      {selected.length === 0 && <p className="col-span-full m-auto text-sm text-muted">Waiting for video…</p>}
    </div>
    {view === 'grid' && pages > 1 && <div className="flex justify-center gap-3 text-sm">
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
  </div>
}
