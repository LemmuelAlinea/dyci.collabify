import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Avatar } from '../../../components/app/Avatar'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { Reveal } from '../../../components/motion/Reveal'
import { decideFaculty, listProfessorAccounts, setFacultyTeaching } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { fullName } from '../../../lib/types'
import type { AccountStatus, ProfessorAccount } from '../../../lib/types'

const TONE: Record<AccountStatus, string> = {
  pending: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'surface-sunken text-muted',
}

const LABEL: Record<AccountStatus, string> = {
  pending: 'Waiting',
  active: 'Approved',
  rejected: 'Turned down',
}

function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Faculty verification. A professor signs up, lands `pending`, and waits at
 * /pending until somebody here says yes — which is what keeps student groups
 * visible only to real staff.
 *
 * Turning an account down is reversible on purpose. A rejection made by mistake
 * otherwise leaves a real professor with an account they cannot use and no way
 * to appeal from inside the product.
 */
export default function ProfessorApprovals() {
  const { show } = useToast()
  const [rows, setRows] = useState<ProfessorAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<ProfessorAccount | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [teach, setTeach] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      setRows(await listProfessorAccounts())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the accounts.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Faculty approvals · Collabify'
    void load()
  }, [load])

  useLive(load, ['profiles'])

  const waiting = useMemo(() => (rows ?? []).filter((r) => r.status === 'pending'), [rows])
  const settled = useMemo(() => (rows ?? []).filter((r) => r.status !== 'pending'), [rows])

  async function decide(account: ProfessorAccount, approve: boolean) {
    setBusy(account.id)
    try {
      // Teaching is only sent with a first approval. A turn-down, or putting a
      // settled account back, keeps whatever was set.
      const canTeach = approve && account.status === 'pending' ? (teach[account.id] ?? true) : undefined
      await decideFaculty(account.id, approve, canTeach)
      show(approve ? `${fullName(account)} approved` : `${fullName(account)} turned down`)
      setRejecting(null)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not record that.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function toggleTeaching(account: ProfessorAccount) {
    setBusy(account.id)
    try {
      await setFacultyTeaching(account.id, !account.can_teach)
      show(
        account.can_teach
          ? `${fullName(account)} can no longer open classes`
          : `${fullName(account)} can open classes`,
      )
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change teaching.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading accounts…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <DirectoryHero
        title="Verify faculty,"
        accent="protect access."
        description="Review faculty sign-ups before their tools unlock, and decide who can open classes."
        statsVariant="compact-row"
        stats={[
          { value: rows.length, label: 'Faculty' },
          { value: waiting.length, label: 'Waiting' },
          { value: settled.filter((account) => account.status === 'active').length, label: 'Approved' },
          { value: settled.filter((account) => account.status === 'rejected').length, label: 'Turned down' },
        ]}
      />

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      <section className="surface overflow-hidden rounded-panel border border-line">
        <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
          <h2>
          Waiting on you
          {waiting.length > 0 && (
            <span className="ml-2 font-mono text-[13px] text-amber-700 dark:text-amber-300">
              {waiting.length}
            </span>
          )}
          </h2>
          <p className="mt-1 text-[12px] text-muted">New requests appear here before access is granted.</p>
        </header>
        <div className="p-4 sm:p-5">

        {waiting.length === 0 ? (
          <EmptyState
            icon="shield"
            title="Nobody is waiting"
            body="New faculty sign-ups land here for review before anything unlocks for them."
          />
        ) : (
          <ul className="space-y-3">
            {waiting.map((a, i) => (
              <Reveal key={a.id} delay={i * 0.04}>
                <li className="surface flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line p-4">
                  <Avatar profile={a} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {fullName(a)}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {a.email} · signed up {when(a.created_at)}
                    </span>
                  </span>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={teach[a.id] ?? true}
                      disabled={busy === a.id}
                      onChange={(e) => setTeach((t) => ({ ...t, [a.id]: e.target.checked }))}
                    />
                    Can teach
                  </label>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => setRejecting(a)}
                    >
                      Turn down
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => void decide(a, true)}
                    >
                      <Icon name="check" size={15} />
                      Approve
                    </Button>
                  </span>
                </li>
              </Reveal>
            ))}
          </ul>
        )}
        </div>
      </section>

      {settled.length > 0 && (
        <section className="surface overflow-hidden rounded-panel border border-line">
          <header className="border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
            <h2>Already decided</h2>
          </header>
          <ul className="space-y-2 p-4 sm:p-5">
            {settled.map((a) => (
              <li
                key={a.id}
                className="surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line px-4 py-3"
              >
                <Avatar profile={a} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{fullName(a)}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {a.email}
                    {a.class_count > 0 &&
                      ` · ${a.class_count} ${a.class_count === 1 ? 'class' : 'classes'}`}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[12px] ${TONE[a.status]}`}
                >
                  {LABEL[a.status]}
                </span>
                {a.status === 'active' && (
                  <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
                    {a.can_teach ? 'Teaches' : 'Does not teach'}
                  </span>
                )}
                <span className="shrink-0 text-[12px] text-faint">
                  {a.decided_by_name ? `${a.decided_by_name} · ` : ''}
                  {when(a.decided_at)}
                </span>
                {a.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === a.id}
                    onClick={() => void toggleTeaching(a)}
                  >
                    {a.can_teach ? 'Stop teaching' : 'Allow teaching'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === a.id}
                  onClick={() => void decide(a, a.status !== 'active')}
                >
                  {a.status === 'active' ? 'Turn down' : 'Approve'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={() => (rejecting ? decide(rejecting, false) : undefined)}
        title="Turn down this account?"
        confirmLabel="Turn it down"
        body={
          <p>
            {rejecting && fullName(rejecting)} will be told the account was not approved, and
            cannot open a class, a space or any group. You can put it back from this page at any
            time.
            {rejecting && rejecting.class_count > 0 && (
              <>
                {' '}
                They already run {rejecting.class_count}{' '}
                {rejecting.class_count === 1 ? 'class' : 'classes'} — those stay in place but
                become unreachable to them.
              </>
            )}
          </p>
        }
      />
    </div>
  )
}
