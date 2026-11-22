import { useEffect, useState } from 'react'
import { useParticipants, useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { Button } from '../ui/Button'

export type ModerationAction = 'mute' | 'stop_share' | 'remove' | 'clear_hand' | 'lock' | 'unlock' | 'end'

export function CallPeople({ canHost, locked, onAction, onClose }: {
  canHost: boolean
  locked: boolean
  onAction: (action: ModerationAction, targetId?: string) => void
  onClose: () => void
}) {
  const room = useRoomContext()
  const participants = useParticipants()
  const [, refresh] = useState(0)
  useEffect(() => {
    const changed = () => refresh((value) => value + 1)
    room.on(RoomEvent.ParticipantAttributesChanged, changed)
    return () => { room.off(RoomEvent.ParticipantAttributesChanged, changed) }
  }, [room])
  const people = [...participants].sort((a, b) => Number(b.attributes['collabify.hand'] === '1') - Number(a.attributes['collabify.hand'] === '1'))

  return <aside aria-label="People in call" className="w-full space-y-3 rounded-xl border border-line surface p-4 md:w-72">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">People ({people.length})</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    {locked && <p className="text-xs text-muted">The room is locked to new participants.</p>}
    {canHost && <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => onAction(locked ? 'unlock' : 'lock')}>{locked ? 'Unlock room' : 'Lock room'}</Button>
      <Button variant="danger" size="sm" onClick={() => { if (window.confirm('End this call for everyone?')) onAction('end') }}>End for everyone</Button>
    </div>}
    <ul className="max-h-[55vh] space-y-2 overflow-auto">
      {people.map((person) => <li key={person.identity} className="rounded-lg surface-sunken p-2 text-sm">
        <p className="truncate font-medium text-ink">{person.name || 'Member'}{person.isLocal ? ' · You' : ''}</p>
        {person.attributes['collabify.hand'] === '1' && <p className="text-xs text-amber-600">✋ Hand raised</p>}
        {canHost && !person.isLocal && <div className="mt-2 flex flex-wrap gap-1 text-xs">
          {person.attributes['collabify.hand'] === '1' && <button onClick={() => onAction('clear_hand', person.identity)}>Lower hand</button>}
          <button onClick={() => onAction('mute', person.identity)}>Mute</button>
          <button onClick={() => onAction('stop_share', person.identity)}>Stop share</button>
          <button className="text-danger-600" onClick={() => { if (window.confirm(`Remove ${person.name || 'this member'} from the call?`)) onAction('remove', person.identity) }}>Remove</button>
        </div>}
      </li>)}
    </ul>
  </aside>
}
