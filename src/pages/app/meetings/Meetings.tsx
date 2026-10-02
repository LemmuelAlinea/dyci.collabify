import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { MeetingDetail } from '../../../components/meetings/MeetingDetail'
import { MeetingRow } from '../../../components/meetings/MeetingRow'
import { ScheduleMeetingModal } from '../../../components/meetings/ScheduleMeetingModal'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { EmptyState } from '../../../components/ui/EmptyState'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ScopeFilter } from '../../../components/ui/ScopeFilter'
import { Select } from '../../../components/ui/Select'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { useLive } from '../../../hooks/useLive'
import { useNow } from '../../../hooks/useNow'
import { membershipOf, showsClassScope } from '../../../lib/access'
import { cancelMeeting, listMeetingAudiences, listMeetings } from '../../../lib/api/meetings'
import { authErrorMessage } from '../../../lib/authError'
import { SCOPE_LABEL, endsAt, meetingState, scopeOf } from '../../../lib/meetings'
import type { Meeting, MeetingAudience, MeetingScope } from '../../../lib/meetings'
import { readScope, writeScope } from '../../../lib/scope'

function dayHeading(iso: string, now: number) {
  const d = new Date(iso)
  const today = new Date(now)
  const tomorrow = new Date(now + 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

/**
 * Every meeting the reader is in, across classes, groups, spaces, projects and
 * teams — what is on now, what is coming, and what already happened.
 *
 * What shows is decided by the database, from what the reader belongs to.
 * Scheduling offers only what they may schedule for: a class's faculty for the
 * whole class, a group's own students for their group, and any member of a
 * work space, project or team for it.
 */
export default function Meetings() {
  const { profile } = useAuth()
  const general = useGeneralNavigation()
  // The shared clock ticks once a minute; every load also reads the time, so
  // a meeting somebody just started is "happening now" at once, not a minute on.
  const clock = useNow()
  const [loadedAt, setLoadedAt] = useState(0)
  const now = Math.max(clock, loadedAt)
  const [params, setParams] = useSearchParams()
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [audiences, setAudiences] = useState<MeetingAudience[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState<'schedule' | 'now' | null>(null)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [cancelling, setCancelling] = useState<Meeting | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [type, setType] = useState<MeetingScope | ''>('')
  const [place, setPlace] = useState('')

  useEffect(() => {
    document.title = 'Meetings · Collabify'
  }, [])

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([listMeetings(), listMeetingAudiences()])
      setMeetings(m)
      setAudiences(a)
      setLoadedAt(Date.now())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your meetings.'))
      setMeetings((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['meetings'])

  const classScope = showsClassScope(profile, membershipOf(general.spaces, general.myProjects))
  const scope = classScope ? readScope(params) : 'all'
  const canSchedule = audiences.some((a) => a.can_create)

  // The place filter lists every class and space a meeting here sits in.
  const places = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of meetings ?? []) {
      if (m.class_id && m.class_name) seen.set(`c:${m.class_id}`, m.class_name)
      else if (m.space_id && m.space_name) seen.set(`s:${m.space_id}`, m.space_name)
    }
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [meetings])

  const shown = useMemo(
    () =>
      (meetings ?? [])
        .filter((m) => scope === 'all' || scopeOf(m) === scope)
        .filter((m) => !type || m.scope === type)
        .filter((m) => !place || place === (m.class_id ? `c:${m.class_id}` : `s:${m.space_id}`)),
    [meetings, scope, type, place],
  )

  const live = shown.filter((m) => meetingState(m, now) === 'live')
  const upcoming = shown.filter((m) => {
    const s = meetingState(m, now)
    return s === 'upcoming' || (s === 'cancelled' && endsAt(m) > now)
  })
  const past = shown
    .filter((m) => endsAt(m) <= now)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))

  const byDay = new Map<string, Meeting[]>()
  for (const m of upcoming) {
    const key = new Date(m.starts_at).toDateString()
    byDay.set(key, [...(byDay.get(key) ?? []), m])
  }
  const days = [...byDay.values()]

  const openId = params.get('meeting')
  const open = (meetings ?? []).find((m) => m.id === openId) ?? null
  const showMeeting = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('meeting', id)
    else next.delete('meeting')
    setParams(next, { replace: !id })
  }

  const row = (m: Meeting) => (
    <MeetingRow
      key={m.id}
      meeting={m}
      now={now}
      onOpen={() => showMeeting(m.id)}
      onEdit={() => setEditing(m)}
      onCancel={() => setCancelling(m)}
    />
  )

  const filtersOn = [type, place].filter(Boolean).length

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Meet with"
        accent="your people."
        description="Zoom and Google Meet meetings for your classes, groups, spaces, projects and teams. Everyone invited is notified, and it lands on their calendar."
        action={
          canSchedule ? (
            <>
              <Button variant="create" size="sm" onClick={() => setScheduling('schedule')} className="!rounded-lg">
                <Icon name="plus" size={16} />
                Schedule meeting
              </Button>
              <Button variant="onNavy" size="sm" onClick={() => setScheduling('now')} className="!rounded-lg">
                <Icon name="video" size={16} />
                Start now
              </Button>
            </>
          ) : undefined
        }
      />

      {error && (
        <Alert tone="error" onRetry={() => void load()}>
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {classScope && (
          <ScopeFilter
            value={scope}
            onChange={(next) => setParams(writeScope(params, next), { replace: true })}
            counts={
              meetings
                ? {
                    all: meetings.length,
                    classes: meetings.filter((m) => scopeOf(m) === 'classes').length,
                    work: meetings.filter((m) => scopeOf(m) === 'work').length,
                  }
                : undefined
            }
          />
        )}
        <FilterPopover
          align="right"
          label="Filter meetings"
          active={filtersOn}
          summary={[type && SCOPE_LABEL[type], places.find((p) => p.value === place)?.label].filter(Boolean).join(' · ')}
          onClear={() => {
            setType('')
            setPlace('')
          }}
        >
          <FilterField label="For">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as MeetingScope | '')}
              placeholder="Anyone"
              options={(Object.keys(SCOPE_LABEL) as MeetingScope[]).map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
          <FilterField label="Class or space">
            <Select
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="Everywhere"
              options={places}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
        </FilterPopover>
      </div>

      {meetings === null ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your meetings…
        </div>
      ) : live.length + upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          icon="video"
          art={filtersOn || scope !== 'all' ? undefined : 'meetings'}
          title={filtersOn || scope !== 'all' ? 'Nothing matches' : 'No meetings yet'}
          body={
            filtersOn || scope !== 'all'
              ? 'No meeting fits these filters. Clear them to see every meeting.'
              : canSchedule
                ? 'Schedule one with a Zoom or Google Meet link, or start one now. Everyone you invite is notified.'
                : 'Meetings your class, group, space, project or team schedules show up here.'
          }
          action={
            canSchedule && !filtersOn && scope === 'all' ? (
              <Button onClick={() => setScheduling('schedule')} className="!rounded-xl">
                Schedule meeting
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {live.length > 0 && (
            <section className="overflow-hidden rounded-card border border-success-500/40 surface shadow-card">
              <header className="flex items-center gap-2 border-b border-line surface-sunken px-4 py-3 sm:px-5">
                <span className="h-2 w-2 rounded-full bg-success-500" />
                <h2>Happening now</h2>
              </header>
              <ul className="divide-y divide-[var(--line)]">{live.map(row)}</ul>
            </section>
          )}

          {days.length > 0 ? (
            days.map((list) => (
              <section key={list[0].starts_at} className="overflow-hidden rounded-card border border-line surface shadow-card">
                <header className="border-b border-line surface-sunken px-4 py-3 sm:px-5">
                  <h2>{dayHeading(list[0].starts_at, now)}</h2>
                </header>
                <ul className="divide-y divide-[var(--line)]">{list.map(row)}</ul>
              </section>
            ))
          ) : (
            live.length === 0 && (
              <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                Nothing coming up.
              </p>
            )
          )}

          {past.length > 0 && (
            <section className="overflow-hidden rounded-card border border-line surface">
              <button
                type="button"
                onClick={() => setShowPast(!showPast)}
                aria-expanded={showPast}
                className="flex w-full items-center gap-3 surface-sunken px-4 py-3 text-left sm:px-5"
              >
                <Icon name="history" size={15} className="shrink-0 text-faint" />
                <span className="flex-1 font-medium text-ink">Past 30 days</span>
                <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted">{past.length}</span>
                <Icon name={showPast ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
              </button>
              {showPast && <ul className="divide-y divide-[var(--line)] border-t border-line">{past.map(row)}</ul>}
            </section>
          )}
        </div>
      )}

      <ScheduleMeetingModal
        open={scheduling !== null || editing !== null}
        onClose={() => {
          setScheduling(null)
          setEditing(null)
        }}
        audiences={audiences}
        editing={editing}
        startNow={scheduling === 'now'}
        onSaved={() => void load()}
      />

      <MeetingDetail
        meeting={open}
        now={now}
        onClose={() => showMeeting(null)}
        onEdit={() => {
          if (!open) return
          showMeeting(null)
          setEditing(open)
        }}
        onCancel={() => {
          if (!open) return
          showMeeting(null)
          setCancelling(open)
        }}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return
          try {
            await cancelMeeting(cancelling.id)
          } catch (err) {
            throw new Error(authErrorMessage(err, 'Could not cancel the meeting.'), { cause: err })
          }
          await load()
        }}
        title="Cancel this meeting?"
        body={`Everyone invited to ${cancelling?.title ?? 'it'} is told it is off. The Zoom or Meet link itself stays open; close it there if you need to.`}
        confirmLabel="Cancel meeting"
      />
    </div>
  )
}
