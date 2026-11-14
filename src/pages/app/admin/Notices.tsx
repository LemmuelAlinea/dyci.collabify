import { Fragment, useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Field, Input } from '../../../components/ui/Field'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { DraftFromLine } from '../../../components/ui/DraftFromLine'
import { Textarea } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import {
  deleteNotice,
  editNotice,
  listAllNotices,
  noticeReach,
  postNotice,
} from '../../../lib/api/program'
import { listOffices } from '../../../lib/api/offices'
import type { Office } from '../../../lib/offices'
import { authErrorMessage } from '../../../lib/authError'
import {
  NOTICE_GROUPS,
  noticeAudienceLabel,
  type NoticeAudience,
  type NoticeGroup,
  type ProgramNoticeRecord,
} from '../../../lib/program'
import { momentLabel } from '../../../lib/report'
import { Linkify } from '../../../components/ui/Linkify'
import { DriveLinkCards } from '../../../components/ui/DriveLinkCards'

/**
 * One notice from the program office to everybody in it.
 *
 * A class announcement reaches a class; this reaches every professor and every
 * student at once, which is why there is exactly one pinned slot and why the
 * dialog says how many people it is about to notify. A program notice that
 * nobody reads twice is worth more than one that arrives every day.
 *
 * A notice stays on the dashboards until it is taken down here. The chair reads
 * `program_notices_all`; everybody else reads `program_notices`.
 */
const ABOUT_KEY = 'collabify.notices.about'

/** The database's rate-limit text still says the notice reaches the whole program. */
export function noticeSendError(err: unknown) {
  const text = authErrorMessage(err, 'Could not send the notice.')
  return /six notices in an hour/i.test(text)
    ? 'That is six notices in an hour. Wait a while before sending another.'
    : text
}

