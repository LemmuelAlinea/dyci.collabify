import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Avatar } from '../../../components/app/Avatar'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import {
  FilterField,
  FilterPopover,
  FilterSearch,
} from '../../../components/ui/FilterPopover'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { listAccounts, setAccountActive, setAccountRole } from '../../../lib/api/accounts'
import { authErrorMessage } from '../../../lib/authError'
import { ACCOUNT_STATUS_LABEL, fullName, ROLE_LABEL } from '../../../lib/types'
import type { Account, AccountStatus } from '../../../lib/types'

const STATUS_TONE: Record<AccountStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  pending: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  rejected: 'surface-sunken text-muted',
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Everyone, and two things the admin can change about them.
 *
 * There is no delete, and that is the design rather than an omission:
 * `classes.professor_id` cascades, so removing one professor's row takes their
 * classes, projects, tasks and files with it. Deactivating covers every honest
 * reason to remove somebody and can be undone.
 */
const ROLE_FILTERS = [
  { value: 'student', label: 'Students' },
  { value: 'professor', label: 'Professors' },
  { value: 'admin', label: 'Admins' },
]

export default function Accounts() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [rows, setRows] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<Account | null>(null)
  const [deactivating, setDeactivating] = useState<Account | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listAccounts())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the accounts.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Accounts · Collabify'
    void load()
  }, [load])

  useLive(load, ['profiles'])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((a) => (role ? a.role === role : true))
      .filter((a) => (q ? `${fullName(a)} ${a.email}`.toLowerCase().includes(q) : true))
  }, [rows, query, role])

  async function run(id: string, work: () => Promise<void>, done: string) {
    setBusy(id)
    try {
      await work()
      show(done)
      setPromoting(null)
      setDeactivating(null)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not make that change.'), 'error')
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

  const activeAccounts = rows.filter((account) => account.status === 'active').length
  const students = rows.filter((account) => account.role === 'student').length
  const professors = rows.filter((account) => account.role === 'professor').length

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Every account,"
        accent="clearly managed."
        description="Find anyone in the program, review their access, and make reversible role or status changes."
        statsVariant="compact-row"
        stats={[
          { value: rows.length, label: 'Accounts' },
          { value: activeAccounts, label: 'Active' },
          { value: students, label: 'Students' },
          { value: professors, label: 'Professors' },
        ]}
      />

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      <section className="surface overflow-hidden rounded-panel border border-line">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
          <div>
            <p className="text-[12px] font-medium text-faint">Account directory</p>
            <h2 className="mt-1">People and access</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FilterPopover
              active={[query, role].filter(Boolean).length}
              summary={[query && `“${query}”`, role && ROLE_FILTERS.find((r) => r.value === role)?.label]
                .filter(Boolean)
                .join(' · ')}
              onClear={() => {
                setQuery('')
                setRole('')
              }}
              label="Filter accounts"
            >
              <FilterField label="Search">
                <FilterSearch value={query} onChange={setQuery} placeholder="Find by name or email" />
              </FilterField>
              <FilterField label="Role">
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Every role"
                  options={ROLE_FILTERS}
                  className="!h-10 !text-[13px]"
                />
              </FilterField>
            </FilterPopover>
            <p className="font-mono text-[12px] text-faint">
              {shown.length === rows.length ? `${rows.length} accounts` : `${shown.length} of ${rows.length}`}
            </p>
          </div>
        </header>

        <div className="p-4 sm:p-5">
          <p className="mb-4 flex items-start gap-2 rounded-xl surface-sunken px-4 py-3 text-[13px] leading-relaxed text-muted">
            <Icon name="info" size={15} className="mt-0.5 shrink-0" />
            Accounts are never deleted here. Deactivating stops sign-in while leaving classes and work intact.
          </p>

          {shown.length === 0 ? (
            <EmptyState icon="users" title="Nobody matches" body="Try a different name or role." />
          ) : (
            <ul className="space-y-2">
          {shown.map((a) => {
            const self = a.id === profile?.id
            const isAdmin = a.role === 'admin'
            const working = busy === a.id
            return (
              <li
                key={a.id}
                className="surface flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3.5 py-2.5"
              >
                <Avatar profile={a} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">
                    {fullName(a)}
                    {self && <span className="ml-1.5 text-[12px] text-faint">you</span>}
                  </span>
                  <span className="block truncate text-[12px] text-faint">
                    {a.email} · joined {when(a.created_at)}
                    {a.class_count > 0 &&
                      ` · ${a.class_count} ${a.class_count === 1 ? 'class' : 'classes'}`}
                    {a.enrolment_count > 0 && ` · in ${a.enrolment_count}`}
                  </span>
                </span>

                <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
                  {ROLE_LABEL[a.role]}
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[12px] ${STATUS_TONE[a.status]}`}
                >
                  {ACCOUNT_STATUS_LABEL[a.status]}
                </span>

                {/* An admin is not changed from here, and neither is yourself. */}
                {isAdmin || self ? (
                  <span className="shrink-0 text-[12px] text-faint">Not editable here</span>
                ) : (
                  <span className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={working}
                      onClick={() =>
                        a.role === 'student'
                          ? setPromoting(a)
                          : void run(
                              a.id,
                              () => setAccountRole(a.id, 'student'),
                              `${fullName(a)} is a student now`,
                            )
                      }
                    >
                      {a.role === 'student' ? 'Make professor' : 'Make student'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={working}
                      onClick={() =>
                        a.status === 'active'
                          ? setDeactivating(a)
                          : void run(
                              a.id,
                              () => setAccountActive(a.id, true),
                              `${fullName(a)} can sign in again`,
                            )
                      }
                    >
                      {a.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(promoting)}
        onClose={() => setPromoting(null)}
        onConfirm={() =>
          promoting
            ? run(
                promoting.id,
                () => setAccountRole(promoting.id, 'professor'),
                `${fullName(promoting)} is waiting for approval`,
              )
            : undefined
        }
        tone="primary"
        title="Make this account a professor?"
        confirmLabel="Make professor"
        body={
          <p>
            {promoting && fullName(promoting)} becomes a professor and lands in{' '}
            <strong className="text-ink">Professor approvals</strong>, waiting on you — a
            promotion is not a verification, so they still go through the same check as
            anyone who signed up as one.
          </p>
        }
      />

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={() =>
          deactivating
            ? run(
                deactivating.id,
                () => setAccountActive(deactivating.id, false),
                `${fullName(deactivating)} can no longer sign in`,
              )
            : undefined
        }
        title="Deactivate this account?"
        confirmLabel="Deactivate"
        body={
          <>
            <p>
              {deactivating && fullName(deactivating)} will not be able to sign in. Nothing
              they made is removed, and you can turn this back on at any time.
            </p>
            {deactivating && deactivating.class_count > 0 && (
              <p className="mt-2 font-medium text-ink">
                They run {deactivating.class_count}{' '}
                {deactivating.class_count === 1 ? 'class' : 'classes'} — those become
                unreachable to everyone in them until this is undone or the classes are
                handed over.
              </p>
            )}
          </>
        }
      />
    </div>
  )
}
