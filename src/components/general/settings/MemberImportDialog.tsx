import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../../app/Avatar'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { Select } from '../../ui/Select'
import { applyMemberImport, listArchivedTeams, listGeneralMembers, listMemberSkills, listPositionHolders, listPositions, listTeamMembers, listTeams } from '../../../lib/api/general'
import { extractMemberRoster } from '../../../lib/api/workAi'
import { authErrorMessage } from '../../../lib/authError'
import { previewMemberImport, resolveMemberImport, type ImportCurrent, type ImportPreview } from '../../../lib/general/memberImport'
import { readMemberImportFile, type RosterRow } from '../../../lib/general/memberImportFile'
import { fullName } from '../../../lib/types'
import { ROLE_LABEL } from '../../../lib/general/permissions'
import type { GeneralMember } from '../../../lib/general/types'
import type { GeneralProjectState } from '../useGeneralProject'

type Current = Omit<ImportCurrent, 'members'> & { members: GeneralMember[] }

async function loadCurrent(projectId: string): Promise<Current> {
  const [members, active, archived, teamMembers, positions, holders, skills] = await Promise.all([
    listGeneralMembers(projectId), listTeams(projectId), listArchivedTeams(projectId), listTeamMembers(projectId),
    listPositions(projectId), listPositionHolders(projectId), listMemberSkills(projectId),
  ])
  return { members, teams: [...active, ...archived], teamMembers, positions, holders, skills }
}

const rosterOf = (current: Current) => current.members.filter(m => m.profile).map(m => ({ userId: m.user_id, name: fullName(m.profile!) }))
const positionNames = (positions: ImportPreview['newPositions']) => positions.map(p => `${p.team || 'Project-wide'} / ${p.name}`).join(', ') || 'None'
const countValues = (values: ImportPreview['members'][number]['current']) => values.teams.length + values.positions.length + values.skills.length

function Values({ values }: { values: ImportPreview['members'][number]['current'] }) {
  return <dl className="space-y-1 break-words text-[13px]">
    <div><dt className="inline text-muted">Teams: </dt><dd className="inline">{values.teams.join(', ') || 'None'}</dd></div>
    <div><dt className="inline text-muted">Positions: </dt><dd className="inline">{positionNames(values.positions)}</dd></div>
    <div><dt className="inline text-muted">Skills: </dt><dd className="inline">{values.skills.join(', ') || 'None'}</dd></div>
  </dl>
}

