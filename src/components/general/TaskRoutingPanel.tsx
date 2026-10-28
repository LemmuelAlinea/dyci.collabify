import { AssignByPosition } from './AssignByPosition'
import { useState } from 'react'
import { sendTasksToCoordinator, sendTasksToTeams, returnWorkTask } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralTask } from '../../lib/general/types'
import { stageIndex, stagesOf } from '../../lib/stages'
import { qaStageIndex } from '../../lib/work/qa'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import type { GeneralProjectState } from './useGeneralProject'

type Queue = 'planning' | 'coordinator_review' | 'released'
const LABEL = { planning: 'Planning', coordinator_review: 'Coordinator review', released: 'Reroute released work' }

export function TaskRoutingPanel({ state, onOpenTask }: { state: GeneralProjectState; onOpenTask?: (id: string) => void }) {
  const [byPosition, setByPosition] = useState(false)
  const [queue, setQueue] = useState<Queue>('planning')
  const [selected, setSelected] = useState<Record<string, GeneralTask>>({})
  const [teams, setTeams] = useState<Record<string, string>>({})
  const [coordinator, setCoordinator] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [reason, setReason] = useState('')
  const project = state.project
  if (!project || project.class_board_id || (state.myRole !== 'pm' && state.myRole !== 'coordinator')) return null
  const rows = state.tasks.filter(t => (t.routing_state ?? 'released') === queue)
  const picks = Object.values(selected)
  const ready = picks.length > 0 && picks.every(t => teams[t.id] ?? t.team_id)
  const destinations = state.teams.filter(t => t.leader_id).map(t => ({ value: t.id, label: t.name }))
  const editable = !state.readOnly && !busy

  async function act(action: () => Promise<unknown>) {
    if (!editable) return
    setBusy(true); setError(null)
    try {
      await action()
      await state.reload()
      setSelected({}); setTeams({}); setReturning(null); setRerouting(false); setReason('')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not hand off these tasks. Reload the tasks and try again.'))
    } finally { setBusy(false) }
  }
  async function refresh() {
    await state.reload()
    setSelected({}); setTeams({}); setReturning(null); setRerouting(false); setReason(''); setError(null)
  }
  function send() {
    if (!ready) return
    return act(() => sendTasksToTeams(project!.id, picks.map(t => ({ id: t.id, team_id: teams[t.id] ?? t.team_id!, updated_at: t.updated_at })), rerouting ? reason.trim() : undefined))
  }

  return <section aria-label="Task handoff" className="surface space-y-4 rounded-xl border border-line p-4 sm:p-5">
    <div className="flex flex-wrap gap-2" aria-label="Routing queues">
      {(Object.keys(LABEL) as Queue[]).map(q => <Button key={q} size="sm" variant={queue === q ? 'primary' : 'outline'} disabled={busy} aria-pressed={queue === q} onClick={() => { setQueue(q); setSelected({}); setTeams({}); setError(null) }}>{LABEL[q]}</Button>)}
    </div>
    <p className="text-[13px] text-muted">Planning and review stay private to planners. Choosing a team does not send work.</p>
    {queue !== 'released' && <Button size="sm" variant="outline" disabled={!editable} onClick={() => setByPosition(true)}>Assign by position</Button>}
    {byPosition && <AssignByPosition state={state} open onClose={() => setByPosition(false)} />}
    {error && <Alert tone="error">{error} <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Reload tasks</Button></Alert>}
    {rows.length === 0 ? <p className="py-4 text-[13px] text-faint">No tasks in this queue.</p> : <div className="divide-y divide-line">
      {rows.map(t => {
        const blocked = queue === 'released' && (t.status === 'done' || (project.has_qa && stageIndex(t.status, t.stage, stagesOf(project.stages).length) >= qaStageIndex(project.stages, project.qa_stage)))
        return <div key={t.id} className="grid items-center gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,240px)_auto]">
          <div className="flex min-w-0 items-start gap-3">
            <input type="checkbox" aria-label={`Select ${t.title}`} checked={Boolean(selected[t.id])} disabled={!editable || blocked} onChange={e => setSelected(previous => { const next = { ...previous }; if (e.target.checked) next[t.id] = t; else delete next[t.id]; return next })} className="mt-1 size-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <button type="button" onClick={() => onOpenTask?.(t.id)} className="text-left text-[14px] font-medium break-words text-ink hover:underline">{t.title}</button>
              {t.reviewer_id && <p className="text-[12px] text-muted">{t.reviewer_id === state.viewerId ? 'Assigned to you' : `Reviewer: ${state.nameOf(t.reviewer_id)}`}</p>}
              {blocked && <p className="text-[12px] text-muted">Reopen work in QA or Done before rerouting.</p>}
            </div>
          </div>
          <Select aria-label={`Team for ${t.title}`} value={teams[t.id] ?? t.team_id ?? ''} disabled={!editable || blocked} placeholder="Choose a team with a lead" options={destinations} onChange={e => setTeams(previous => ({ ...previous, [t.id]: e.target.value }))} className="!h-10 !text-[13px]" />
          {queue === 'coordinator_review' && t.reviewer_id === state.viewerId && <Button size="sm" variant="outline" disabled={!editable} onClick={() => { setReason(''); setReturning(t.id) }}>Return to planning</Button>}
        </div>
      })}
    </div>}
    {rows.length > 0 && <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <span className="text-[13px] text-muted">{picks.length} selected</span>
      <Button size="sm" disabled={!editable || !ready} onClick={() => { if (queue === 'released') { setReason(''); setRerouting(true) } else void send() }}>Send to team</Button>
      {queue === 'planning' && state.myRole === 'pm' && <>
        <div className="w-full sm:w-56"><Select aria-label="Coordinator" value={coordinator} disabled={!editable} placeholder="Choose a coordinator" options={state.members.filter(m => m.role === 'coordinator' && m.profile?.status === 'active').map(m => ({ value: m.user_id, label: state.nameOf(m.user_id) }))} onChange={e => setCoordinator(e.target.value)} className="!h-10 !text-[13px]" /></div>
        <Button size="sm" variant="outline" disabled={!editable || !picks.length || !coordinator} onClick={() => void act(() => sendTasksToCoordinator(project.id, picks.map(t => ({ id: t.id, updated_at: t.updated_at })), coordinator))}>Send for review</Button>
      </>}
    </div>}
    <Modal open={Boolean(returning) || rerouting} title={rerouting ? 'Reroute released work' : 'Return to planning'} onClose={() => { if (!busy) { setReturning(null); setRerouting(false) } }} footer={<Button disabled={!editable || !reason.trim()} onClick={() => { if (rerouting) void send(); else if (returning) void act(() => returnWorkTask(returning, reason.trim())) }}>{rerouting ? 'Confirm reroute' : 'Confirm return'}</Button>}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error} <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Reload tasks</Button></Alert>}
        {rerouting && <><p className="text-[13px] text-muted">Sending clears the current holders. The new lead assigns the work. Stage, files, comments and history stay attached.</p><ul className="space-y-2 text-[13px] text-ink">{picks.map(t => <li key={t.id}>{t.title}: {state.teams.find(team => team.id === t.team_id)?.name ?? 'No team'} to {state.teams.find(team => team.id === (teams[t.id] ?? t.team_id))?.name}. Holders to clear: {t.assignee_ids.map(state.nameOf).join(', ') || 'Nobody'}.</li>)}</ul></>}
        <label className="block space-y-2 text-[13px] text-ink"><span>Reason</span><Textarea aria-label="Reason" value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      </div>
    </Modal>
  </section>
}
