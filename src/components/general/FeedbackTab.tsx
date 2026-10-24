import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { Tabs } from '../ui/Tabs'
import { useLive } from '../../hooks/useLive'
import { listFeedback } from '../../lib/api/feedback'
import { authErrorMessage } from '../../lib/authError'
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  canPostFeedback,
  feedbackAuthor,
} from '../../lib/general/feedback'
import type { FeedbackListItem, FeedbackStatus } from '../../lib/general/feedback'
import { FeedbackComposer } from './FeedbackComposer'
import { StatusChip } from './FeedbackParts'
import { FeedbackThreadView } from './FeedbackThreadView'
import { PersonBadge } from './RoleBadge'
import type { GeneralProjectState } from './useGeneralProject'

type Filter = FeedbackStatus | 'all'

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Row({
  item,
  state,
  selected,
  onOpen,
}: {
  item: FeedbackListItem
  state: GeneralProjectState
  selected: boolean
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
        className={`block w-full rounded-card border p-4 text-left transition-colors ${
          selected
            ? 'border-navy-400 bg-[var(--surface-sunken)]'
            : 'border-line surface hover:bg-[var(--surface-sunken)]'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{FEEDBACK_KIND_LABEL[item.kind]}</Badge>
          <StatusChip status={item.status} />
        </div>
        <p className="mt-2 break-words text-[15px] font-medium text-ink">{item.title}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span>{feedbackAuthor(item.author_id, state.nameOf)}</span>
          {item.author_id && <PersonBadge userId={item.author_id} roles={state} />}
          <span className="text-faint">{day(item.created_at)}</span>
          <span className="inline-flex items-center gap-1 text-faint">
            <Icon name="message" size={13} />
            {item.reply_count}
          </span>
        </p>
      </button>
    </li>
  )
}

/**
 * A work project's Feedback: a list on the left and the open post on the
 * right, or one at a time on a phone. Realtime (`useLive`, the same hook the
 * Discussion tab uses) refreshes the list and the open thread when any of the
 * three feedback tables change; every action here also refetches itself, so
 * the page is right even where realtime is not.
 */
export function FeedbackTab({ state }: { state: GeneralProjectState }) {
  const projectId = state.project?.id ?? ''
  const [params, setParams] = useSearchParams()
  const selected = params.get('feedback')
  const [items, setItems] = useState<FeedbackListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [composing, setComposing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      setItems(await listFeedback(projectId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load feedback.'))
    }
  }, [projectId])

  const refresh = useCallback(async () => {
    setRefreshKey((k) => k + 1)
    await load()
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

  useLive(refresh, ['general_feedback', 'general_feedback_replies', 'general_feedback_files'], {
    enabled: Boolean(projectId),
  })

  function select(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('feedback', id)
    else next.delete('feedback')
    setParams(next)
  }

  const mayPost = canPostFeedback(state.myRole) && !state.archived

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: 0, open: 0, acknowledged: 0, resolved: 0 }
    for (const item of items ?? []) {
      out.all += 1
      out[item.status] += 1
    }
    return out
  }, [items])

  const shown = (items ?? []).filter((i) => filter === 'all' || i.status === filter)

  if (items === null && !error) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading feedback…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <Alert tone="error" onRetry={() => void load()}>
          {error}
        </Alert>
      )}

      {composing && (
        <FeedbackComposer
          projectId={projectId}
          onCancel={() => setComposing(false)}
          onPosted={(id) => {
            setComposing(false)
            setFilter('open')
            select(id)
            void refresh()
          }}
        />
      )}

      {items !== null && items.length === 0 && !composing && (
        <EmptyState
          icon="message"
          title="No feedback yet"
          body="Stakeholders, the project manager and coordinators can post here."
          action={
            mayPost ? (
              <Button onClick={() => setComposing(true)}>
                <Icon name="plus" size={16} />
                New feedback
              </Button>
            ) : undefined
          }
        />
      )}

      {items !== null && items.length > 0 && (
        <>
          <div className={`flex flex-wrap items-center justify-between gap-3 ${selected ? 'max-lg:hidden' : ''}`}>
            <Tabs<Filter>
              variant="panel"
              active={filter}
              onChange={setFilter}
              tabs={[
                { id: 'all', label: 'All', count: counts.all },
                ...FEEDBACK_STATUSES.map((s) => ({
                  id: s as Filter,
                  label: FEEDBACK_STATUS_LABEL[s],
                  count: counts[s],
                })),
              ]}
            />
            {mayPost && !composing && (
              <Button onClick={() => setComposing(true)}>
                <Icon name="plus" size={16} />
                New feedback
              </Button>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
            <div className={selected ? 'hidden lg:block' : undefined}>
              {shown.length === 0 ? (
                <p className="rounded-card border border-dashed border-line-strong px-4 py-8 text-center text-[14px] text-muted">
                  {filter === 'all' ? 'No feedback yet.' : `No ${FEEDBACK_STATUS_LABEL[filter].toLowerCase()} feedback.`}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {shown.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      state={state}
                      selected={item.id === selected}
                      onOpen={() => select(item.id)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className={selected ? undefined : 'hidden lg:block'}>
              {selected ? (
                <FeedbackThreadView
                  key={selected}
                  state={state}
                  feedbackId={selected}
                  refreshKey={refreshKey}
                  onChanged={() => void refresh()}
                  onBack={() => select(null)}
                />
              ) : (
                <p className="rounded-card border border-dashed border-line-strong px-4 py-12 text-center text-[14px] text-muted">
                  Pick a post to read it and its replies.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
