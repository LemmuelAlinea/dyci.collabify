import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { listAuditEvents } from '../../../lib/api/audit'
import { authErrorMessage } from '../../../lib/authError'
import { AUDIT_ACTIONS, auditSentence, calendarDaysUntil } from '../../../lib/types'
import type { AuditAction, AuditEvent } from '../../../lib/types'

const ICON: Record<AuditAction, 'user' | 'shield' | 'folder' | 'trash' | 'refresh' | 'archive'> = {
  account_created: 'user',
  role_changed: 'shield',
  status_changed: 'shield',
  class_created: 'folder',
  class_archived: 'archive',
  class_restored: 'refresh',
  class_professor_changed: 'refresh',
  class_deleted: 'trash',
}

const TONE: Record<AuditAction, string> = {
  account_created: 'surface-sunken text-muted',
  role_changed: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  status_changed: 'bg-navy-50 text-navy-700 dark:bg-navy-500/18 dark:text-navy-100',
  class_created: 'surface-sunken text-muted',
  class_archived: 'surface-sunken text-muted',
  class_restored: 'surface-sunken text-muted',
  class_professor_changed: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  class_deleted: 'bg-red-500/15 text-red-700 dark:text-red-300',
}

function when(iso: string) {
  const days = calendarDaysUntil(iso)
  const time = new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (days === 0) return `Today · ${time}`
  if (days === -1) return `Yesterday · ${time}`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Who changed somebody's access, and when.
 *
 * What is missing here is the design. An admin reads no project, task, comment,
 * file, submission or mark anywhere in the product, and this does not become
 * the way round that — there is no action in the log that names academic work,
 * and the enum behind it has no label that could.
 */
export default function AuditLog() {
  const [rows, setRows] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await listAuditEvents())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the log.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['profiles', 'classes'])

  const days = useMemo(() => {
    const kept = (rows ?? []).filter((e) => (action ? e.action === action : true))
    const map = new Map<string, AuditEvent[]>()
    for (const e of kept) {
      const key = dayOf(e.at)
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    return [...map.entries()]
  }, [rows, action])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the log…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Program</p>
        <h1 className="mt-1 leading-tight">Audit log</h1>
        <p className="mt-2 max-w-[66ch] text-[14px] text-muted">
          Every change to who someone is and what they can reach, and every class opened,
          handed over or closed. Nothing can be edited here, by anyone.
        </p>
      </header>

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      {/* Said plainly, because an admin should know the limit of their own view. */}
      <p className="flex items-start gap-2 rounded-xl surface-sunken px-4 py-3 text-[13px] leading-relaxed text-muted">
        <Icon name="info" size={15} className="mt-0.5 shrink-0" />
        This records accounts and classes only. What happens inside a class — its projects,
        tasks, files, marks and messages — belongs to the professor and their students, and
        never appears here.
      </p>

      {rows.length > 4 && (
        <FilterPopover
          active={action ? 1 : 0}
          summary={AUDIT_ACTIONS.find((o) => o.value === action)?.label}
          onClear={() => setAction('')}
          label="Filter the log"
        >
          <FilterField label="Kind of change">
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Everything"
              options={AUDIT_ACTIONS}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
        </FilterPopover>
      )}

      {days.length === 0 ? (
        <EmptyState
          icon="clock"
          title="Nothing recorded yet"
          body="Approvals, role changes and class changes appear here as they happen."
        />
      ) : (
        <ol className="space-y-6">
          {days.map(([day, list]) => (
            <li key={day}>
              <p className="eyebrow pb-2">{day}</p>
              <ul className="space-y-1.5">
                {list.map((e) => (
                  <li
                    key={e.id}
                    className="surface flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line px-3.5 py-2.5"
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONE[e.action]}`}
                    >
                      <Icon name={ICON[e.action]} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-ink">{auditSentence(e)}</span>
                      <span className="block truncate text-[12px] text-faint">
                        {e.actor_name}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-faint">
                      {when(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
