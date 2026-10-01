import { PLATFORM_LABEL, audienceText, canJoin, meetingState, timeRange } from '../../lib/meetings'
import type { Meeting } from '../../lib/meetings'
import { ActionMenu } from '../ui/ActionMenu'
import { buttonClass } from '../ui/buttonClass'
import { Icon } from '../ui/Icon'

/** The join link, as a button. Opens the meeting app in a new tab. */
export function JoinLink({ meeting, size = 'sm' }: { meeting: Meeting; size?: 'sm' | 'md' }) {
  return (
    <a
      href={meeting.join_url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass({ variant: 'primary', size })}
    >
      <Icon name="video" size={15} />
      Join
    </a>
  )
}

/**
 * One meeting in a list: when, what, who for, and Join once it is close.
 * The row opens the meeting's details; Join and the menu act on their own.
 */
export function MeetingRow({
  meeting,
  now,
  onOpen,
  onEdit,
  onCancel,
}: {
  meeting: Meeting
  now: number
  onOpen: () => void
  onEdit: () => void
  onCancel: () => void
}) {
  const state = meetingState(meeting, now)
  const live = state === 'live'
  const cancelled = state === 'cancelled'
  const start = new Date(meeting.starts_at)

  return (
    <li
      className={`relative flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunken)] sm:px-5 ${
        live ? 'bg-navy-500/6' : ''
      }`}
    >
      <button type="button" onClick={onOpen} aria-label={`Open ${meeting.title}`} className="absolute inset-0 z-0" />
      <div className="pointer-events-none flex w-14 shrink-0 flex-col items-center rounded-lg surface-sunken py-1.5 text-center">
        <span className="font-mono text-[11px] text-faint uppercase">
          {start.toLocaleDateString(undefined, { month: 'short' })}
        </span>
        <span className="font-mono text-[18px] leading-none font-semibold text-ink">{start.getDate()}</span>
      </div>
      <div className="pointer-events-none min-w-[12rem] flex-1">
        <p className={`line-clamp-2 text-[14px] font-medium ${cancelled ? 'text-muted line-through' : 'text-ink'}`}>
          {meeting.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          <span className="font-mono">{timeRange(meeting)}</span>
          <span className="text-faint">·</span>
          <span className="truncate">{audienceText(meeting)}</span>
          <span className="text-faint">·</span>
          <span>{PLATFORM_LABEL[meeting.platform]}</span>
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        {live && (
          <span className="rounded-full bg-success-500/15 px-2 py-0.5 font-mono text-[11px] text-success-700 dark:text-success-300">
            Live
          </span>
        )}
        {cancelled && <span className="font-mono text-[11px] text-faint">Cancelled</span>}
        {canJoin(meeting, now) && <JoinLink meeting={meeting} />}
        {meeting.can_manage && !cancelled && state !== 'ended' && (
          <ActionMenu
            label={`Actions for ${meeting.title}`}
            items={[
              { label: 'Edit meeting', icon: 'edit', onSelect: onEdit },
              { label: 'Cancel meeting', icon: 'x', tone: 'danger', separated: true, onSelect: onCancel },
            ]}
          />
        )}
      </div>
    </li>
  )
}
