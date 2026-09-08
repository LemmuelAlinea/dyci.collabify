import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Select, Textarea } from '../../components/ui/Select'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Reveal } from '../../components/motion/Reveal'
import { useToast } from '../../components/ui/Toast'
import { useLive } from '../../hooks/useLive'
import { authErrorMessage } from '../../lib/authError'
import {
  PRIVACY_KINDS,
  answerPrivacyRequest,
  daysLeft,
  listPrivacyRequests,
} from '../../lib/api/privacy'
import type { PrivacyRequestRow, PrivacyStatus } from '../../lib/api/privacy'

/**
 * The queue for whoever answers privacy requests.
 *
 * Its whole job is the clock. RA 10173 does not name a deadline, so the
 * privacy policy commits to five working days to acknowledge and fifteen to
 * complete — a promise worth nothing if the person holding it has to work out
 * from a date whether they are late. Overdue rows sort first and say so.
 *
 * The work itself happens outside this screen. Pulling somebody's rows,
 * blanking their messages, running `scripts/subject-export.mjs` — the steps
 * per kind are in `docs/10-privacy-requests.md`, summarised in the panel
 * beside each request. This page records what was done, it does not do it.
 */

const STEPS: Record<string, string[]> = {
  access: [
    `Run: node scripts/subject-export.mjs <email>`,
    `Read the JSON before sending it — check no other student's name is inside.`,
    `Remove any reassignment reason written by somebody else. It is theirs, not theirs to see.`,
    `Send the file by whatever channel the college uses for student records.`,
  ],
  portability: [
    `Run: node scripts/subject-export.mjs <email>`,
    `Send the JSON as it is. Portability is about the format being machine-readable, not curated.`,
  ],
  correction: [
    `Confirm what is wrong and what it should be, in writing, before changing anything.`,
    `An email address or role change is an admin action, not a self-service one.`,
    `An audit_events entry is never edited. Record the correction alongside it.`,
  ],
  erasure: [
    `Confirm the person means erasure and not withdrawal of consent — they are different.`,
    `Follow docs/10-privacy-requests.md in order. Some tables are append-only.`,
    `Tell them exactly what was kept and why. "Everything is gone" must not be said if it is not true.`,
  ],
  objection: [
    `Ask which use they object to. "The measurements a professor sees" is the common one.`,
    `There is no switch for it — the professor is told not to rely on it for that student.`,
    `Processing that is what makes them a member of a class cannot be objected to separately.`,
  ],
  withdraw_consent: [
    `Withdrawal is not erasure and does not delete anything.`,
    `Record it with withdraw_consent() so the consent record shows when it ended.`,
    `Say what happens next: usually the account is deactivated, because the processing was the course.`,
  ],
}

const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  acknowledged: 'bg-navy-500/15 text-navy-700 dark:text-navy-200',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  refused: 'surface-sunken text-muted',
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** The clock as a sentence, and whether it is the alarming kind. */
function clock(row: PrivacyRequestRow): { text: string; late: boolean } {
  const ackLeft = daysLeft(row.acknowledge_by)
  const doneLeft = daysLeft(row.complete_by)

  if (row.status === 'open' && ackLeft < 0) {
    return { text: `Acknowledgement ${Math.abs(ackLeft)} days overdue`, late: true }
  }
  if (row.status === 'open') {
    return { text: `Acknowledge within ${ackLeft} day${ackLeft === 1 ? '' : 's'}`, late: false }
  }
  if (doneLeft < 0) {
    return { text: `${Math.abs(doneLeft)} days overdue`, late: true }
  }
  return { text: `Complete within ${doneLeft} day${doneLeft === 1 ? '' : 's'}`, late: false }
}

