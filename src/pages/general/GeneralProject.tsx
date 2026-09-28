// src/pages/general/GeneralProject.tsx
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { MembersTab } from '../../components/general/MembersTab'
import { OverviewTab } from '../../components/general/OverviewTab'
import { FilesTab } from '../../components/general/FilesTab'
import { ProgressTab } from '../../components/general/ProgressTab'
import { TasksTab } from '../../components/general/TasksTab'
import { SinceLastVisit } from '../../components/general/SinceLastVisit'
import { SaveTemplateButton } from '../../components/general/SaveTemplateButton'
import { useGeneralProject } from '../../components/general/useGeneralProject'
import { Alert } from '../../components/ui/Alert'
import { Button, ButtonLink, buttonClass } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { archiveGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { generalTab } from '../../lib/general/navigation'
import type { GeneralTabId } from '../../lib/general/navigation'
import { levelLabel } from '../../lib/general/permissions'
import { projectStatusLabel } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export default function GeneralProject() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const { currentSpace, reportProjectSpace } = useGeneralNavigation()
  const state = useGeneralProject(projectId, profile?.id)
  const [params, setParams] = useSearchParams()
  const tab = generalTab(params)
  const [archiving, setArchiving] = useState(false)

  function changeTab(next: GeneralTabId) {
    const changed = new URLSearchParams(params)
    if (next === 'overview') changed.delete('tab')
    else changed.set('tab', next)
    if (next !== 'tasks' && params.has('task')) {
      changed.delete('task')
    }
    setParams(changed)
  }

  const p = state.project
  useEffect(() => {
    document.title = `${p?.name ?? 'Project'} · Collabify`
  }, [p?.name])

  useEffect(() => {
    if (projectId && p?.id === projectId) reportProjectSpace(projectId, p.space_id)
  }, [p?.id, p?.space_id, projectId, reportProjectSpace])

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

  // A class board's Files project is only ever opened from its class project.
  if (p?.preset === 'class-board') return <Navigate to={paths.classProjects} replace />

  if (state.missing || !p) {
    return (
      <EmptyState
        icon="kanban"
        title="Project not found"
        body="It was deleted or archived, or you are not on it. Ask whoever runs it for an invitation or its join code."
        action={
          <Link to={paths.projects} className="text-[14px] font-medium text-navy-600 hover:underline dark:text-navy-200">
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
      <Link
        // Straight to the projects list when the space is not the reader's to
        // read, which is the case for anybody who joined this project by code.
        to={currentSpace?.id === p.space_id ? paths.space(p.space_id) : paths.projects}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon name="arrowLeft" size={14} />
        All projects
      </Link>

      <DirectoryHero
        title={p.name}
        accent={p.archived_at ? 'archived.' : 'project.'}
        description={`${projectStatusLabel(p.status)} · You are ${levelLabel(p.my_level)} · ${dateRange(p.starts_on, p.ends_on)} · ${p.member_count} ${p.member_count === 1 ? 'member' : 'members'} · ${Number(p.progress_pct)}% done`}
        action={
          <div className="flex flex-wrap gap-2">
          <ButtonLink variant="onNavy" size="sm" to={paths.projectArchive(p.id)}>
            <Icon name="archive" size={15} />
            Project archive
          </ButtonLink>
          {/* A report is built from the space, so it is offered only to somebody
              who can read that space. Joining this project by code does not. */}
          {currentSpace?.id === p.space_id && (
            <ButtonLink variant="onNavy" size="sm" to={`${paths.spaceReports(p.space_id)}?s=project&p=${p.id}`}>
              <Icon name="chart" size={15} />
              Report
            </ButtonLink>
          )}
          <SaveTemplateButton state={state} className={buttonClass({ variant: 'onNavy', size: 'sm' })} />
          {state.isOwner && !state.archived && (
            <Button variant="destroy" size="sm" onClick={() => setArchiving(true)}>
              <Icon name="archive" size={15} />
              Archive project
            </Button>
          )}
          </div>
        }
      />

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

      <SinceLastVisit projectId={p.id} />

      <Tabs<GeneralTabId>
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'file' },
          { id: 'tasks', label: 'Tasks', icon: 'check', count: state.tasks.length },
          { id: 'files', label: 'Files', icon: 'folder' },
          { id: 'progress', label: 'Progress', icon: 'chart' },
          {
            id: 'members',
            label: 'Members',
            icon: 'users',
            count: openForOwner > 0 ? openForOwner : state.members.length,
          },
        ]}
        active={tab}
        onChange={changeTab}
      />

      {tab === 'overview' && <OverviewTab state={state} />}
      {tab === 'tasks' && <TasksTab state={state} />}
      {tab === 'files' && <FilesTab state={state} />}
      {tab === 'progress' && <ProgressTab state={state} />}
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
