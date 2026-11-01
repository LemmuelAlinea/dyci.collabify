// src/pages/general/GeneralProject.tsx
import { useEffect } from 'react'
import { useFocusMode } from '../../lib/focusMode'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { DiscussionTab } from '../../components/general/DiscussionTab'
import { FeedbackTab } from '../../components/general/FeedbackTab'
import { FilesTab } from '../../components/general/FilesTab'
import { JoinRequestButton } from '../../components/general/JoinRequestButton'
import { WorkTab } from '../../components/general/WorkTab'
import { ProjectSettings } from '../../components/general/settings/ProjectSettings'
import { SinceLastVisit } from '../../components/general/SinceLastVisit'
import { SaveTemplateButton } from '../../components/general/SaveTemplateButton'
import { ProjectMark } from '../../components/general/ProjectMark'
import { useGeneralProject } from '../../components/general/useGeneralProject'
import { Alert } from '../../components/ui/Alert'
import { IconAction } from '../../components/ui/IconAction'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Tabs } from '../../components/ui/Tabs'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { dateRange } from '../../lib/general/dates'
import { generalTab } from '../../lib/general/navigation'
import type { GeneralTabId } from '../../lib/general/navigation'
import { SWATCH_CLASS } from '../../lib/general/projectLook'
import { ROLE_LABEL } from '../../lib/general/permissions'
import { projectStatusLabel } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export default function GeneralProject() {
  const { projectId } = useParams()
  const focused = useFocusMode()
  const { profile } = useAuth()
  const { currentSpace, reportProjectSpace } = useGeneralNavigation()
  const state = useGeneralProject(projectId, profile?.id)
  const [params, setParams] = useSearchParams()
  // The project's default view opens when the address names no tab; it is unknown until the project loads.
  const defaultView = state.project?.default_view ?? 'overview'
  const tab = generalTab(params, defaultView)

  function changeTab(next: GeneralTabId) {
    const changed = new URLSearchParams(params)
    // With a default view other than Overview, Overview must be named or the bare address would open the default.
    if (next === 'overview' && defaultView === 'overview') changed.delete('tab')
    else changed.set('tab', next)
    changed.delete('feedback')
    changed.delete('conversation')
    changed.delete('task')
    changed.delete('work')
    changed.delete('layout')
    changed.delete('milestone')
    changed.delete('view')
    changed.delete('path')
    changed.delete('share')
    changed.delete('spath')
    changed.delete('section')
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

  // A Stakeholder is not in discussions, and has nothing shared with them.
  const stakeholder = state.myRole === 'stakeholder'
  const discussionOn = !stakeholder
  // Feedback is for work projects; a class board's Files project has none. Only
  // the project's members read it, so a space owner who isn't on it sees no tab.
  const feedbackOn = !p.class_board_id && Boolean(state.me)
  if ((tab === 'conversations' && !discussionOn && !feedbackOn) || (!feedbackOn && params.get('tab') === 'feedback') || (stakeholder && params.get('tab') === 'discussion')) {
    const changed = new URLSearchParams(params)
    changed.delete('tab')
    return <Navigate to={{ search: changed.toString() }} replace />
  }
  const feedbackSelected = !discussionOn || (feedbackOn && (params.get('conversation') === 'feedback' || params.get('tab') === 'feedback'))

  // A Workspace project is readable by its whole space. Somebody who is not on it can ask to join;
  // a space Owner reads every project and does not need to.
  const viewingFromSpace =
    p.visibility === 'workspace' &&
    !state.myRole &&
    !state.archived &&
    !(currentSpace?.id === p.space_id && currentSpace.my_level === 'owner')

  const openForOwner = state.canGrant ? state.requests.filter((r) => r.status === 'open').length : 0

  return (
    <div className="w-full space-y-6">
      <Link
        // Straight to the projects list when the space is not the reader's to
        // read, which is the case for anybody who joined this project by code.
        to={currentSpace?.id === p.space_id ? paths.spaceProjects(p.space_id) : paths.projects}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon name="arrowLeft" size={14} />
        All projects
      </Link>

      {/* A live discussion room takes the page; the banner returns when it closes. */}
      <div className={focused ? 'hidden' : undefined}>
      <DirectoryHero
        title={p.name}
        mark={p.color || p.icon ? <ProjectMark color={p.color} icon={p.icon} name={p.name} size="lg" /> : undefined}
        accent={p.archived_at ? 'archived.' : 'project.'}
        accentClass={p.color ? SWATCH_CLASS[p.color].accent : undefined}
        description={`${projectStatusLabel(p.status)} · Your role: ${p.my_role ? ROLE_LABEL[p.my_role] : 'watching from the space'} · ${dateRange(p.starts_on, p.ends_on)} · ${p.member_count} ${p.member_count === 1 ? 'member' : 'members'} · ${Number(p.progress_pct)}% done`}
        action={
          <div className="flex flex-wrap gap-1.5">
            <IconAction icon="history" label="Project archive" to={paths.projectArchive(p.id)} />
            {/* A report is built from the space, so it is offered only to somebody
                who can read that space. Joining this project by code does not. */}
            {currentSpace?.id === p.space_id && (
              <IconAction icon="chart" label="Report" to={`${paths.spaceReports(p.space_id)}?s=project&p=${p.id}`} />
            )}
            <SaveTemplateButton state={state} />
          </div>
        }
      />
      </div>

      {state.error && <Alert tone="error">{state.error}</Alert>}

      {state.archived && (
        <Alert tone="info">
          This project is archived, so nothing in it can change.
          {state.isOwner && (
            <>
              {' '}
              <Link to={{ search: '?tab=settings&section=general' }} className="font-medium underline">
                Restore it in Settings
              </Link>{' '}
              to make changes again.
            </>
          )}
        </Alert>
      )}

      {viewingFromSpace && (
        <Alert tone="info">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>You're viewing this project as a member of its space.</span>
            <JoinRequestButton state={state} />
          </div>
        </Alert>
      )}

      {stakeholder && (
        <Alert tone="info">You're a stakeholder here. You can view the project's work and files, and post feedback.</Alert>
      )}

      <SinceLastVisit projectId={p.id} />

      <Tabs<GeneralTabId>
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'file' },
          { id: 'plan', label: 'Plan', icon: 'target' },
          { id: 'tasks', label: 'Tasks', icon: 'kanban' },
          ...(discussionOn || feedbackOn ? [{ id: 'conversations' as const, label: 'Conversations', icon: 'message' as const }] : []),
          { id: 'files', label: 'Files', icon: 'folder' },
          {
            id: 'settings',
            label: 'Settings',
            icon: 'settings',
            ...(openForOwner > 0 ? { count: openForOwner } : {}),
          },
        ]}
        active={tab}
        onChange={changeTab}
      />

      {tab === 'overview' && <WorkTab state={state} area="overview" />}
      {tab === 'plan' && <WorkTab state={state} area="plan" />}
      {tab === 'tasks' && <WorkTab state={state} area="tasks" />}
      {tab === 'conversations' && <div className="space-y-5">
        {discussionOn && feedbackOn && <Tabs<'discussion' | 'feedback'>
          tabs={[{ id: 'discussion', label: 'Discussion', icon: 'message' }, { id: 'feedback', label: 'Feedback', icon: 'edit' }]}
          active={feedbackSelected ? 'feedback' : 'discussion'}
          onChange={(mode) => {
            const next = new URLSearchParams(params)
            next.set('tab', 'conversations')
            next.set('conversation', mode)
            next.delete('feedback')
            setParams(next)
          }}
          variant="panel"
        />}
        {feedbackSelected ? <FeedbackTab state={state} /> : <DiscussionTab state={state} />}
      </div>}
      {tab === 'files' && <FilesTab state={state} />}
      {tab === 'settings' && <ProjectSettings state={state} />}
    </div>
  )
}
