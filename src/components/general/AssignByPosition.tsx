import { useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { KeepBox } from './TasksFromNotes'
import { assignTask, listTasks, updateTask } from '../../lib/api/general'
import { draftTeamRoutes, draftLeadAssignees, type AssignPickOut } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { isAssignCandidate, reasonText, skippedMessage } from '../../lib/work/assignDraft'
import type { GeneralProjectState } from './useGeneralProject'

type Row = AssignPickOut & { keep: boolean; people: string[]; teamEdited?: boolean }
export function AssignByPosition({ state, open, onClose, mode = 'route' }: { state: GeneralProjectState; open: boolean; onClose: () => void; mode?: 'route' | 'lead' }) {
  const { show } = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const run = useRef(0)
  const started = useRef(false)
  const projectId = state.project?.id
  async function draft() {
    if (!projectId || state.readOnly) return
    const id = ++run.current
    setBusy(true); setError(null); setRows([]); setNote('')
    try {
      const res = await (mode === 'route' ? draftTeamRoutes : draftLeadAssignees)(projectId)
      if (id !== run.current) return
      if (res.result !== 'ok') { setError(res.message); return }
      setRows(res.picks.map(p => ({ ...p, keep: true, people: p.userId ? [p.userId] : [] })))
      setNote(res.empty === 'no_structure' ? 'Add positions or skills on the Members tab first.' : res.empty === 'no_tasks' ? 'No eligible tasks in this queue.' : res.left ? res.left + ' more tasks remain for the next run.' : '')
    } catch (err) { if (id === run.current) setError(authErrorMessage(err, 'Could not suggest assignments. Try again.')) }
    finally { if (id === run.current) setBusy(false) }
  }
  useEffect(() => {
    if (!open) { run.current++; started.current = false; setRows([]); setError(null); setBusy(false); return }
    if (started.current) return
    started.current = true
    void draft()
    // A modal opening spends one AI call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  function patch(key: string, next: Partial<Row>) { setRows(list => list.map(r => r.key === key ? { ...r, ...next } : r)) }
  async function save() {
    if (!projectId || state.readOnly || saving) return
    setSaving(true); setError(null)
    try {
      const current = await listTasks(projectId)
      let skipped = 0
      for (const row of rows.filter(r => r.keep)) {
        const task = current.find(t => t.id === row.key)
        if (!task || task.archived_at || task.status === 'done' || task.assignee_ids.length ||
          (mode === 'route' ? !['planning', 'coordinator_review'].includes(task.routing_state ?? '') : task.routing_state !== 'released')) { skipped++; continue }
        if (mode === 'route') {
          if ((row.teamId || row.teamEdited) && row.teamId !== task.team_id) await updateTask(task.id, { team_id: row.teamId ?? null })
        } else {
          for (const userId of row.people) await assignTask(task.id, projectId, userId)
        }
      }
      await state.reload()
      show((mode === 'route' ? 'Team choices saved. Use Send to team when ready.' : 'Assignments saved.') + ' ' + skippedMessage(skipped))
      onClose()
    } catch (err) {
      await state.reload()
      setError(authErrorMessage(err, 'Some choices could not be saved. Reload tasks and review again.'))
    } finally { setSaving(false) }
  }
  const changes = rows.some(r => r.keep && (mode === 'route' ? r.teamId || r.teamEdited : r.people.length))
  return <Modal open={open} onClose={() => { if (!saving) onClose() }} title="Assign by position" size="lg"
    description={mode === 'route' ? 'Review destination teams for planning work. Saving does not send tasks.' : 'Review members of each receiving team. Nothing is assigned until you save.'}
    footer={<><Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={state.readOnly || busy || !changes} loading={saving} onClick={() => void save()}>{mode === 'route' ? 'Save team choices' : 'Save assignments'}</Button></>}>
    <div className="space-y-4">
      {error && <Alert tone="error">{error}<Button variant="ghost" disabled={busy || saving} onClick={() => void draft()}>Review again</Button></Alert>}
      {busy && <p className="text-[14px] text-muted">Matching tasks to positions…</p>}
      {note && <p className="text-[13px] text-muted">{note}</p>}
      <ul className="space-y-3">{rows.map(row => {
        const task = state.tasks.find(t => t.id === row.key)
        const candidates = state.members.filter(m => isAssignCandidate(m) && m.profile?.status === 'active' && state.teamMembers.some(tm => tm.team_id === task?.team_id && tm.user_id === m.user_id))
        return <li key={row.key} className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex items-center gap-3"><KeepBox checked={row.keep} label={'Keep ' + row.title} onToggle={() => { if (!saving) patch(row.key, { keep: !row.keep }) }} /><span className="text-[14px] text-ink">{row.title}</span></div>
          {mode === 'route' ? <Select aria-label={'Team for ' + row.title} disabled={saving} value={row.teamId ?? ''} placeholder="Choose a team" options={state.teams.map(t => ({ value: t.id, label: t.name }))} onChange={e => patch(row.key, { teamId: e.target.value || null, teamEdited: true })} /> : <Select aria-label={'Member for ' + row.title} disabled={saving} value={row.people[0] ?? ''} placeholder="Choose a member" options={candidates.map(m => ({ value: m.user_id, label: state.nameOf(m.user_id) }))} onChange={e => patch(row.key, { people: e.target.value ? [e.target.value] : [] })} />}
          <p className="text-[12px] text-muted">{reasonText(row)}</p>
        </li>
      })}</ul>
    </div>
  </Modal>
}
