// src/pages/general/GeneralProject.tsx
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { MembersTab } from '../../components/general/MembersTab'
import { OverviewTab } from '../../components/general/OverviewTab'
import { DocsTab } from '../../components/general/DocsTab'
import { RepoTab } from '../../components/general/RepoTab'
import { TasksTab } from '../../components/general/TasksTab'
import { useGeneralProject } from '../../components/general/useGeneralProject'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { archiveGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { projectStatusLabel } from '../../lib/general/types'

type TabId = 'overview' | 'tasks' | 'docs' | 'repo' | 'members'

export default function GeneralProject() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const state = useGeneralProject(projectId, profile?.id)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<TabId>(() =>
    params.has('task')
      ? 'tasks'
      : params.get('tab') === 'members'
        ? 'members'
        : params.get('tab') === 'docs'
          ? 'docs'
          : params.get('tab') === 'repo'
            ? 'repo'
            : 'overview',
  )
  const [archiving, setArchiving] = useState(false)

  const p = state.project
  useEffect(() => {
    document.title = `${p?.name ?? 'Project'} · Collabify`
  }, [p?.name])

  if (state.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the project…
      </div>
    )
  }

  // Only `missing` means it is not there. Anything else that left us without a
  // project is a failure to load, and it has a message worth reading.
  if (state.error && !p) {
    return (
      <div className="py-6">
        <Alert tone="error" onRetry={() => void state.reload()}>
          {state.error}
        </Alert>
      </div>
    )
  }

  if (state.missing || !p) {
    return (
      <EmptyState
        icon="kanban"
        title="Project not found"
        body="It does not exist, or you are not on it. Ask whoever runs it for an invitation or its join code."
        action={
          <Link to="/general" className="text-[14px] font-medium text-navy-600 hover:underline dark:text-navy-200">
            Back to your projects
          </Link>
        }
      />
    )
  }

  const openForOwner = state.isOwner ? state.requests.filter((r) => r.status === 'open').length : 0

  async function restore() {
    if (!p) return
    try {
      await archiveGeneralProject(p.id, false)
      show('Project restored')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not restore the project.'), 'error')
    }
  }

  return (
    <div className="w-full space-y-6">
      <Link to="/general" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <Icon name="arrowLeft" size={14} />
        All projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
              {p.archived_at ? 'Archived' : projectStatusLabel(p.status)}
            </span>
            <span className="rounded-md bg-navy-500/10 px-2 py-0.5 text-[12px] text-navy-700 dark:text-navy-200">
              You are {levelLabel(p.my_level)}
            </span>
          </div>
          <h1 className="mt-2 font-display break-words">{p.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {dateRange(p.starts_on, p.ends_on)} · {p.member_count}{' '}
            {p.member_count === 1 ? 'member' : 'members'} · {Number(p.progress_pct)}% done
          </p>
        </div>
        {state.isOwner && !state.archived && (
          <Button variant="outline" size="sm" onClick={() => setArchiving(true)}>
            <Icon name="archive" size={15} />
            Archive
          </Button>
        )}
      </header>

      {state.error && <Alert tone="error">{state.error}</Alert>}

      {state.archived && (
        <Alert tone="info">
          This project is archived, so nothing in it can change.
          {state.isOwner && (
            <>
              {' '}
              <button type="button" onClick={() => void restore()} className="font-medium underline">
                Restore it
              </button>{' '}
              to make changes again.
            </>
          )}
        </Alert>
      )}

      <Tabs<TabId>
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'file' },
          { id: 'tasks', label: 'Tasks', icon: 'check', count: state.tasks.length },
          { id: 'docs', label: 'Documents', icon: 'file' },
          { id: 'repo', label: 'Code', icon: 'folder' },
          {
            id: 'members',
            label: 'Members',
            icon: 'users',
            count: openForOwner > 0 ? openForOwner : state.members.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab state={state} />}
      {tab === 'tasks' && <TasksTab state={state} />}
      {tab === 'docs' && <DocsTab state={state} />}
      {tab === 'repo' && <RepoTab state={state} />}
      {tab === 'members' && <MembersTab state={state} />}

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={async () => {
          await archiveGeneralProject(p.id, true)
          show('Project archived')
          await state.reload()
        }}
        title={`Archive ${p.name}?`}
        body="Nothing in it can change until an Owner restores it, and its join code closes. Everyone on it can still read it."
        confirmLabel="Archive project"
        tone="primary"
      />
    </div>
  )
}
