import { useCallback, useEffect, useState } from 'react'
import { useFocusMode } from '../../../lib/focusMode'
import type { ReactNode } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconAction } from '../../../components/ui/IconAction'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { Tabs } from '../../../components/ui/Tabs'
import { dueLabel } from '../../../components/projects/dueLabel'
import { ProjectWizard } from '../../../components/projects/ProjectWizard'
import { SeriesActionDialog } from '../../../components/projects/SeriesActionDialog'
import { BoardVerdict } from '../../../components/tasks/BoardVerdict'
import { ClassFilesTab } from '../../../components/tasks/ClassFilesTab'
import { BoardHeader, BoardPage } from '../../../components/classProject/BoardPage'
import { ProfessorProject } from '../../../components/classProject/ProfessorProject'
import { ProjectBrief } from '../../../components/classProject/ProjectBrief'
import { RateTeamButton } from '../../../components/peer/RateTeamButton'
import { ProjectTasksTab } from '../../../components/tasks/ProjectTasksTab'
import { SubmitProject } from '../../../components/tasks/SubmitProject'
import { useProjectTasks } from '../../../components/tasks/useProjectTasks'
import type { ProjectTasks } from '../../../components/tasks/useProjectTasks'
import { useAuth } from '../../../context/AuthContext'
import { listProfessorClasses } from '../../../lib/api/classes'
import {
  deleteAttachment,
  deleteProject,
  getProject,
  listAttachments,
  listCriteria,
  listSeriesMembers,
  releaseNow,
  releaseSeriesNow,
  setProjectArchived,
  setProjectLocked,
  setSeriesArchived,
  setSeriesDue,
  setSeriesLocked,
} from '../../../lib/api/projects'
import type { CriterionInput } from '../../../lib/api/projects'
import { clearProjectScores, projectHasScores } from '../../../lib/api/scores'
import { classWeekMap } from '../../../lib/api/syllabus'
import { authErrorMessage } from '../../../lib/authError'
import { legacyProfessorTarget } from '../../../lib/classProjectNav'
import { paths } from '../../../lib/paths'
import {
  hasPassed,
  isReleased,
  PROJECT_TYPES,
  projectTypeLabel,
  weekSpanLabel,
} from '../../../lib/types'
import type {
  ClassSummary,
  ClassWeek,
  ProjectAttachment,
  ProjectCriterion,
  ProjectSummary,
  SeriesMember,
} from '../../../lib/types'

type TabId = 'brief' | 'discussion' | 'work' | 'groups' | 'files' | 'shared'

const LINKED_TABS: TabId[] = ['discussion', 'work', 'groups', 'files', 'shared']

/** Which scoped action the professor opened, when the project runs in several. */
type SeriesAction = 'due' | 'lock' | 'archive' | 'release'

/**
 * One set of board state for the whole page: the header's hand-in, and the
 * Work and Files tabs, all read the same boards.
 */
function WithProjectTasks({
  project,
  role,
  boardId,
  children,
}: {
  project: ProjectSummary
  role: 'professor' | 'student'
  boardId?: string
  children: (t: ProjectTasks) => ReactNode
}) {
  const t = useProjectTasks({ project, role, boardId })
  return <>{children(t)}</>
}

/** A board's page for a board this project does not have goes back to the project's groups. */
function MissingBoard({ t, projectId }: { t: ProjectTasks; projectId: string }) {
  const navigate = useNavigate()
  const missing = t.boardMissing
  useEffect(() => {
    if (missing) navigate(paths.classProject(projectId), { replace: true, state: { notice: 'missing-board' } })
  }, [missing, navigate, projectId])
  return null
}

