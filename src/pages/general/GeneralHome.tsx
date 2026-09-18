import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { NewProjectDialog } from '../../components/general/NewProjectDialog'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Input } from '../../components/ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import {
  joinGeneralProject,
  listMyGeneralProjects,
  listMyInvitations,
  respondToInvitation,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralProjectSummary, GeneralStatus, MyInvitation } from '../../lib/general/types'
import { fullName } from '../../lib/types'

/**
 * The General workplace's front door: what is waiting on you, then what you
 * are part of.
 *
 * Invitations come first because they are the only thing here that needs an
 * answer, and until they are answered the projects behind them are not yours
 * to open.
 */
export default function GeneralHome() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [invitations, setInvitations] = useState<MyInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [answering, setAnswering] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    document.title = 'General · Collabify'
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const [p, i] = await Promise.all([listMyGeneralProjects(), listMyInvitations(profile.id)])
      setProjects(p)
      setInvitations(i)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your projects.'))
      setProjects((prev) => prev ?? [])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_projects', 'general_members', 'general_invitations', 'general_tasks'])

  async function answer(inv: MyInvitation, accept: boolean) {
    setAnswering(inv.id)
    try {
      await respondToInvitation(inv.id, accept)
      show(accept ? `You joined ${inv.project?.name ?? 'the project'}` : 'Invitation declined')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  const all = useMemo(() => projects ?? [], [projects])
  const live = all.filter((p) => !p.archived_at)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((p) => (showArchived ? true : !p.archived_at))
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [all, query, status, showArchived])

  return (
    <div className="w-full">
      <DirectoryHero
        title="Run any project"
        accent="with your people."
        description="School events, committees, research, outreach and anything else. You decide the fields, the teams and who holds which position."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={17} />
              New project
            </Button>
            <Button variant="onNavy" onClick={() => setJoinOpen(true)}>
              Join with a code
            </Button>
          </div>
        }
        stats={[
          { value: projects === null ? '—' : live.length, label: 'Projects' },
          { value: invitations.length, label: 'Invitations' },
        ]}
      />

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {invitations.length > 0 && (
          <section className="overflow-hidden rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
            <header className="flex items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
              <div>
                <h2>Invitations</h2>
                <p className="mt-0.5 text-[12px] text-muted">Projects waiting for your answer.</p>
              </div>
              <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
                {invitations.length}
              </span>
            </header>
            <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                  {inv.inviter && <Avatar profile={inv.inviter} size={34} />}
                  <div className="min-w-[14rem] flex-1">
                    <p className="text-[14px] font-medium text-ink">{inv.project?.name ?? 'A project'}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {inv.inviter ? `${fullName(inv.inviter)} invited you` : 'You were invited'}
                      {inv.project?.description ? ` · ${inv.project.description.slice(0, 90)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={answering === inv.id}
                      onClick={() => void answer(inv, false)}
                    >
                      Decline
                    </Button>
                    <Button size="sm" loading={answering === inv.id} onClick={() => void answer(inv, true)}>
                      <Icon name="check" size={14} />
                      Join
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {projects === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon="kanban"
            title="No projects yet"
            body="Create one for anything you are running, or join one with a code somebody shared with you."
            action={
              <Button onClick={() => setNewOpen(true)} className="!rounded-xl">
                New project
              </Button>
            }
          />
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto">Your projects</h2>
              <FilterPopover
                align="right"
                label="Filter projects"
                active={[query.trim(), status, showArchived].filter(Boolean).length}
                summary={[
                  query.trim() && `“${query.trim()}”`,
                  status && projectStatusLabel(status),
                  showArchived && 'Including archived',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={() => {
                  setQuery('')
                  setStatus('')
                  setShowArchived(false)
                }}
              >
                <FilterField label="Search">
                  <FilterSearch value={query} onChange={setQuery} placeholder="Name or description" />
                </FilterField>
                <FilterField label="Status">
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as GeneralStatus | '')}
                    placeholder="Any status"
                    options={PROJECT_STATUSES}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Include archived projects
                </label>
              </FilterPopover>
            </div>

            {shown.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matches"
                body="No project fits these filters. Clear them to see everything you are on."
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <JoinDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  )
}

function ProjectCard({ project: p }: { project: GeneralProjectSummary }) {
  const pct = Number(p.progress_pct)
  return (
    <Link
      to={`/general/projects/${p.id}`}
      className="group flex flex-col rounded-card border border-line bg-[var(--surface)] p-4 transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 leading-snug group-hover:underline">{p.name}</h3>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {p.archived_at ? 'Archived' : projectStatusLabel(p.status)}
        </span>
      </div>
      {p.description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{p.description}</p>
      )}
      <p className="mt-3 text-[12px] text-faint">{dateRange(p.starts_on, p.ends_on)}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted">
            {p.done_count}/{p.task_count} tasks done
          </span>
          <span className="font-mono text-faint">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="users" size={14} />
          {p.member_count} {p.member_count === 1 ? 'member' : 'members'}
        </span>
        <span className="text-faint">·</span>
        <span>You are {levelLabel(p.my_level)}</span>
        {p.my_level === 'owner' && p.open_request_count > 0 && (
          <span className="ml-auto rounded-full bg-amber-400/25 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
            {p.open_request_count} access {p.open_request_count === 1 ? 'request' : 'requests'}
          </span>
        )}
      </div>
    </Link>
  )
}

function JoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const projectId = await joinGeneralProject(code)
      onClose()
      setCode('')
      navigate(`/general/projects/${projectId}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not join with that code.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join with a code"
      description="Whoever runs the project can give you its eight-character code."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="join-general-project" loading={busy} disabled={code.trim().length < 8}>
            Join
          </Button>
        </>
      }
    >
      <form id="join-general-project" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Code">
          {(id) => (
            <Input
              id={id}
              required
              autoComplete="off"
              maxLength={8}
              placeholder="ABCD2345"
              className="font-mono uppercase tracking-[0.2em]"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
