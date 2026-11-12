import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { FileDrop } from '../ui/FileDrop'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { StatusPill } from '../projects/ProjectCard'
import { GradeCard } from '../scoring/GradeCard'
import { projectFileUrl, uploadProjectFile } from '../../lib/api/projects'
import { authErrorMessage } from '../../lib/authError'
import { formatBytes } from '../../lib/formatBytes'
import { weekRange } from '../../lib/types'
import type {
  ClassWeek,
  ProjectAttachment,
  ProjectCriterion,
  ProjectSummary,
} from '../../lib/types'

/**
 * A class project's brief: the syllabus weeks behind it, the guidelines, the
 * rubric and the attached files. Both roles read it; only the professor attaches
 * and removes files.
 */
export function ProjectBrief({
  project,
  role,
  criteria,
  files,
  weeks,
  error,
  onChanged,
  onRemove,
}: {
  project: ProjectSummary
  role: 'professor' | 'student'
  criteria: ProjectCriterion[]
  files: ProjectAttachment[]
  weeks: ClassWeek[]
  error: string | null
  /** Reload the project after a file is attached. */
  onChanged: () => Promise<void> | void
  /** Ask before removing a file; the page owns the confirmation. */
  onRemove: (a: ProjectAttachment) => void
}) {
  const { show } = useToast()
  const [uploading, setUploading] = useState(false)
  const canManage = role === 'professor'

  const span = weeks.filter(
    (w) => w.week_no >= project.start_week && w.week_no <= project.end_week,
  )
  const rubricTotal = criteria.reduce((n, c) => n + c.max_points, 0)

  async function openFile(a: ProjectAttachment) {
    try {
      window.open(await projectFileUrl(a.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {project.archived_at && (
        <Alert tone="info">
          This project is archived. Students no longer see it.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {role === 'student' && <GradeCard projectId={project.id} />}
        {/* The syllabus lines it was built on — the reason the project exists. */}
        <section className="rounded-panel border border-line surface p-4 shadow-card sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2>Based on the syllabus</h2>
            <StatusPill project={project} />
          </div>
          {span.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">
              The weeks behind this project are no longer in the syllabus.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {/* Folded to the week and its dates: topics and assessments open
                  on demand, so a long span does not push the brief down. */}
              {span.map((w) => (
                <li key={w.week_id} className="rounded-xl border border-line">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 hover:bg-[var(--surface-sunken)] [&::-webkit-details-marker]:hidden">
                      <Icon
                        name="chevronRight"
                        size={14}
                        className="shrink-0 text-faint transition-transform group-open:rotate-90 motion-reduce:transition-none"
                      />
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-[14px] font-semibold text-ink">
                          Week {w.week_no}
                          {w.title ? ` · ${w.title}` : ''}
                        </span>
                        <span className="font-mono text-[12px] text-faint">{weekRange(w)}</span>
                      </span>
                    </summary>
                    <div className="px-4 pb-3 pl-[42px]">
                      {w.topics && (
                        <p className="text-[13px] leading-relaxed text-muted">{w.topics}</p>
                      )}
                      {w.assessments && (
                        <p className="mt-1.5 flex gap-2 text-[12px] leading-relaxed text-warning-700 dark:text-warning-300">
                          <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                          {w.assessments}
                        </p>
                      )}
                      {!w.topics && !w.assessments && (
                        <p className="text-[13px] text-faint">No topics listed for this week.</p>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-panel border border-line surface p-4 shadow-card sm:p-6">
          <h2>Guidelines</h2>
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

        <section className="rounded-panel border border-line surface p-4 shadow-card sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2>Rubric</h2>
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

        <section className="rounded-panel border border-line surface p-4 shadow-card sm:p-6 lg:col-span-2">
          <h2>Files</h2>
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
                      onClick={() => onRemove(a)}
                      aria-label={`Remove ${a.file_name}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
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
                maxSize={50}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg"
                hint="PDF, Word, Excel, PowerPoint, or an image. Up to 50 MB."
                onPick={async (f) => {
                  if (!f) return
                  setUploading(true)
                  try {
                    await uploadProjectFile(project.id, f)
                    show('File attached')
                    await onChanged()
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
    </>
  )
}
