import { Fragment, useCallback, useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert, Field, Input } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Textarea } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { deleteNotice, editNotice, listAllNotices, postNotice } from '../../../lib/api/program'
import { authErrorMessage } from '../../../lib/authError'
import { NOTICE_HOURS } from '../../../lib/program'
import type { ProgramNoticeRecord } from '../../../lib/program'
import { momentLabel } from '../../../lib/report'

/**
 * One notice from the program office to everybody in it.
 *
 * A class announcement reaches a class; this reaches every professor and every
 * student at once, which is why there is exactly one pinned slot and why the
 * dialog says how many people it is about to notify. A program notice that
 * nobody reads twice is worth more than one that arrives every day.
 *
 * This page is the only place a notice outlives its 24 hours. Everybody else
 * reads `program_notices`, which stops at the window; the chair reads
 * `program_notices_all`, because taking down something posted in error and
 * answering "what did we announce in October" both need the ones that have
 * already gone.
 */
export default function Notices() {
  const { show } = useToast()
  const [rows, setRows] = useState<ProgramNoticeRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<ProgramNoticeRecord | null>(null)

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
    void load()
  }, [load])

  const ready = title.trim().length > 0 && body.trim().length > 0

  async function send() {
    setSaving(true)
    try {
      await postNotice({ title, body, pinned })
      setTitle('')
      setBody('')
      setPinned(false)
      show('Notice sent to the program')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send the notice.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the notices…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Program</p>
        <h1 className="mt-1 text-[30px] leading-tight">Notices</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          One notice to everybody in the program — a moved deadline, a defense schedule, a
          suspension of classes. It appears on every dashboard and notifies anybody who has
          not turned announcements off.
        </p>
        <p className="mt-2 max-w-[70ch] text-[13.5px] text-muted">
          A notice stays on those dashboards for <strong>{NOTICE_HOURS} hours</strong> and then
          comes off on its own. This page keeps every one you have sent, so nothing is lost —
          it is only no longer in front of people. To say something again, send it again.
        </p>
      </header>

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      <section className="surface space-y-4 rounded-card border border-line p-4 sm:p-5 shadow-card">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13.5px] text-muted">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--line-strong)]"
            />
            Pin it to the top for its {NOTICE_HOURS} hours
          </label>
          <Button className="!rounded-xl" loading={saving} disabled={!ready} onClick={send}>
            <Icon name="bell" size={15} />
            Send to the program
          </Button>
        </div>
        {pinned && rows.some((r) => r.pinned) && (
          <p className="text-[12.5px] text-amber-700 dark:text-amber-300">
            One notice is pinned at a time — sending this will refuse until you unpin the
            current one.
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nothing sent yet"
          body="A notice you send reaches every professor and student in the program."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((n, i) => (
            <Fragment key={n.id}>
              {/* One heading where the window falls, not a badge on every row:
                  the list is already ordered live-first, so the line only has
                  to be drawn once. */}
              {i === 0 && !n.expired && (
                <li>
                  <p className="eyebrow text-faint">On every dashboard now</p>
                </li>
              )}
              {n.expired && !rows[i - 1]?.expired && (
                <li className={i === 0 ? '' : 'pt-3'}>
                  <p className="eyebrow text-faint">
                    Off the dashboards · older than {NOTICE_HOURS} hours
                  </p>
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

      <ConfirmDialog
        open={removing !== null}
        title="Take this notice down?"
        body="It goes from the dashboards and from this page — this is a delete, not the 24-hour window. The notification anybody already received stays in their bell."
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
 *
 * An expired notice is dimmed rather than hidden or struck through: it is still
 * a true record of what was announced, it is simply no longer in front of
 * anybody. Pinning stays available on it because unpinning something that has
 * gone is a thing a chair may reasonably want to tidy up.
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
      className={`surface rounded-card border p-4 shadow-card ${
        n.pinned && !n.expired
          ? 'border-amber-300 dark:border-amber-400/40'
          : 'border-line'
      } ${n.expired ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15.5px] text-ink">
            {n.pinned && <Icon name="pin" size={14} className="shrink-0 text-amber-500" />}
            {n.title}
          </h2>
          <p className="mt-0.5 text-[12px] text-faint">
            {n.author_name} · {momentLabel(n.created_at)}
            {n.edited_at && ' · edited'}
            {n.expired && ' · off the dashboards'}
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
      <p className="mt-2 max-w-[80ch] text-[13.5px] leading-relaxed whitespace-pre-wrap text-muted">
        {n.body}
      </p>
    </li>
  )
}