export default function Notices() {
  const { show } = useToast()
  const [rows, setRows] = useState<ProgramNoticeRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<ProgramNoticeRecord | null>(null)
  const [composing, setComposing] = useState(false)
  const [audience, setAudience] = useState<NoticeAudience>('everyone')
  const [pickedOffices, setPickedOffices] = useState<string[]>([])
  const [pickedGroups, setPickedGroups] = useState<NoticeGroup[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [reach, setReach] = useState<number | null>(null)

  useEffect(() => {
    listOffices()
      .then((o) => setOffices(o.filter((x) => !x.archived_at)))
      .catch(() => setOffices([]))
  }, [])

  const audienceEmpty =
    (audience === 'offices' && pickedOffices.length === 0) ||
    (audience === 'groups' && pickedGroups.length === 0)

  // The count is the notifier's own, asked ahead of sending; debounced so ticking
  // a few boxes asks once.
  useEffect(() => {
    if (!composing || audienceEmpty) {
      setReach(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      noticeReach(audience, pickedOffices, pickedGroups)
        .then((n) => live && setReach(n))
        .catch(() => live && setReach(null))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [composing, audience, pickedOffices, pickedGroups, audienceEmpty])

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  /**
   * The paragraphs explaining what this page is stay hidden once the chair has
   * read them. It is the same two paragraphs every visit, and after the first
   * one they are just distance between the heading and the notices.
   *
   * Kept per browser rather than on the profile: it is a preference about this
   * screen, not a fact about the person.
   */
  const [about, setAbout] = useState(false)
  useEffect(() => {
    setAbout(localStorage.getItem(ABOUT_KEY) !== '0')
  }, [])
  function toggleAbout() {
    setAbout((v) => {
      const next = !v
      try {
        localStorage.setItem(ABOUT_KEY, next ? '1' : '0')
      } catch {
        /* a browser refusing storage should not stop the toggle working */
      }
      return next
    })
  }

  const load = useCallback(async () => {
    try {
      setRows(await listAllNotices())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the notices.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Notices · Collabify'
    void load()
  }, [load])

  useLive(load, ['program_announcements'])

  const ready = title.trim().length > 0 && body.trim().length > 0 && !audienceEmpty

  async function send() {
    setSaving(true)
    try {
      await postNotice({
        title,
        body,
        pinned,
        audience,
        audienceOffices: pickedOffices,
        audienceGroups: pickedGroups,
      })
      setTitle('')
      setBody('')
      setPinned(false)
      setAudience('everyone')
      setPickedOffices([])
      setPickedGroups([])
      setComposing(false)
      show('Notice sent')
      await load()
    } catch (err) {
      show(noticeSendError(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the notices…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="One update,"
        accent="everyone informed."
        description="Publish time-sensitive program notices and keep a clear history after they leave dashboards."
        action={
          <Button variant="create" size="sm" className="!rounded-lg" onClick={() => setComposing(true)}>
            <Icon name="plus" size={15} />
            Send a notice
          </Button>
        }
      />

      <section className="surface overflow-hidden rounded-panel border border-line">
        <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-faint">Notice history</p>
              <h2 className="mt-1">Program announcements</h2>
            </div>
        <button
          type="button"
          onClick={toggleAbout}
          aria-expanded={about}
              className="flex items-center gap-1 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          <Icon
            name="chevronDown"
            size={14}
            className={`transition-transform duration-200 ${about ? '' : '-rotate-90'}`}
          />
          {about ? 'Hide what this page does' : 'What this page does'}
            </button>
          </div>

        {about && (
            <div className="mt-3 max-w-[76ch] text-[13px] leading-relaxed text-muted">
              <p>
              One notice to everybody in the program — a moved deadline, a defense schedule, a
              suspension of classes. It appears on every dashboard and notifies anybody who has
              not turned announcements off.
            </p>
              <p className="mt-1.5">
              A notice stays on those dashboards until you take it down. Long notices are
                shown shortened, with a See more that opens the whole of it.
            </p>
            </div>
        )}
      </header>

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      {/* The composer is a dialog rather than a panel on the page. It is used
          once in a while and read past every other time, and as a panel it sat
          between the heading and the notices the chair actually came to look
          at. A draft survives closing it — only sending clears the fields. */}
      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title="Send a notice"
        description="Choose who it reaches. People with announcements turned off are not notified."
        size="md"
        focusField
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="!rounded-xl" loading={saving} disabled={!ready} onClick={send}>
              <Icon name="bell" size={15} />
              Send notice
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DraftFromLine
            onDraft={(d) => {
              setTitle(d.title)
              setBody(d.body)
            }}
          />
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="No classes on Friday"
              />
            )}
          </Field>
          <Field label="What people need to know">
            {(id) => (
              <Textarea
                id={id}
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Say what changed and what to do about it."
              />
            )}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-ink">Send to</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {(
                [
                  ['everyone', 'Everyone'],
                  ['offices', 'Offices'],
                  ['groups', 'Groups'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="radio"
                    name="notice-audience"
                    value={v}
                    checked={audience === v}
                    onChange={() => setAudience(v)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {audience === 'offices' && (
              <div className="space-y-1 pl-1">
                {offices.length === 0 && (
                  <p className="text-[12px] text-faint">There are no offices yet.</p>
                )}
                {offices.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      checked={pickedOffices.includes(o.id)}
                      onChange={() => setPickedOffices((l) => toggle(l, o.id))}
                      className="h-4 w-4 rounded border-[var(--control-line)]"
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            )}
            {audience === 'groups' && (
              <div className="space-y-1 pl-1">
                {NOTICE_GROUPS.map((g) => (
                  <label key={g.value} className="flex items-center gap-2 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      checked={pickedGroups.includes(g.value)}
                      onChange={() => setPickedGroups((l) => toggle(l, g.value))}
                      className="h-4 w-4 rounded border-[var(--control-line)]"
                    />
                    {g.label}
                  </label>
                ))}
              </div>
            )}
            <p data-reach className="text-[12px] text-faint">
              {audienceEmpty
                ? audience === 'offices'
                  ? 'Tick at least one office.'
                  : 'Tick at least one group.'
                : reach === null
                  ? 'Counting who it reaches…'
                  : `Will notify ${reach} ${reach === 1 ? 'person' : 'people'}.`}
            </p>
          </fieldset>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--control-line)]"
            />
            Pin it to the top
          </label>
          {pinned && rows.some((r) => r.pinned) && (
            <p className="text-[12px] text-warning-700 dark:text-warning-300">
              One notice is pinned at a time — sending this will refuse until you unpin the
              current one.
            </p>
          )}
        </div>
      </Modal>

        <div className="p-4 sm:p-5">
      {rows.length === 0 ? (
        <EmptyState
          icon="bell"
          art="announcements"
          title="Nothing sent yet"
          body="A notice you send reaches the offices or groups you choose, or everyone."
        />
      ) : (
          <ul className="space-y-3">
          {rows.map((n, i) => (
            <Fragment key={n.id}>
              {i === 0 && (
                <li>
                  <p className="eyebrow text-faint">On every dashboard now</p>
                </li>
              )}
              <NoticeCard
                notice={n}
                onTogglePin={async () => {
                  try {
                    await editNotice(n.id, { pinned: !n.pinned })
                    await load()
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not change the pin.'), 'error')
                  }
                }}
                onRemove={() => setRemoving(n)}
              />
            </Fragment>
          ))}
          </ul>
      )}
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        title="Take this notice down?"
        body="It goes from the dashboards and from this page — The notification anybody already received stays in their bell."
        confirmLabel="Take it down"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteNotice(removing.id)
          show('Notice taken down')
          await load()
        }}
      />
    </div>
  )
}

/**
 * One notice in the chair's list.
 */
function NoticeCard({
  notice: n,
  onTogglePin,
  onRemove,
}: {
  notice: ProgramNoticeRecord
  onTogglePin: () => void
  onRemove: () => void
}) {
  return (
    <li
      className="surface rounded-card border border-line p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-ink">
            {n.pinned && <Icon name="pin" size={14} className="shrink-0 text-warning-500" />}
            {n.title}
          </h2>
          <p className="mt-0.5 text-[12px] text-faint">
            {n.author_name} · {momentLabel(n.created_at)} · <span data-audience>{noticeAudienceLabel(n)}</span>
            {n.edited_at && ' · edited'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" className="!rounded-xl" onClick={onTogglePin}>
            {n.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="!rounded-xl"
            onClick={onRemove}
            aria-label={`Take down ${n.title}`}
          >
            <Icon name="trash" size={14} />
          </Button>
        </div>
      </div>
      <p className="mt-2 max-w-[80ch] text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
        <Linkify text={n.body} />
      </p>
      <DriveLinkCards text={n.body} className="mt-2.5" />
    </li>
  )
}
