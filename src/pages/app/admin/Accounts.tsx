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
import { Toggle } from '../../../components/ui/Field'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import {
  listAccounts,
  setAccountActive,
  setAccountRole,
  setProjectManager,
} from '../../../lib/api/accounts'
import { setCanTeach } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { ACCOUNT_STATUS_LABEL, fullName, ROLE_LABEL } from '../../../lib/types'
import type { Account, AccountStatus } from '../../../lib/types'

const STATUS_TONE: Record<AccountStatus, string> = {
  active: 'bg-success-500/15 text-success-700 dark:text-success-300',
  pending: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
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
  { value: 'member', label: 'Members' },
  { value: 'admin', label: 'Admins' },
]

/** A switch with its label beside it, so the state reads without hovering. */
function SwitchRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2 text-[12px] text-muted">
      <span aria-hidden>{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </span>
  )
}

export default function Accounts() {
  const { profile, refreshProfile } = useAuth()
  const { show } = useToast()
  const [rows, setRows] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [changing, setChanging] = useState<{ account: Account; to: 'student' | 'member' } | null>(null)
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
      setChanging(null)
      setDeactivating(null)
      // A change to your own account changes what the rail and pages offer you.
      if (id === profile?.id) await refreshProfile()
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


  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Every account,"
        accent="clearly managed."
        description="Find anyone in the program, review their access, and make reversible role or status changes."
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
                  {a.role ? ROLE_LABEL[a.role] : 'No role'}
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[12px] ${STATUS_TONE[a.status]}`}
                >
                  {ACCOUNT_STATUS_LABEL[a.status]}
                </span>

                {a.role === 'member' || isAdmin ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
                    <SwitchRow
                      label="Project manager"
                      checked={a.can_manage_projects}
                      disabled={working || (isAdmin && !self)}
                      onChange={(on) =>
                        void run(
                          a.id,
                          () => setProjectManager(a.id, on),
                          `${fullName(a)} ${on ? 'can manage projects' : 'no longer manages projects'}`,
                        )
                      }
                    />
                    {a.role === 'member' && (
                      <SwitchRow
                        label="Can teach"
                        checked={a.can_teach}
                        disabled={working}
                        onChange={(on) =>
                          void run(
                            a.id,
                            () => setCanTeach(a.id, on),
                            `${fullName(a)} ${on ? 'can teach' : 'no longer teaches'}`,
                          )
                        }
                      />
                    )}
                  </span>
                ) : null}

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
                        setChanging({ account: a, to: a.role === 'student' ? 'member' : 'student' })
                      }
                    >
                      {a.role === 'student' ? 'Make member' : 'Make student'}
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
        open={Boolean(changing)}
        onClose={() => setChanging(null)}
        onConfirm={() =>
          changing
            ? run(
                changing.account.id,
                () => setAccountRole(changing.account.id, changing.to),
                `${fullName(changing.account)} is ${changing.to === 'member' ? 'a member' : 'a student'} now`,
              )
            : undefined
        }
        tone={changing?.to === 'member' ? 'primary' : undefined}
        title={changing?.to === 'member' ? 'Make this account a member?' : 'Make this account a student?'}
        confirmLabel={changing?.to === 'member' ? 'Make member' : 'Make student'}
        body={
          <p>
            {changing && fullName(changing.account)} changes to{' '}
            {changing?.to === 'member' ? 'a member' : 'a student'}.{' '}
            {changing?.to === 'member'
              ? 'They get a plain member account. Turn on a switch to give them access.'
              : 'They lose both switches.'}
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
