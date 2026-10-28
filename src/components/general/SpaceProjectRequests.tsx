import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { canManageProjects } from '../../lib/access'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { listSpaceMembers } from '../../lib/api/spaces'
import type { SpacePerson } from '../../lib/general/types'
import {
  createProjectRequest, editProjectRequest, listProjectRequestMessages,
  listProjectRequests, postProjectRequestMessage, setProjectRequestStatus,
} from '../../lib/api/projectRequests'
import type { ProjectRequest, ProjectRequestMessage } from '../../lib/api/projectRequests'

export function SpaceProjectRequests({ spaceId, onCreateProject }: { spaceId: string; onCreateProject: (request: ProjectRequest) => void }) {
  const { user, profile } = useAuth()
  const { currentSpace } = useGeneralNavigation()
  const [requests, setRequests] = useState<ProjectRequest[] | null>(null)
  const [people, setPeople] = useState<SpacePerson[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ProjectRequestMessage[]>([])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<ProjectRequest | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [outcome, setOutcome] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const manager = Boolean(currentSpace?.id === spaceId && !currentSpace.archived_at && ['owner', 'manager'].includes(currentSpace.my_level ?? '') && canManageProjects(profile))
  const activeSpace = Boolean(currentSpace?.id === spaceId && currentSpace.my_level && !currentSpace.archived_at)
  const selected = requests?.find((r) => r.id === selectedId) ?? null

  const load = useCallback(async () => {
    try {
      const [next, members] = await Promise.all([listProjectRequests(spaceId), listSpaceMembers(spaceId).catch(() => [] as SpacePerson[])])
      setRequests(next)
      setPeople(members)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load requests.'))
      setRequests([])
    }
  }, [spaceId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selectedId) { setMessages([]); return }
    let alive = true
    void listProjectRequestMessages(selectedId)
      .then((rows) => { if (alive) setMessages(rows) })
      .catch((err) => { if (alive) setError(authErrorMessage(err, 'Could not load discussion.')) })
    return () => { alive = false }
  }, [selectedId])

  function person(id: string) {
    const member = people.find((p) => p.user_id === id)
    return member ? `${member.first_name} ${member.last_name}`.trim() : 'Space member'
  }

  function openEditor(request: ProjectRequest | 'new') {
    setEditing(request)
    setTitle(request === 'new' ? '' : request.title)
    setBrief(request === 'new' ? '' : request.brief)
    setOutcome(request === 'new' ? '' : request.desired_outcome)
    setTargetDate(request === 'new' ? '' : request.target_date ?? '')
    setError(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    try {
      const input = { title: title.trim(), brief: brief.trim(), outcome: outcome.trim(), targetDate: targetDate || null }
      const id = editing === 'new'
        ? await createProjectRequest({ spaceId, ...input })
        : (await editProjectRequest({ id: editing.id, ...input }), editing.id)
      setEditing(null)
      await load()
      setSelectedId(id)
    } catch (err) { setError(authErrorMessage(err, 'Could not save the request.')) }
    finally { setBusy(false) }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!selected || !draft.trim()) return
    setBusy(true)
    try {
      await postProjectRequestMessage(selected.id, draft.trim())
      setDraft('')
      setMessages(await listProjectRequestMessages(selected.id))
      setError(null)
    } catch (err) { setError(authErrorMessage(err, 'Could not send the message.')) }
    finally { setBusy(false) }
  }

  async function changeStatus(status: 'ready' | 'closed') {
    if (!selected) return
    setBusy(true)
    try {
      await setProjectRequestStatus(selected.id, status)
      setRequests((rows) => rows?.map((r) => r.id === selected.id ? { ...r, status } : r) ?? [])
      setError(null)
    } catch (err) { setError(authErrorMessage(err, 'Could not update the request.')) }
    finally { setBusy(false) }
  }

  async function refresh() {
    await load()
    if (!selectedId) return
    try { setMessages(await listProjectRequestMessages(selectedId)) }
    catch (err) { setError(authErrorMessage(err, 'Could not load discussion.')) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto"><h2>Project requests</h2><p className="text-[13px] text-muted">Private to the requester and Space managers.</p></div>
        <Button variant="ghost" onClick={() => void refresh()}>Refresh</Button>
        {activeSpace && <Button onClick={() => openEditor('new')}>New request</Button>}
      </div>
      {error && <Alert tone="error" onRetry={() => void load()}>{error}</Alert>}
      {requests === null ? <p className="py-8 text-[14px] text-muted">Loading requests…</p> : requests.length === 0 ? (
        <EmptyState icon="kanban" title="No requests yet" body="Start a request to discuss a project before it is created." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(230px,1fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            {requests.map((request) => <button key={request.id} type="button" onClick={() => setSelectedId(request.id)}
              className={`w-full rounded-xl border p-4 text-left transition-colors hover:bg-[var(--surface-sunken)] ${selectedId === request.id ? 'border-navy-600 dark:border-amber-400' : 'border-line'}`}>
              <span className="block font-medium text-ink">{request.title}</span>
              <span className="mt-1 block text-[12px] text-muted">{person(request.author_id)} · {request.status}</span>
              {request.target_date && <span className="mt-1 block text-[12px] text-muted">Target {request.target_date}</span>}
            </button>)}
          </div>
          {selected && <section className="rounded-xl border border-line p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="mr-auto"><h3 className="font-semibold text-ink">{selected.title}</h3><p className="text-[12px] text-muted">Requested by {person(selected.author_id)} · {selected.status}</p></div>
              {selected.author_id === user?.id && selected.status === 'open' && activeSpace && <Button variant="ghost" onClick={() => openEditor(selected)}>Edit brief</Button>}
              {manager && selected.status === 'open' && <Button variant="ghost" disabled={busy} onClick={() => void changeStatus('ready')}>Mark ready</Button>}
              {manager && ['open', 'ready'].includes(selected.status) && <Button variant="ghost" disabled={busy} onClick={() => void changeStatus('closed')}>Close request</Button>}
              {manager && selected.status === 'ready' && <Button onClick={() => onCreateProject(selected)}>Create project</Button>}
            </div>
            <dl className="mt-5 space-y-4 text-[14px]"><div><dt className="text-[12px] font-medium text-muted">Brief</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{selected.brief}</dd></div><div><dt className="text-[12px] font-medium text-muted">Desired outcome</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{selected.desired_outcome}</dd></div>{selected.target_date && <div><dt className="text-[12px] font-medium text-muted">Target date</dt><dd className="mt-1 text-ink">{selected.target_date}</dd></div>}</dl>
            <div className="mt-6 border-t border-line pt-4"><h4 className="font-medium text-ink">Discussion</h4><div className="mt-3 space-y-3">{messages.length === 0 && <p className="text-[13px] text-muted">No messages yet.</p>}{messages.map((message) => <article key={message.id} className="rounded-xl surface-sunken p-3"><p className="text-[12px] font-medium text-muted">{person(message.author_id)}</p><p className="mt-1 whitespace-pre-wrap text-[14px] text-ink">{message.body}</p></article>)}</div>
              {activeSpace && ['open', 'ready'].includes(selected.status) && <form onSubmit={send} className="mt-4 space-y-2"><Textarea aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} rows={3} placeholder="Add to the discussion" /><Button type="submit" disabled={!draft.trim()} loading={busy}>Send message</Button></form>}
            </div>
          </section>}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New project request' : 'Edit project request'} description="Only you and Space managers can read this request." focusField footer={<><Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button type="submit" form="project-request-form" loading={busy}>Save request</Button></>}>
        <form id="project-request-form" onSubmit={save} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Title">{(id) => <Input id={id} required maxLength={LIMIT.generalName} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Brief">{(id) => <Textarea id={id} required rows={5} maxLength={LIMIT.generalDescription} value={brief} onChange={(e) => setBrief(e.target.value)} />}</Field>
          <Field label="Desired outcome">{(id) => <Textarea id={id} required rows={3} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)} />}</Field>
          <Field label="Target date" optional>{(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}</Field>
        </form>
      </Modal>
    </div>
  )
}