export default function PrivacyQueue() {
  const { show } = useToast()
  const [rows, setRows] = useState<PrivacyRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answering, setAnswering] = useState<PrivacyRequestRow | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listPrivacyRequests())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the queue.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Privacy requests · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * No table named, so this polls and refreshes on focus rather than
   * subscribing. `privacy_requests` is not in the realtime publication —
   * `realtime.sql` publishes only what genuinely needs the second-by-second
   * delivery — and naming it here would claim a subscription that silently
   * never fires. A queue answered over days does not need one.
   */
  useLive(load)

  /** Open first, and within that the most overdue first. */
  const live = useMemo(() => {
    return (rows ?? [])
      .filter((r) => r.status === 'open' || r.status === 'acknowledged')
      .sort((a, b) => daysLeft(a.complete_by) - daysLeft(b.complete_by))
  }, [rows])

  const settled = useMemo(
    () => (rows ?? []).filter((r) => r.status === 'completed' || r.status === 'refused'),
    [rows],
  )

  const overdue = live.filter((r) => clock(r).late).length

  if (rows === null) {
    return (
      <div className="text-muted flex items-center gap-3 py-10 text-[14px]">
        <Spinner size={16} />
        Loading the queue…
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Answer within"
        accent="fifteen days."
        description="Requests students have made under the Data Privacy Act. The steps for each kind are beside it; this screen records what was done."
        stats={[
          { value: live.length, label: 'Waiting on you' },
          { value: overdue, label: 'Past their date' },
          { value: settled.length, label: 'Answered' },
        ]}
      />

      {error && <Alert tone="error">{error}</Alert>}

      {overdue > 0 && (
        <Alert tone="error">
          {overdue} request{overdue === 1 ? ' is' : 's are'} past the date the privacy policy
          promises. A student can take an unanswered request to the National Privacy Commission.
        </Alert>
      )}

      <section className="rounded-panel border-line surface shadow-card overflow-hidden border">
        <div className="border-line surface-sunken flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2>Waiting on you</h2>
            <p className="text-faint mt-1 text-[12px]">Most urgent first.</p>
          </div>
          <span className="surface text-muted rounded-full px-2.5 py-1 font-mono text-[12px] ring-1 ring-[var(--line)]">
            {live.length}
          </span>
        </div>

        {live.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon="shield"
              title="Nothing outstanding"
              body="Requests students make land here with the date they are due to be answered."
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {live.map((r, i) => (
              <Reveal key={r.id} delay={i * 0.04}>
                <li className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-ink text-[14px] font-medium">{r.requester_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.1em] uppercase ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    <span
                      className={`ml-auto text-[12px] ${
                        clock(r).late ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-faint'
                      }`}
                    >
                      {clock(r).text}
                    </span>
                  </div>

                  <p className="text-muted mt-1 text-[13px]">
                    {PRIVACY_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind} ·{' '}
                    {r.requester_email} · asked {when(r.created_at)}
                  </p>

                  {r.detail && (
                    <p className="text-ink mt-2 border-l-2 border-amber-400 py-1 pl-3.5 text-[13px] leading-[1.65]">
                      {r.detail}
                    </p>
                  )}

                  <details className="mt-3">
                    <summary className="text-muted hover:text-ink cursor-pointer text-[12.5px] font-medium">
                      What to do for a {r.kind.replace('_', ' ')} request
                    </summary>
                    <ol className="text-muted mt-2 space-y-1.5 text-[13px] leading-[1.6]">
                      {(STEPS[r.kind] ?? []).map((step, n) => (
                        <li key={n} className="flex gap-3">
                          <span className="text-faint font-mono text-[11px]">{n + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </details>

                  <div className="mt-3">
                    <Button size="sm" onClick={() => setAnswering(r)}>
                      Record an answer
                    </Button>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="rounded-panel border-line surface shadow-card overflow-hidden border">
          <div className="border-line surface-sunken border-b px-5 py-4">
            <h2>Answered</h2>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {settled.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <span className="text-ink text-[14px]">{r.requester_name}</span>
                <span className="text-muted text-[12.5px]">{r.kind}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.1em] uppercase ${STATUS_TONE[r.status]}`}
                >
                  {r.status}
                </span>
                <span className="text-faint ml-auto text-[12px]">
                  {r.answered_at ? when(r.answered_at) : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answering && (
        <AnswerModal
          row={answering}
          onClose={() => setAnswering(null)}
          onDone={async (message) => {
            setAnswering(null)
            show(message)
            await load()
          }}
        />
      )}
    </div>
  )
}

function AnswerModal({
  row,
  onClose,
  onDone,
}: {
  row: PrivacyRequestRow
  onClose: () => void
  onDone: (message: string) => Promise<void>
}) {
  const [status, setStatus] = useState<Exclude<PrivacyStatus, 'open'>>(
    row.status === 'open' ? 'acknowledged' : 'completed',
  )
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await answerPrivacyRequest(row.id, status, answer.trim() || undefined)
      await onDone(`Recorded as ${status}. ${row.requester_name} has been told.`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not record the answer.'))
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Answer ${row.requester_name}`}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <label className="block">
          <span className="text-ink block text-[13px] font-medium">Move it to</span>
          <Select
            className="mt-1.5"
            value={status}
            onChange={(e) => setStatus(e.target.value as Exclude<PrivacyStatus, 'open'>)}
            options={[
              { value: 'acknowledged', label: 'Acknowledged — received, being worked on' },
              { value: 'completed', label: 'Completed — the thing asked for has been done' },
              { value: 'refused', label: 'Refused — with a reason' },
            ]}
          />
        </label>

        <label className="block">
          <span className="text-ink block text-[13px] font-medium">
            What to tell them{status === 'refused' ? '' : ' (optional)'}
          </span>
          <Textarea
            className="mt-1.5"
            rows={4}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={
              status === 'refused'
                ? 'The ground for refusing. They may take this to the National Privacy Commission.'
                : 'This is sent to them as a notification.'
            }
          />
        </label>

        {status === 'refused' && (
          <Alert tone="info">
            A refusal needs a ground. §16(e) gives the person the right to know why, and to
            challenge it.
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Record it
          </Button>
        </div>
      </div>
    </Modal>
  )
}