export default function ProjectDetail({ role }: { role: 'professor' | 'student' }) {
  // `boardId` is set when a later route renders this page for one board.
  const { projectId = '', boardId } = useParams()
  const focused = useFocusMode()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [criteria, setCriteria] = useState<ProjectCriterion[]>([])
  const [scored, setScored] = useState(false)
  const [files, setFiles] = useState<ProjectAttachment[]>([])
  const [weeks, setWeeks] = useState<ClassWeek[]>([])
  const [classes, setClasses] = useState<ClassSummary[]>([])
  const [members, setMembers] = useState<SeriesMember[]>([])
  const [action, setAction] = useState<SeriesAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // A link from another page can name the tab. Submissions and Reassignments
  // both link straight into a board, which the Brief tab does not show.
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<TabId>(() => {
    const raw = params.get('tab')
    // Work replaced Tasks and Progress; links written before it still name them.
    if (raw === 'tasks' || raw === 'progress') return 'work'
    const named = raw as TabId | null
    if (named && LINKED_TABS.includes(named)) return named
    return params.has('board') || params.has('task') || params.has('work') || params.has('layout')
      ? 'work'
      : 'brief'
  })
  // The tab lives in the address too, so a reload or a shared link lands on it.
  // Replace rather than push: the tab state is not re-read on back.
  const changeTab = useCallback(
    (next: TabId) => {
      setTab(next)
      const changed = new URLSearchParams(params)
      if (next === 'brief') changed.delete('tab')
      else changed.set('tab', next)
      // Work's own place (section, layout, open task, board) means nothing elsewhere.
      if (next !== 'work') {
        changed.delete('work')
        changed.delete('layout')
        changed.delete('task')
        changed.delete('board')
      }
      setParams(changed, { replace: true })
    },
    [params, setParams],
  )
  const [editOpen, setEditOpen] = useState(false)
  const [removing, setRemoving] = useState<ProjectAttachment | null>(null)
  const [deletePrompt, setDeletePrompt] = useState(false)

  const canManage = role === 'professor'
  // Groups is a teacher's tab; a student's link naming it lands on the Brief.
  useEffect(() => {
    if (tab === 'groups' && role === 'student') changeTab('brief')
  }, [tab, role, changeTab])
  // A professor's old links (Work and its sections, a board, Groups, Files)
  // land on the tab or board page that holds the same thing now. Only on the
  // project's own address: a board's page reads its own tabs.
  const loadedId = project?.id
  useEffect(() => {
    if (role !== 'professor' || boardId || !loadedId) return
    const target = legacyProfessorTarget(loadedId, params)
    if (target) navigate(target, { replace: true })
  }, [role, boardId, loadedId, params, navigate])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const p = await getProject(projectId)
      setProject(p)
      if (!p) {
        setError('That project does not exist, or you do not have access to it.')
        return
      }
      const [c, f, w, m, s] = await Promise.all([
        listCriteria(p.id),
        listAttachments(p.id),
        classWeekMap(p.class_id),
        listSeriesMembers(p.series_id),
        role === 'professor' ? projectHasScores(p.id) : Promise.resolve(false),
      ])
      setCriteria(c)
      setFiles(f)
      setWeeks(w)
      setMembers(m)
      setScored(s)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that project.'))
    } finally {
      setLoading(false)
    }
  }, [projectId, role])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_boards', 'project_tasks', 'task_assignees', 'board_results', 'groups', 'group_members', 'board_scores'])

  useEffect(() => {
    if (!canManage || !profile) return
    void listProfessorClasses(profile.id).then(setClasses).catch(() => setClasses([]))
  }, [canManage, profile])

  useEffect(() => {
    if (project) document.title = `${project.title} · Collabify`
  }, [project])

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <Spinner size={16} />
        Loading project…
      </div>
    )
  }

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error">{error ?? 'That project could not be loaded.'}</Alert>
      </div>
    )
  }

  const meta = PROJECT_TYPES.find((t) => t.value === project.type)
  // One row is not a series: a project created for a single section carries no
  // series id at all, and there is nothing to scope.
  const inSeries = members.length > 1
  const others = members.filter((m) => m.project_id !== project.id)
  // Closed by hand, or simply past its deadline: the same rule the projects list uses.
  const closed = Boolean(project.locked_at) || Boolean(project.due_at && hasPassed(project.due_at))
  const brief = (
    <ProjectBrief
      project={project}
      role={role}
      criteria={criteria}
      files={files}
      weeks={weeks}
      error={error}
      onChanged={load}
      onRemove={setRemoving}
    />
  )

  // A professor's page for one group (or student) on the project.
  const boardPage = role === 'professor' && boardId ? boardId : null

  return (
    // Keyed so the project's own page never inherits the board a board page pinned.
    <WithProjectTasks key={boardPage ? 'board' : 'project'} project={project} role={role} boardId={boardPage ?? undefined}>
      {(t) => (
    <div className="mx-auto w-full max-w-[1280px]">
      {boardPage ? (
        <>
          <MissingBoard t={t} projectId={project.id} />
          <BoardHeader project={project} t={t} boardId={boardPage} />
        </>
      ) : (
      <>
      <Link
        to={paths.classProjects}
        className="inline-flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={15} />
        All projects
      </Link>

      {/* A live discussion room takes the page; the banner returns when it closes. */}
      <header className={`relative mt-4 overflow-hidden rounded-panel border border-banner-ink/10 banner-fill px-5 py-6 text-banner-ink sm:px-7 sm:py-8 lg:px-9 ${focused ? 'hidden' : ''}`}>
        <div
          aria-hidden
          className="banner-deco pointer-events-none absolute -top-48 -right-40 h-[420px] w-[420px] rounded-full bg-banner-glow/10 blur-[115px]"
        />
        <div
          aria-hidden
          className="banner-deco pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px)',
            backgroundSize: '54px 54px',
            maskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
          }}
        />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-banner-ink/8 px-2.5 py-1 text-[11px] font-medium text-banner-muted ring-1 ring-banner-ink/10">
                <Icon name={meta?.icon ?? 'folder'} size={12} />
                {projectTypeLabel(project)}
              </span>
              <span className="rounded-full bg-banner-ink/8 px-2.5 py-1 text-[11px] font-medium text-banner-muted ring-1 ring-banner-ink/10">
                {weekSpanLabel(project)}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  project.archived_at || closed
                    ? 'bg-banner-ink/10 text-banner-muted'
                    : project.scheduled
                      ? 'bg-banner-glow/15 text-banner-accent-soft'
                      : 'bg-success-400/12 text-success-200'
                }`}
              >
                {project.archived_at
                  ? 'Archived'
                  : closed
                    ? 'Closed'
                    : project.scheduled
                      ? 'Scheduled'
                      : 'Active'}
              </span>
              {!canManage && t.active && (
                <BoardVerdict variant="pill" board={t.active} role={role} onChanged={t.refresh} />
              )}
            </div>

            {/* A student hands in from here, whichever tab they are on. */}
            {!canManage && t.active && (
              <div className="flex flex-wrap items-center gap-2">
                {project.audience === 'group' && <RateTeamButton projectId={project.id} />}
                <SubmitProject variant="header" board={t.active} locked={t.locked} onChanged={t.refresh} />
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap items-center gap-1.5">
                <IconAction icon="edit" label="Edit project" onClick={() => setEditOpen(true)} />
                {project.scheduled && (
                  <IconAction
                    icon="upload"
                    label="Publish now"
                    onClick={async () => {
                      if (inSeries) return setAction('release')
                      await releaseNow(project.id)
                      show('Project published')
                      await load()
                    }}
                  />
                )}
                {inSeries && <IconAction icon="clock" label="Change deadline" onClick={() => setAction('due')} />}
                <IconAction
                  icon={project.locked_at ? 'unlock' : 'lock'}
                  label={project.locked_at ? 'Reopen project' : 'Close project'}
                  onClick={async () => {
                    if (inSeries) return setAction('lock')
                    await setProjectLocked(project.id, !project.locked_at)
                    show(
                      project.locked_at
                        ? 'Project reopened — students can work on it again'
                        : 'Project closed — students can no longer change their tasks',
                    )
                    await load()
                  }}
                />
                <IconAction
                  icon={project.archived_at ? 'refresh' : 'archive'}
                  label={project.archived_at ? 'Restore project' : 'Archive project'}
                  variant={project.archived_at ? 'onNavy' : 'destroy'}
                  onClick={async () => {
                    if (inSeries) return setAction('archive')
                    await setProjectArchived(project.id, !project.archived_at)
                    show(project.archived_at ? 'Project restored' : 'Project archived')
                    await load()
                  }}
                />
                <IconAction
                  icon="trash"
                  label="Delete project"
                  variant="danger"
                  onClick={() => setDeletePrompt(true)}
                />
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.82fr)] lg:items-end">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-banner-ink/8 text-banner-accent ring-1 ring-banner-ink/12 sm:h-16 sm:w-16">
                <Icon name={meta?.icon ?? 'folder'} size={23} />
              </span>
              <div className="min-w-0">
                <h1 className="text-balance text-banner-ink">{project.title}</h1>
                <p className="mt-2 text-[13px] text-banner-muted">
                  <Link to={paths.class(project.class_id)} className="hover:text-banner-accent-soft hover:underline">
                    {project.class_initial} · {project.class_name}
                  </Link>
                  {project.group_set_name && ` · ${project.group_set_name}`}
                </p>
                {project.scheduled && project.release_at && (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-banner-accent-soft">
                    <Icon name="eyeOff" size={13} />
                    Hidden until {new Date(project.release_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-banner-ink/12 bg-banner-ink/12">
              <div className="min-w-0 banner-cell px-3 py-3.5">
                <dt className="text-[11px] text-banner-faint">Deadline</dt>
                <dd className="mt-1.5 text-[12px] font-medium text-banner-ink">{dueLabel(project.due_at)}</dd>
              </div>
              <div className="min-w-0 banner-cell px-3 py-3.5">
                <dt className="text-[11px] text-banner-faint">Submission</dt>
                <dd className="mt-1.5 truncate text-[12px] font-medium text-banner-ink">
                  {project.audience === 'group' ? 'Per group' : 'Per student'}
                </dd>
              </div>
              <div className="min-w-0 banner-cell px-3 py-3.5">
                <dt className="text-[11px] text-banner-faint">Points</dt>
                <dd className="mt-1.5 font-mono text-[18px] font-bold text-banner-ink">
                  {project.total_points}
                </dd>
              </div>
            </dl>
          </div>

          {inSeries && (
            <p className="mt-6 flex items-start gap-2 border-t border-banner-ink/10 pt-4 text-[12px] text-banner-faint">
              <Icon name="copy" size={13} className="mt-0.5 shrink-0" />
              <span>
                Also set for {others.map((m) => m.section).join(', ')} — each has its own board and deadline.
              </span>
            </p>
          )}
        </div>
      </header>
      </>
      )}

      {boardPage ? (
        <BoardPage project={project} t={t} viewerId={profile?.id} />
      ) : role === 'professor' ? (
        <ProfessorProject
          project={project}
          t={t}
          viewerId={profile?.id}
          cls={classes.find((c) => c.id === project.class_id) ?? null}
          brief={brief}
        />
      ) : (
        <>
          <div className="mt-6">
            <Tabs<TabId>
              tabs={[
                { id: 'brief', label: 'Brief', icon: 'file' },
                // A group's discussions are the group's own, like its files.
                { id: 'discussion', label: 'Discussion', icon: 'message' },
                // Planning, progress and the board itself.
                { id: 'work', label: 'Work', icon: 'kanban' },
                { id: 'files', label: 'Files', icon: 'folder' },
                { id: 'shared', label: 'Shared with me', icon: 'users' },
              ]}
              active={tab}
              onChange={changeTab}
              variant="panel"
            />
          </div>

          {tab === 'work' && (
            <div className="mt-6">
              <ProjectTasksTab project={project} role={role} viewerId={profile?.id} t={t} />
            </div>
          )}
          {(tab === 'files' || tab === 'shared' || tab === 'discussion') && (
            <div className="mt-6">
              {isReleased(project) ? (
                <ClassFilesTab t={t} viewerId={profile?.id} show={tab} />
              ) : (
                <Alert tone="info">This project has not been released yet, so there are no files to work on.</Alert>
              )}
            </div>
          )}

          <div className={`mt-6 ${tab === 'brief' ? '' : 'hidden'}`}>{brief}</div>
        </>
      )}

      {canManage && profile && (
        <ProjectWizard
          open={editOpen}
          onClose={() => setEditOpen(false)}
          classes={classes}
          fixedClassId={project.class_id}
          createdBy={profile.id}
          editing={project}
          editingCriteria={criteria.map<CriterionInput>((c) => ({
            label: c.label,
            description: c.description,
            max_points: c.max_points,
          }))}
          onSaved={load}
          rubricLocked={scored}
          onClearScores={async () => {
            await clearProjectScores(project.id)
            setScored(false)
            show('Scores cleared. The rubric is unlocked.')
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteAttachment(removing)
          show('File removed')
          await load()
        }}
        title={`Remove ${removing?.file_name ?? ''}?`}
        body="The file is deleted from the project. Students can no longer open it."
        confirmLabel="Remove file"
      />

      {canManage && inSeries && (
        <SeriesActionDialog
          open={action !== null}
          onClose={() => setAction(null)}
          members={members}
          current={project.id}
          deadline={action === 'due'}
          defaultDue={project.due_at}
          title={
            action === 'due'
              ? 'Change the deadline'
              : action === 'lock'
                ? project.locked_at
                  ? 'Reopen the project'
                  : 'Close the project'
                : action === 'archive'
                  ? project.archived_at
                    ? 'Restore the project'
                    : 'Archive the project'
                  : 'Publish now'
          }
          body={
            action === 'due'
              ? 'A passed deadline still marks work late rather than blocking it.'
              : action === 'lock'
                ? project.locked_at
                  ? 'Students can change their tasks again in the sections you pick.'
                  : 'Students can no longer change their tasks in the sections you pick.'
                : action === 'archive'
                  ? project.archived_at
                    ? 'Students see it again in the sections you pick.'
                    : 'Students no longer see it in the sections you pick.'
                  : 'The sections you pick become visible to their students now.'
          }
          confirmLabel={
            action === 'due'
              ? 'Move the deadline'
              : action === 'lock'
                ? project.locked_at
                  ? 'Reopen'
                  : 'Close'
                : action === 'archive'
                  ? project.archived_at
                    ? 'Restore'
                    : 'Archive'
                  : 'Publish'
          }
          verb={
            action === 'due'
              ? 'move'
              : action === 'lock'
                ? project.locked_at
                  ? 'reopen'
                  : 'close'
                : action === 'archive'
                  ? project.archived_at
                    ? 'come back'
                    : 'archive'
                  : 'publish'
          }
          onConfirm={async (targets, dueAt) => {
            if (action === 'due') await setSeriesDue(targets, dueAt)
            else if (action === 'lock') await setSeriesLocked(targets, !project.locked_at)
            else if (action === 'archive') await setSeriesArchived(targets, !project.archived_at)
            else await releaseSeriesNow(targets)
            show(
              targets.length === 1
                ? 'Done — the other sections are unchanged'
                : `Done in ${targets.length} sections`,
            )
            await load()
          }}
        />
      )}

      <ConfirmDialog
        open={deletePrompt}
        onClose={() => setDeletePrompt(false)}
        onConfirm={async () => {
          await deleteProject(project.id)
          show(`${project.title} deleted`)
          navigate(paths.classProjects)
        }}
        title={`Delete ${project.title}?`}
        body="The project, its rubric, and its files are destroyed. This cannot be undone. Archive it instead if you only want it out of the way."
        confirmLabel="Delete permanently"
      />
    </div>
      )}
    </WithProjectTasks>
  )
}
