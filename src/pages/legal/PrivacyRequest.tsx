import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Select, Textarea } from '../../components/ui/Select'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Reveal } from '../../components/motion/Reveal'
import { useToast } from '../../components/ui/Toast'
import { authErrorMessage } from '../../lib/authError'
import { listMyConsent } from '../../lib/api/consent'
import type { ConsentRecord } from '../../lib/api/consent'
import {
  PRIVACY_KINDS,
  amPrivacyHandler,
  daysLeft,
  listPrivacyRequests,
  makePrivacyRequest,
} from '../../lib/api/privacy'
import type { PrivacyKind, PrivacyRequestRow } from '../../lib/api/privacy'
import { PRIVACY_CONTACT, REGULATOR, SCHOOL_DPO, docBySlug } from '../../lib/legal'
import { useAuth } from '../../context/AuthContext'

/**
 * Where a student exercises a right the privacy policy promises them.
 *
 * The policy is only as good as this page: "ask through the app" is a written
 * commitment, and a document making it with nothing behind it would be worse
 * than one that stayed silent. Every right listed in the policy has an option
 * here, in the same words.
 *
 * It also shows what the person consented to and when, because the second
 * question anybody asks after "what do you hold about me" is "when did I agree
 * to this" — and a record they cannot see is not much of a record.
 */

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

/** "in 12 days", "today", "4 days late" — the promise, read back. */
function clock(row: PrivacyRequestRow): string {
  if (row.status === 'completed' || row.status === 'refused') {
    return row.answered_at ? `Answered ${when(row.answered_at)}` : 'Answered'
  }
  const left = daysLeft(row.complete_by)
  if (left < 0) return `${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} overdue`
  if (left === 0) return 'Due today'
  return `Answer due in ${left} day${left === 1 ? '' : 's'}`
}

