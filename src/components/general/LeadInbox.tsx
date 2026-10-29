import { AssignByPosition } from './AssignByPosition'
import { useEffect, useState } from 'react'
import { listWorkTaskReturnReceipts, returnWorkTask, type WorkTaskReturnReceipt } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { stageIndex, stagesOf } from '../../lib/stages'
import { qaStageIndex } from '../../lib/work/qa'
import { formatDue } from '../../lib/general/dates'
import { canAssignIncoming } from '../../lib/general/permissions'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { TaskDialog } from './TaskDialog'
import type { GeneralProjectState } from './useGeneralProject'

export function LeadInbox({ state }: { state: GeneralProjectState }) {
  const [open, setOpen] = useState(false)
  const [byPosition, setByPosition] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [receipts, setReceipts] = useState<WorkTaskReturnReceipt[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectId = state.project?.id
  const work = state.project && !state.project.class_board_id
  const teams = state.teams.filter(t => t.leader_id === state.viewerId)
  const visible = Boolean(work && teams.length && state.myRole !== 'stakeholder')
  useEffect(() => {
    if (!visible || !projectId) return
    let current = true
    void listWorkTaskReturnReceipts(projectId).then(rows => { if (current) setReceipts(rows) })
      .catch(err => { if (current) setError(authErrorMessage(err, 'Could not load return history. Reload the tasks.')) })
    return () => { current = false }
  }, [visible, projectId, state.tasks])
  if (!visible) return null
  const incoming = state.tasks.filter(t => canAssignIncoming(teams.map(team => team.id), t))
  async function sendBack() {
    if (!returning || !reason.trim() || busy || state.readOnly) return
    setBusy(true); setError(null)
    try {
      await returnWorkTask(returning, reason.trim())
      setReturning(null); setReason(''); setTaskId(null)
      await state.reload()
      setReceipts(await listWorkTaskReturnReceipts(projectId!))
    } catch (err) { setError(authErrorMessage(err, 'Could not return this task. Reload the tasks and try again.')) }
    finally { setBusy(false) }
  }
  return <>
    <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setOpen(true)}>Incoming tasks{incoming.length > 0 ? ` (${incoming.length})` : ''}</Button></div>
    <Modal open={open} onClose={() => setOpen(false)} title="Incoming tasks" size="lg">
      <section aria-label="Team incoming" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-muted">Assign work sent to your teams, or return it with a reason.</p>{state.myRole !== 'qa' && <Button size="sm" variant="outline" disabled={state.readOnly || !incoming.length} onClick={() => setByPosition(true)}>Assign by position</Button>}</div>
        {error && <Alert tone="error">{error}</Alert>}
        {incoming.length === 0 ? <p className="text-[13px] text-faint">No incoming tasks.</p> : <ul className="divide-y divide-line">
          {incoming.map(t => <li key={t.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><button type="button" className="text-left text-[14px] font-medium break-words text-ink hover:underline" onClick={() => setTaskId(t.id)}>{t.title}</button>
              <p className="text-[12px] text-muted">{teams.find(team => team.id === t.team_id)?.name}</p></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={state.readOnly || busy} onClick={() => setTaskId(t.id)}>Assign members</Button>
              <Button size="sm" variant="outline" disabled={state.readOnly || busy || t.status === 'done' || (state.project?.has_qa && stageIndex(t.status, t.stage, stagesOf(state.project?.stages).length) >= qaStageIndex(state.project?.stages, state.project?.qa_stage))} onClick={() => { setReturning(t.id); setReason('') }}>Return to planning</Button></div>
          </li>)}
        </ul>}
        {receipts.length > 0 && <div className="space-y-2 border-t border-line pt-4"><h4 className="text-[14px] text-ink">Your returns</h4><ul className="space-y-2">
          {receipts.map((receipt, i) => <li key={`${receipt.task_id}-${receipt.returned_at}-${i}`} className="text-[13px] text-muted"><p className="break-words">Returned task · {formatDue(receipt.returned_at)}</p><p className="whitespace-pre-wrap break-words">{receipt.reason}</p></li>)}
        </ul></div>}
      </section>
    </Modal>
    {byPosition && <AssignByPosition state={state} open onClose={() => setByPosition(false)} mode="lead" />}
    <TaskDialog state={state} taskId={taskId} onClose={() => setTaskId(null)} />
    <Modal open={Boolean(returning)} title="Return to planning" onClose={() => { if (!busy) setReturning(null) }} footer={<Button disabled={state.readOnly || busy || !reason.trim()} onClick={() => void sendBack()}>Confirm return</Button>}>
      <div className="space-y-3">{error && <Alert tone="error">{error}</Alert>}<label className="block space-y-2 text-[13px] text-ink"><span>Reason</span><Textarea aria-label="Return reason" maxLength={4000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label></div>
    </Modal>
  </>
}
