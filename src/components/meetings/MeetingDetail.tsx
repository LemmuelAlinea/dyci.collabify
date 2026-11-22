import { PLATFORM_LABEL, SCOPE_LABEL, audienceText, canJoin, meetingState, timeRange } from '../../lib/meetings'
import type { Meeting } from '../../lib/meetings'
import { Link } from 'react-router-dom'
import { paths } from '../../lib/paths'
import { buttonClass } from '../ui/buttonClass'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { JoinLink } from './MeetingRow'
import { CallChat } from './CallChat'
import { CallRecording } from './CallRecording'

const STATE_COPY = {
  upcoming: null,
  scheduled: 'This call starts when a host presses Start.',
  starting: 'The call is starting…',
  live: 'Happening now.',
  ended: 'This meeting has ended.',
  cancelled: 'This meeting was cancelled.',
} as const

/** One meeting in full: where notifications and calendar chips land. */
export function MeetingDetail({
  meeting,
  now,
  onClose,
  onEdit,
  onCancel,
}: {
  meeting: Meeting | null
  now: number
  onClose: () => void
  onEdit: () => void
  onCancel: () => void
}) {
  const state = meeting ? meetingState(meeting, now) : 'upcoming'
  const note = STATE_COPY[state]
  return (
    <Modal
      open={Boolean(meeting)}
      onClose={onClose}
      title={meeting?.title ?? 'Meeting'}
      description={meeting ? `${SCOPE_LABEL[meeting.scope]} · ${audienceText(meeting)}` : undefined}
      footer={
        meeting && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {meeting.can_manage && state !== 'cancelled' && state !== 'ended' && state !== 'starting' && state !== 'live' ? (
              <div className="flex gap-2">
                {/* The fixed destructive red, like the row menu's Cancel: not a
                    personal colour, and it stays red on hover. */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCancel}
                  className="!text-destructive-600 hover:!bg-destructive-50 dark:!text-destructive-400 dark:hover:!bg-destructive-500/10"
                >
                  Cancel meeting
                </Button>
                <Button size="sm" variant="outline" onClick={onEdit}>
                  <Icon name="edit" size={14} />
                  Edit
                </Button>
              </div>
            ) : (
              <span />
            )}
            {meeting.platform === 'collabify' && meeting.can_start && (state === 'scheduled' || state === 'starting') ? (
              <Link to={paths.meetingCall(meeting.id)} className={buttonClass({ variant: 'primary', size: 'md' })}>{state === 'starting' ? 'Retry start' : 'Start call'}</Link>
            ) : canJoin(meeting, now) && (meeting.platform !== 'collabify' || meeting.can_join) ? (
              <JoinLink meeting={meeting} size="md" />
            ) : (
              state === 'upcoming' && <span className="text-[12px] text-muted">Join opens 15 minutes before it starts.</span>
            )}
          </div>
        )
      }
    >
      {meeting && (
        <div className="space-y-4 text-[14px]">
          {note && (
            <p className={`text-[13px] ${state === 'live' ? 'text-success-700 dark:text-success-300' : 'text-muted'}`}>{note}</p>
          )}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-faint">When</dt>
              <dd className="text-ink">
                {new Date(meeting.starts_at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                <span className="block font-mono text-[13px] text-muted">{timeRange(meeting)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">On</dt>
              <dd className="text-ink">{PLATFORM_LABEL[meeting.platform]}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[12px] text-faint">Link</dt>
              <dd className="truncate">
                {meeting.platform === 'collabify' ? (
                  <button type="button" className="text-navy-600 hover:underline dark:text-navy-200" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${paths.meetingCall(meeting.id)}`)}>
                    Copy meeting link
                  </button>
                ) : (
                  <a href={meeting.join_url ?? undefined} target="_blank" rel="noopener noreferrer" className="text-navy-600 hover:underline dark:text-navy-200">{meeting.join_url}</a>
                )}
              </dd>
            </div>
            {meeting.creator_name && (
              <div>
                <dt className="text-[12px] text-faint">Scheduled by</dt>
                <dd className="text-ink">{meeting.creator_name}</dd>
              </div>
            )}
          </dl>
          {meeting.agenda && (
            <div>
              <p className="text-[12px] text-faint">Agenda</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-ink">{meeting.agenda}</p>
            </div>
          )}
          {meeting.platform === 'collabify' && state === 'ended' && <CallChat key={meeting.id} meetingId={meeting.id} readOnly compact />}
          {meeting.platform === 'collabify' && state === 'ended' && <CallRecording key={`recordings-${meeting.id}`} meetingId={meeting.id} canHost={false} />}
        </div>
      )}
    </Modal>
  )
}
