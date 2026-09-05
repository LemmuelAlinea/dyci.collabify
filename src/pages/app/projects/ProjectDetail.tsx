import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Alert'
import { FileDrop, formatBytes } from '../../../components/ui/FileDrop'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { Tabs } from '../../../components/ui/Tabs'
import { dueLabel, StatusPill } from '../../../components/projects/ProjectCard'
import { ProjectWizard } from '../../../components/projects/ProjectWizard'
import { SeriesActionDialog } from '../../../components/projects/SeriesActionDialog'
import { ProjectTasksTab } from '../../../components/tasks/ProjectTasksTab'
import { useAuth } from '../../../context/AuthContext'
import { listProfessorClasses } from '../../../lib/api/classes'
import {
  deleteAttachment,
  deleteProject,
  getProject,
  listAttachments,
  listCriteria,
  listSeriesMembers,
  projectFileUrl,
  releaseNow,
  releaseSeriesNow,
  setProjectArchived,
  setProjectLocked,
  setSeriesArchived,
  setSeriesDue,
  setSeriesLocked,
  uploadProjectFile,
} from '../../../lib/api/projects'
import type { CriterionInput } from '../../../lib/api/projects'
import { classWeekMap } from '../../../lib/api/syllabus'
import { authErrorMessage } from '../../../lib/authError'
import {
  PROJECT_TYPES,
  projectTypeLabel,
  weekRange,
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

type TabId = 'brief' | 'tasks'

/** Which scoped action the professor opened, when the project runs in several. */
type SeriesAction = 'due' | 'lock' | 'archive' | 'release'

export default function ProjectDetail({ role }: { role: 'professor' | 'student' }) {
  const { projectId = '' } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [criteria, setCriteria] = useState<ProjectCriterion[]>([])
  const [files, setFiles] = useState<ProjectAttachment[]>([])
  const [weeks, setWeeks] = useState<ClassWeek[]>([])
  const [classes, setClasses] = useState<ClassSummary[]>([])
  const [members, setMembers] = useState<SeriesMember[]>([])
  const [action, setAction] = useState<SeriesAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<TabId>('brief')
  const [editOpen, setEditOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState<ProjectAttachment | null>(null)
  const [deletePrompt, setDeletePrompt] = useState(false)

  const base = role === 'professor' ? '/professor' : '/student'
  const canManage = role === 'professor'

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const p = await getProject(projectId)
      setProject(p)
      if (!p) {
        setError('That project does not exist, or you do not have access to it.')
        return
      }
      const [c, f, w, m] = await Promise.all([
        listCriteria(p.id),
        listAttachments(p.id),
        classWeekMap(p.class_id),
        listSeriesMembers(p.series_id),
      ])
      setCriteria(c)
      setFiles(f)
      setWeeks(w)
      setMembers(m)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that project.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_boards', 'project_tasks', 'task_assignees', 'board_results', 'groups', 'group_members'])

  useEffect(() => {
    if (!canManage || !profile) return
    void listProfessorClasses(profile.id).then(setClasses).catch(() => setClasses([]))
  }, [canManage, profile])

  useEffect(() => {
    if (project) document.title = `${project.title} · Collabify`
  }, [project])

  async function openFile(a: ProjectAttachment) {
    try {
      window.open(await projectFileUrl(a.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
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
  const span = weeks.filter(
    (w) => w.week_no >= project.start_week && w.week_no <= project.end_week,
  )
  const rubricTotal = criteria.reduce((n, c) => n + c.max_points, 0)
  // One row is not a series: a project created for a single section carries no
  // series id at all, and there is nothing to scope.
  const inSeries = members.length > 1
  const others = members.filter((m) => m.project_id !== project.id)

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Link
        to={`${base}/projects`}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={15} />
        All projects
      </Link>

      <header className="blueprint mt-4 rounded-card bg-navy-700 p-4 sm:p-6 text-white sm:p-8 dark:bg-navy-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[12px] tracking-wide text-amber-300 uppercase">
              <Icon name={meta?.icon ?? 'folder'} size={14} />
              {projectTypeLabel(project)} · {weekSpanLabel(project)}
            </p>
            <h1 className="mt-3 text-[clamp(1.6rem,3vw,2.2rem)] leading-tight">
              {project.title}
            </h1>
            <p className="mt-2 text-[14px] text-white/70">
              <Link
                to={`${base}/classes/${project.class_id}`}
                className="hover:underline"
              >
                {project.class_initial} · {project.class_name}
              </Link>
              {project.group_set_name && ` · ${project.group_set_name}`}
            </p>
            {/* Said here because every action on this page can reach further
                than the page itself. */}
            {inSeries && (
              <p className="mt-2 flex items-start gap-1.5 text-[13px] text-white/60">
                <Icon name="copy" size={14} className="mt-0.5 shrink-0" />
                <span>
                  Also set for {others.map((m) => m.section).join(', ')} — each with its
                  own board and deadline.
                </span>
              </p>
            )}
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="onNavy" size="sm" onClick={() => setEditOpen(true)}>
                <Icon name="edit" size={15} />
                Edit
              </Button>
              {project.scheduled && (
                <Button
                  variant="onNavy"
                  size="sm"
                  onClick={async () => {
                    if (inSeries) return setAction('release')
                    await releaseNow(project.id)
                    show('Project published')
                    await load()
                  }}
                >
                  <Icon name="upload" size={15} />
                  Publish now
                </Button>
              )}
              {/* The extension, on its own button. Moving one section's
                  deadline is the commonest thing done to a series, and going
                  through the whole form to do it would put four other steps
                  in front of it — every one of which would then be saved to
                  whatever sections were in scope. */}
              {inSeries && (
                <Button variant="onNavy" size="sm" onClick={() => setAction('due')}>
                  <Icon name="clock" size={15} />
                  Deadline
                </Button>
              )}
              {/* Separate from the deadline on purpose: closing stops the work
                  without rewriting when it was due, and reopening is how an
                  extension is granted. */}
              <Button
                variant="onNavy"
                size="sm"
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
              >
                <Icon name={project.locked_at ? 'unlock' : 'lock'} size={15} />
                {project.locked_at ? 'Reopen' : 'Close'}
              </Button>
              <Button
                variant="onNavy"
                size="sm"
                onClick={async () => {
                  if (inSeries) return setAction('archive')
                  await setProjectArchived(project.id, !project.archived_at)
                  show(project.archived_at ? 'Project restored' : 'Project archived')
                  await load()
                }}
              >
                <Icon name={project.archived_at ? 'refresh' : 'archive'} size={15} />
                {project.archived_at ? 'Restore' : 'Archive'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDeletePrompt(true)}>
                <Icon name="trash" size={15} />
                Delete
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/80">
          {/* Says the state wherever you are on the page — the Close button
              alone only reads as the state once you look at its label. */}
          {project.locked_at && (
            <span className="flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-2.5 py-1 font-mono text-[12px] text-amber-200">
              <Icon name="lock" size={14} />
              CLOSED
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Icon name="clock" size={15} />
            {dueLabel(project.due_at)}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name={project.audience === 'group' ? 'users' : 'user'} size={15} />
            {project.audience === 'group' ? 'One submission per group' : 'One per student'}
          </span>
          <span className="font-mono">{project.total_points} points</span>
          {project.scheduled && project.release_at && (
            <span className="flex items-center gap-1.5 text-amber-300">
              <Icon name="eyeOff" size={15} />
              Hidden until {new Date(project.release_at).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      <div className="mt-8">
        <Tabs<TabId>
          tabs={[
            { id: 'brief', label: 'Brief', icon: 'file' },
            { id: 'tasks', label: 'Tasks', icon: 'check' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'tasks' && (
        <div className="mt-6">
          <ProjectTasksTab project={project} role={role} viewerId={profile?.id} />
        </div>
      )}

      <div className={`mt-6 space-y-6 ${tab === 'brief' ? '' : 'hidden'}`}>
        {error && <Alert tone="error">{error}</Alert>}
        {project.archived_at && (
          <Alert tone="info">
            This project is archived. Students no longer see it.
          </Alert>
        )}

        {/* The syllabus lines it was built on — the reason the project exists. */}
        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="">Based on the syllabus</h2>
            <StatusPill project={project} />
          </div>
          {span.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">
              The weeks behind this project are no longer in the syllabus.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {span.map((w) => (
                <li key={w.week_id} className="rounded-xl border border-line px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-[14px] font-semibold text-ink">
                      Week {w.week_no}
                      {w.title ? ` · ${w.title}` : ''}
                    </p>
                    <p className="font-mono text-[12px] text-faint">{weekRange(w)}</p>
                  </div>
                  {w.topics && (
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{w.topics}</p>
                  )}
                  {w.assessments && (
                    <p className="mt-1.5 flex gap-1.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                      <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                      {w.assessments}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card sm:p-6">
          <h2 className="">Guidelines</h2>
          {project.guidelines ? (
            <p className="mt-3 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
              {project.guidelines}
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-faint">
              {canManage
                ? 'No guidelines yet. Edit the project to add the brief.'
                : 'Your professor has not written guidelines for this one.'}
            </p>
          )}
        </section>

        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="">Rubric</h2>
            {criteria.length > 0 && (
              <p className="font-mono text-[12px] text-faint">
                {rubricTotal} / {project.total_points} points
              </p>
            )}
          </div>
          {criteria.length === 0 ? (
            <p className="mt-2 text-[13px] text-faint">
              Marked on the total of {project.total_points} points.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">{c.label}</p>
                    {c.description && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-lg surface-sunken px-2.5 py-1 font-mono text-[12px] text-muted">
                    {c.max_points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card sm:p-6">
          <h2 className="">Files</h2>
          {files.length === 0 ? (
            <p className="mt-2 text-[13px] text-faint">Nothing attached.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {files.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-line px-4 py-3"
                >
                  <Icon name="file" size={18} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{a.file_name}</p>
                    <p className="text-[12px] text-faint">{formatBytes(a.size_bytes)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openFile(a)}
                    aria-label={`Open ${a.file_name}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="download" size={16} />
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setRemoving(a)}
                      aria-label={`Remove ${a.file_name}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <div className="mt-4">
              <FileDrop
                file={null}
                compact={files.length > 0}
                maxSize={20}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg"
                hint="PDF, Word, Excel, PowerPoint, or an image. Up to 20 MB."
                onPick={async (f) => {
                  if (!f) return
                  setUploading(true)
                  try {
                    await uploadProjectFile(project.id, f)
                    show('File attached')
                    await load()
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not attach that file.'), 'error')
                  } finally {
                    setUploading(false)
                  }
                }}
              />
              {uploading && (
                <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
                  <Spinner size={14} />
                  Uploading…
                </p>
              )}
            </div>
          )}
        </section>
      </div>

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
          navigate(`${base}/projects`)
        }}
        title={`Delete ${project.title}?`}
        body="The project, its rubric, and its files are destroyed. This cannot be undone. Archive it instead if you only want it out of the way."
        confirmLabel="Delete permanently"
      />
    </div>
  )
}