export default function PrivacyRequest() {
  const { show } = useToast()
  const { profile } = useAuth()
  const [handler, setHandler] = useState(false)
  const [rows, setRows] = useState<PrivacyRequestRow[] | null>(null)
  const [consent, setConsent] = useState<ConsentRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  const [kind, setKind] = useState<PrivacyKind>('access')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = useMemo(() => PRIVACY_KINDS.find((k) => k.value === kind), [kind])

  const load = useCallback(async () => {
    try {
      const [requests, records, amHandler] = await Promise.all([
        listPrivacyRequests(),
        listMyConsent(),
        amPrivacyHandler(),
      ])
      setRows(requests)
      setConsent(records)
      setHandler(amHandler)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your requests.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Privacy requests · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await makePrivacyRequest(kind, detail.trim())
      setDetail('')
      show('Request sent. You will hear back within five working days.')
      await load()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send the request.'))
    } finally {
      setBusy(false)
    }
  }

  const open = (rows ?? []).filter((r) => r.status === 'open' || r.status === 'acknowledged')
  const closed = (rows ?? []).filter((r) => r.status === 'completed' || r.status === 'refused')

  if (rows === null) {
    return (
      <div className="text-muted flex items-center gap-3 py-10 text-[14px]">
        <Spinner size={16} />
        Loading your requests…
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Ask about"
        accent="your data."
        description="Every right in the privacy policy is exercised here. Requests are acknowledged within five working days and answered within fifteen."
        stats={[
          { value: open.length, label: 'Open requests' },
          { value: closed.length, label: 'Answered' },
        ]}
      />

      {error && <Alert tone="error">{error}</Alert>}

      {/* Shown to exactly one person in the college. The navigation is static
          per role and cannot know who was named handler, so the link lives
          here rather than as a rail entry every professor would carry. */}
      {handler && profile && profile.role !== 'student' && (
        <Alert tone="info">
          You answer privacy requests for the college.{' '}
          <Link
            to={profile.role === 'admin' ? '/admin/privacy' : '/professor/privacy'}
            className="font-semibold underline underline-offset-[3px]"
          >
            Open the queue
          </Link>
          .
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-panel border-line surface shadow-card overflow-hidden border">
          <div className="border-line surface-sunken border-b px-5 py-4">
            <h2>Make a request</h2>
            <p className="text-faint mt-1 text-[12px]">
              Under the Data Privacy Act of 2012. Nothing here affects your standing in any
              subject.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4 p-5">
            <label className="block">
              <span className="text-ink block text-[13px] font-medium">What are you asking for?</span>
              <Select
                className="mt-1.5"
                value={kind}
                onChange={(e) => setKind(e.target.value as PrivacyKind)}
                options={PRIVACY_KINDS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </label>

            {chosen && (
              <p className="text-muted border-l-2 border-amber-400 py-1 pl-3.5 text-[13px] leading-[1.65]">
                {chosen.help}
              </p>
            )}

            <label className="block">
              <span className="text-ink block text-[13px] font-medium">
                Anything the person handling it should know
              </span>
              <Textarea
                className="mt-1.5"
                rows={4}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Optional. For a correction, say what is wrong and what it should be."
              />
            </label>

            <Button type="submit" size="lg" loading={busy}>
              Send request
            </Button>
          </form>
        </section>

        {/* Everything a person needs to take this further without asking
            permission first. §16(e) gives them the regulator directly, and
            burying that would be the kind of omission the section exists to
            prevent. */}
        <aside className="rounded-panel border-line surface shadow-card h-fit overflow-hidden border">
          <div className="border-line surface-sunken border-b px-5 py-4">
            <h2>Who sees this</h2>
          </div>
          <div className="text-muted space-y-4 p-5 text-[13px] leading-[1.7]">
            <p>
              Requests reach {PRIVACY_CONTACT.name}, who answers on the college's behalf. If you
              cannot sign in, write to them directly at {PRIVACY_CONTACT.email}.
            </p>
            <p>
              Not satisfied with the answer? Take it to {SCHOOL_DPO.name}. Beyond that you can
              complain to the {REGULATOR.name} at {REGULATOR.site} or {REGULATOR.email}, without
              the college's permission.
            </p>
            <p>
              <Link
                to="/privacy#your-rights"
                className="text-ink font-medium underline decoration-amber-400/70 underline-offset-[3px]"
              >
                Read what each right means
              </Link>
            </p>
          </div>
        </aside>
      </div>

      <section className="rounded-panel border-line surface shadow-card overflow-hidden border">
        <div className="border-line surface-sunken flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2>Your requests</h2>
            <p className="text-faint mt-1 text-[12px]">Newest first, with the clock on each.</p>
          </div>
          <span className="surface text-muted rounded-full px-2.5 py-1 font-mono text-[12px] ring-1 ring-[var(--line)]">
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon="shield"
              title="You have not asked for anything"
              body="Requests you make appear here with the date they are due to be answered."
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((r, i) => (
              <Reveal key={r.id} delay={i * 0.04}>
                <li className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-ink text-[14px] font-medium">
                      {PRIVACY_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.1em] uppercase ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    <span className="text-faint ml-auto text-[12px]">{clock(r)}</span>
                  </div>
                  {r.detail && <p className="text-muted mt-1.5 text-[13px]">{r.detail}</p>}
                  {r.answer && (
                    <p className="text-ink mt-2 border-l-2 border-amber-400 py-1 pl-3.5 text-[13px] leading-[1.65]">
                      {r.answer}
                    </p>
                  )}
                  <p className="text-faint mt-2 font-mono text-[10.5px] tracking-[0.1em] uppercase">
                    Asked {when(r.created_at)}
                  </p>
                </li>
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-panel border-line surface shadow-card overflow-hidden border">
        <div className="border-line surface-sunken border-b px-5 py-4">
          <h2>What you agreed to</h2>
          <p className="text-faint mt-1 text-[12px]">
            The exact version you were shown, and the day you agreed to it.
          </p>
        </div>
        {consent.length === 0 ? (
          <p className="text-muted p-5 text-[13px]">
            No consent record was found for this account. If you registered before these documents
            existed, you will be asked the next time a version changes.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {consent.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <Link
                  to={`/${row.document}`}
                  className="text-ink text-[14px] font-medium underline decoration-amber-400/70 underline-offset-[3px]"
                >
                  {docBySlug(row.document)?.title ?? row.document}
                </Link>
                <span className="text-faint font-mono text-[11px] tracking-[0.1em] uppercase">
                  Version {row.version}
                </span>
                <span className="text-muted ml-auto text-[12px]">
                  {row.withdrawn_at ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="x" size={12} />
                      Withdrawn {when(row.withdrawn_at)}
                    </span>
                  ) : (
                    <>Agreed {when(row.granted_at)}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