export function MemberImportDialog({ state, onClose }: { state: GeneralProjectState; onClose: () => void }) {
  const projectId = state.project!.id
  const [rows, setRows] = useState<RosterRow[]>([])
  const [current, setCurrent] = useState<Current | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [excluded, setExcluded] = useState(new Set<string>())
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'read' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])

  const resolution = current && rows.length ? resolveMemberImport(rows, rosterOf(current), choices) : null
  const duplicateRows = current && rows.length ? resolveMemberImport(rows, rosterOf(current), {}).ambiguous : []
  const resolved = resolution && !resolution.unknown.length && !resolution.ambiguous.length && !resolution.conflicts.length
  const preview = resolved ? previewMemberImport(mode, resolution.resolved, current!, excluded) : null

  async function upload(file: File) {
    const token = ++generation.current
    setRows([]); setCurrent(null); setChoices({}); setExcluded(new Set()); setConfirmed(false); setError(null); setBusy('read')
    try {
      const source = await readMemberImportFile(file)
      if (token !== generation.current) return
      const result = await extractMemberRoster(projectId, source)
      if (token !== generation.current) return
      if (result.result === 'failed') throw new Error(result.message)
      if (!result.rows.length) throw new Error('No member rows were found. Upload another roster.')
      const fresh = await loadCurrent(projectId)
      if (token !== generation.current) return
      setCurrent(fresh); setRows(result.rows)
    } catch (err) {
      if (token === generation.current) setError(authErrorMessage(err, 'Could not read the roster. Upload another file.'))
    } finally {
      if (token === generation.current) setBusy(null)
    }
  }

  async function apply() {
    if (!preview || preview.blockers.length || !preview.rows.length || !confirmed || busy) return
    setBusy('apply'); setError(null)
    try {
      const fresh = await loadCurrent(projectId)
      const freshResolution = resolveMemberImport(rows, rosterOf(fresh), choices)
      const freshPreview = previewMemberImport(mode, freshResolution.resolved, fresh, excluded)
      if (freshResolution.unknown.length || freshResolution.ambiguous.length || freshResolution.conflicts.length ||
        JSON.stringify(freshResolution.resolved) !== JSON.stringify(resolution!.resolved) ||
        JSON.stringify(freshPreview.expected) !== JSON.stringify(preview.expected)) {
        setCurrent(fresh); setConfirmed(false)
        setError('Project members or structure changed. Review the refreshed changes before applying.')
        return
      }
      await applyMemberImport(projectId, mode, preview)
      await state.reload()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not apply the import. Review the draft and try again.'))
    } finally {
      setBusy(null)
    }
  }

  const additions = preview?.members.reduce((n, m) => n + countValues(m.additions), 0) ?? 0
  const removals = preview?.members.reduce((n, m) => n + countValues(m.removals), 0) ?? 0
  const changed = preview?.members.filter(m => countValues(m.additions) + countValues(m.removals)).length ?? 0

  return <Modal open onClose={() => { if (busy !== 'apply') onClose() }} title="Set up members from file" size="xl">
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-[13px] text-muted">Upload a .docx, .xlsx or PDF roster, up to 5 MB and 100 members. Its contents will be processed by the project's AI service. The file stays temporary and is not saved to project files.</p>
        <label className="block text-[13px] font-medium">Roster file
          <input type="file" accept=".docx,.xlsx,.pdf" disabled={!!busy} className="mt-2 block w-full rounded-xl border border-line p-3 text-[13px]" onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void upload(file)
          }} />
        </label>
        {busy === 'read' && <p role="status" className="text-[13px] text-muted">Reading the roster…</p>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!!resolution?.unknown.length && <Alert tone="error">{resolution.unknown.map(row => `${row.name} (${row.source})`).join(', ')}: Remove these names from the file or invite them to the project first, then upload again. No assignment draft is available.</Alert>}
      {resolution?.conflicts.map(message => <Alert key={message} tone="error">{message}</Alert>)}
      {duplicateRows.map(item => <fieldset key={item.row} className="space-y-2 text-[13px]" disabled={!!busy}>
        <legend>{rows[item.row].name} ({rows[item.row].source}): Choose the project member</legend>
        <p className="text-muted">If you cannot identify the person, stop and check the project roster before choosing.</p>
        {item.candidates.map(id => {
          const member = current!.members.find(m => m.user_id === id)!
          return <label key={id} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <input type="radio" name={`member-row-${item.row}`} value={id} checked={choices[item.row] === id} onChange={() => { setChoices({ ...choices, [item.row]: id }); setConfirmed(false) }} />
            <Avatar profile={member.profile!} size={32} />
            <span className="min-w-0 break-words"><span className="block font-medium">{fullName(member.profile!)}</span>
              <span className="text-muted">{ROLE_LABEL[member.role]} · Joined {new Date(member.joined_at).toLocaleDateString('en', { dateStyle: 'medium' })} · {id.slice(-8)}</span>
            </span>
          </label>
        })}
      </fieldset>)}
      {preview && <>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-center">
          <label className="space-y-2 text-[13px] font-medium"><span>Import mode</span><Select aria-label="Import mode" value={mode} disabled={!!busy} options={[{ value: 'add', label: 'Add' }, { value: 'replace', label: 'Replace' }]} onChange={event => { setMode(event.target.value as 'add' | 'replace'); setConfirmed(false) }} /></label>
          <p className="text-[13px] text-muted">Add keeps current values and adds the file's values. Replace sets each stated field to the file's values. Blank fields stay unchanged. People absent from the file stay unchanged. Team leaders, roles, grants and tasks stay unchanged.</p>
        </div>
        {preview.blockers.map(message => <Alert tone="error" key={message}>{message}</Alert>)}
        <div className="rounded-xl border border-line bg-[var(--surface-sunken)] p-4 text-[13px] space-y-1">
          <p>{changed} changed member{changed === 1 ? '' : 's'} · {additions} addition{additions === 1 ? '' : 's'} · {removals} removal{removals === 1 ? '' : 's'}</p>
          <p>New teams: {preview.newTeams.join(', ') || 'None'}</p>
          <p>New positions: {positionNames(preview.newPositions)}</p>
          <p>Excluded: {resolution!.resolved.filter(row => excluded.has(row.userId)).map(row => row.name).join(', ') || 'None'}</p>
        </div>
        <div className="space-y-4">
          {resolution!.resolved.map(row => {
            const member = preview.members.find(m => m.userId === row.userId)
            return <section key={row.userId} className="rounded-xl border border-line p-4 space-y-3">
              <label className="flex items-center gap-2 text-[14px] font-medium"><input type="checkbox" aria-label={`Include ${row.name}`} disabled={!!busy} checked={!excluded.has(row.userId)} onChange={() => { const next = new Set(excluded); if (next.has(row.userId)) next.delete(row.userId); else next.add(row.userId); setExcluded(next); setConfirmed(false) }} />{row.name}</label>
              <p className="text-[12px] text-muted break-words">{row.sources.join(' · ')}</p>
              {member && <div className="grid gap-4 md:grid-cols-2">
                {(['Current', 'Proposed', 'Additions', 'Removals'] as const).map((label, i) => <div key={label} className="min-w-0 space-y-1"><h3 className="text-[13px] font-medium">{label}</h3><Values values={[member.current, member.proposed, member.additions, member.removals][i]} /></div>)}
              </div>}
            </section>
          })}
        </div>
        <label className="flex items-start gap-2 text-[13px]"><input className="mt-1" type="checkbox" aria-label="I reviewed these changes" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} />I reviewed these changes, including additions and removals.</label>
        <div className="flex justify-end"><Button disabled={!confirmed || !!preview.blockers.length || !preview.rows.length} loading={busy === 'apply'} onClick={() => void apply()}>Apply</Button></div>
      </>}
    </div>
  </Modal>
}
