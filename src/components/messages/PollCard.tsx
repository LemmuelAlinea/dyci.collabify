import { useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { POLL_MESSAGE, addPollOption, castVote, setPollClosed } from '../../lib/api/polls'
import { authErrorMessage } from '../../lib/authError'
import { tallyPoll } from '../../lib/types'
import type { Poll } from '../../lib/types'

export function PollCard({
  poll,
  viewerId,
  canManage,
  onChanged,
}: {
  poll: Poll
  viewerId: string
  /** Professor of the class or group behind this chat. */
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [busyOption, setBusyOption] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const closed = Boolean(poll.closed_at)
  const mineToManage = canManage || poll.created_by === viewerId
  const canAddOption = !closed && (poll.allow_new_options || poll.created_by === viewerId)
  const { total, mine, forOption } = tallyPoll(poll, viewerId)
  const options = [...poll.options].sort((a, b) => a.position - b.position)

  async function toggle(optionId: string) {
    if (closed) return
    setBusyOption(optionId)
    try {
      const { result } = await castVote(optionId, !mine.has(optionId))
      if (result !== 'ok') show(POLL_MESSAGE[result] ?? 'Could not record that vote.', 'error')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not record that vote.'), 'error')
    } finally {
      setBusyOption(null)
    }
  }

  async function submitOption() {
    if (!draft.trim()) return
    try {
      const { result } = await addPollOption(poll.id, draft)
      if (result === 'ok') {
        setDraft('')
        setAdding(false)
        await onChanged()
      } else {
        show(POLL_MESSAGE[result] ?? 'Could not add that option.', 'error')
      }
    } catch (err) {
      show(authErrorMessage(err, 'Could not add that option.'), 'error')
    }
  }

  return (
    <div className="w-[min(78vw,340px)] space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] font-medium tracking-wide text-faint uppercase">
            <Icon name="chart" size={11} />
            Poll{poll.allow_multiple && ' · pick any'}
            {closed && ' · closed'}
          </p>
          <p className="mt-1 text-[14px] leading-snug font-semibold text-ink">{poll.question}</p>
        </div>
        {mineToManage && (
          <button
            type="button"
            onClick={async () => {
              const { result } = await setPollClosed(poll.id, !closed)
              if (result !== 'ok') show(POLL_MESSAGE[result] ?? 'Could not do that.', 'error')
              await onChanged()
            }}
            title={closed ? 'Reopen poll' : 'Close poll'}
            aria-label={closed ? 'Reopen poll' : 'Close poll'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name={closed ? 'refresh' : 'lock'} size={14} />
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {options.map((o) => {
          const voters = forOption(o.id)
          const picked = mine.has(o.id)
          const pct = total === 0 ? 0 : Math.round((voters.length / total) * 100)
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => toggle(o.id)}
                disabled={closed || busyOption === o.id}
                aria-pressed={picked}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-200 ${
                  picked
                    ? 'border-amber-400 bg-amber-400/12'
                    : 'border-line hover:border-line-strong'
                } ${closed ? 'cursor-default' : ''}`}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-amber-400/15 transition-[width] duration-400"
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center gap-3">
                  {/* Full class names: Tailwind scans source statically, so a
                      constructed `rounded-${...}` would never be generated. */}
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center border ${
                      poll.allow_multiple ? 'rounded-[5px]' : 'rounded-full'
                    } ${picked ? 'border-amber-500 bg-amber-400' : 'border-[var(--line-strong)]'}`}
                  >
                    {picked && <Icon name="check" size={10} className="text-navy-900" strokeWidth={3.5} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{o.label}</span>
                  {busyOption === o.id ? (
                    <Spinner size={13} className="text-muted" />
                  ) : (
                    <span className="shrink-0 font-mono text-[12px] text-muted">
                      {voters.length}
                    </span>
                  )}
                </span>

                {voters.length > 0 && (
                  <span className="relative mt-2 flex pl-6.5">
                    {voters.slice(0, 6).map((v) => (
                      <span key={v.user_id} className="-ml-1.5 first:ml-0">
                        <Avatar
                          profile={{
                            first_name: v.voter?.first_name ?? '?',
                            last_name: v.voter?.last_name ?? '',
                            avatar_url: v.voter?.avatar_url ?? null,
                          }}
                          size={20}
                        />
                      </span>
                    ))}
                    {voters.length > 6 && (
                      <span className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full surface-sunken text-[12px] font-semibold text-muted">
                        +{voters.length - 6}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-faint">
          {total === 0 ? 'No votes yet' : `${total} ${total === 1 ? 'person' : 'people'} voted`}
        </p>
        {canAddOption &&
          (adding ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitOption()
                  if (e.key === 'Escape') setAdding(false)
                }}
                placeholder="New option"
                className="h-8 w-[130px] rounded-lg border border-[var(--control-line)] bg-[var(--surface)] px-2.5 text-[12px] text-ink focus:border-navy-400"
              />
              <button
                type="button"
                onClick={submitOption}
                className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              <Icon name="plus" size={13} />
              Add option
            </button>
          ))}
      </div>
    </div>
  )
}
