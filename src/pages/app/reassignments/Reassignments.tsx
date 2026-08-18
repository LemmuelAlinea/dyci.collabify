import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { Select, Textarea } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { Reveal } from '../../../components/motion/Reveal'
import { decideReassignment, listReassignments } from '../../../lib/api/reassignments'
import { listGroupMembers } from '../../../lib/api/groups'
import { authErrorMessage } from '../../../lib/authError'
import { fullName, reassignmentStatusLabel } from '../../../lib/types'
import type { GroupMember, ReassignmentRow } from '../../../lib/types'

function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const TONE: Record<string, string> = {
  pending: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  declined: 'surface-sunken text-muted',
  withdrawn: 'surface-sunken text-muted',
}

/**
 * The professor's queue. A student cannot take work off a groupmate, and a
 * started task cannot change hands at all — so when a member goes quiet, this
 * is the only way the rest of the group gets unblocked.
 */
export default function Reassignments() {
  const { show } = useToast()
  const [rows, setRows] = useState<ReassignmentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<ReassignmentRow | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listReassignments())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the requests.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pending = useMemo(() => (rows ?? []).filter((r) => r.status === 'pending'), [rows])
  const settled = useMemo(() => (rows ?? []).filter((r) => r.status !== 'pending'), [rows])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading requests…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Teaching</p>
        <h1 className="mt-1 text-[30px] leading-tight">Reassignments</h1>
        <p className="mt-2 max-w-[62ch] text-[14.5px] text-muted">
          When a task stalls with the person holding it, their group can ask for it to move.
          You decide, and you are the only one who reads the reason.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <section className="space-y-3">
        <h2 className="text-[16px]">
          Waiting on you
          {pending.length > 0 && (
            <span className="ml-2 font-mono text-[13px] text-amber-700 dark:text-amber-300">
              {pending.length}
            </span>
          )}
        </h2>

        {pending.length === 0 ? (
          <EmptyState
            icon="check"
            title="Nothing to decide"
            body="Requests from your classes land here. Students can only ask about work on their own board."
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((r, i) => (
              <Reveal key={r.id} delay={i * 0.04}>
                <RequestCard row={r} onDecide={() => setDeciding(r)} />
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[16px]">Already decided</h2>
          <ul className="space-y-2.5">
            {settled.map((r) => (
              <li
                key={r.id}
                className="surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line px-4 py-3"
              >
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] ${TONE[r.status]}`}
                >
                  {reassignmentStatusLabel(r.status)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                  {r.task_title}
                </span>
                <span className="text-[12.5px] text-muted">
                  {r.to_student_name ? `Now with ${r.to_student_name}` : 'Back to the group'}
                </span>
                <span className="font-mono text-[12px] text-faint">{when(r.decided_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DecideModal
        row={deciding}
        onClose={() => setDeciding(null)}
        onDone={async () => {
          await load()
          show('Request decided')
        }}
      />
    </div>
  )
}

function RequestCard({ row, onDecide }: { row: ReassignmentRow; onDecide: () => void }) {
  return (
    <li className="surface rounded-card border border-line p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {row.class_initial} · {row.project_title}
            {row.group_name ? ` · ${row.group_name}` : ''}
          </p>
          <h3 className="mt-1 text-[17px] leading-snug">{row.task_title}</h3>
          <p className="mt-1 text-[13px] text-muted">
            <strong className="font-medium text-ink">{row.requested_by_name}</strong> asked{' '}
            {row.wants === 'take_over' ? 'to take it on' : 'for it to go back to the group'}
            {row.from_student_name ? `, off ${row.from_student_name}` : ''} ·{' '}
            {when(row.created_at)}
          </p>
        </div>
        <Button size="sm" onClick={onDecide}>
          Decide
        </Button>
      </div>

      {/* The reason names a person. It reaches this page and nowhere else. */}
      <blockquote className="mt-3.5 rounded-xl surface-sunken px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
        {row.reason}
      </blockquote>

      <Link
        to={`/professor/projects/${row.project_id}?tab=tasks&task=${row.task_id}`}
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
      >
        <Icon name="kanban" size={14} />
        Open the task
      </Link>
    </li>
  )
}

function DecideModal({
  row,
  onClose,
  onDone,
}: {
  row: ReassignmentRow | null
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to what was asked for each time a different request is opened.
  useEffect(() => {
    setTarget(row?.wants === 'take_over' ? (row?.requested_by ?? '') : '')
    setNote('')
    setError(null)
    if (!row?.group_id) return setMembers([])
    listGroupMembers([row.group_id])
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [row])

  async function decide(approve: boolean) {
    if (!row) return
    setBusy(true)
    try {
      await decideReassignment({
        id: row.id,
        approve,
        toStudent: approve ? target || null : null,
        note,
      })
      await onDone()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not record that decision.'))
      show('Could not record that decision', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      title="Decide this request"
      description={row?.task_title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>
            Decline
          </Button>
          <Button onClick={() => void decide(true)} disabled={busy}>
            {busy ? 'Saving…' : 'Approve'}
          </Button>
        </>
      }
    >
      {row && (
        <div className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}

          <label className="block space-y-1.5">
            <span className="text-[13.5px] font-medium text-ink">Who gets it</span>
            <Select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Nobody — put it back to the group"
              options={members.map((m) => ({
                value: m.student_id,
                label: m.profile ? fullName(m.profile) : 'Student',
              }))}
            />
            <span className="block text-[12.5px] text-faint">
              {row.wants === 'take_over'
                ? 'They asked to take it on, so that is preselected. Choose somebody else if it suits the group better.'
                : 'They asked for it to go back to the group. Name someone to hand it straight over instead.'}
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[13.5px] font-medium text-ink">
              A note back <span className="text-[12px] text-faint">optional</span>
            </span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Goes to whoever asked. Useful on a decline."
            />
          </label>

          <p className="text-[12.5px] text-faint">
            Approving moves the task and puts it back to To do, so whoever picks it up starts
            clean. Its files, comments and work log stay where they are.
          </p>
        </div>
      )}
    </Modal>
  )
}
