import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Alert, Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { FileDrop, formatBytes } from '../ui/FileDrop'
import { RubricEditor } from './RubricEditor'
import { WeekSpanPicker, spanEndDate, spanSuggestions } from './WeekSpanPicker'
import type { WeekSpan } from './WeekSpanPicker'
import {
  PROJECT_TYPES,
  assessDeadline,
} from '../../lib/types'
import type {
  ClassWeek,
  ProjectAudience,
  ProjectSummary,
  ProjectType,
} from '../../lib/types'
import type { LiveGroupSet } from '../../lib/api/groups'
import type { CriterionInput, ProjectInput } from '../../lib/api/projects'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3.5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-navy-600 font-mono text-[12px] font-bold text-amber-400 dark:bg-navy-500">
          {step}
        </span>
        <div>
          <h3 className="text-[15.5px] leading-tight font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[13px] text-muted">{hint}</p>
        </div>
      </div>
      <div className="sm:pl-10">{children}</div>
    </section>
  )
}

export type ProjectFormValue = {
  input: Omit<ProjectInput, 'classId'>
  criteria: CriterionInput[]
  file: File | null
}

export function ProjectForm({
  formId,
  weeks,
  groupSets,
  defaults,
  defaultCriteria = [],
  error,
  onSubmit,
}: {
  formId: string
  weeks: ClassWeek[]
  groupSets: LiveGroupSet[]
  defaults?: ProjectSummary
  defaultCriteria?: CriterionInput[]
  error?: string | null
  onSubmit: (value: ProjectFormValue) => void
}) {
  // Default to the week the class is in now, so the common case is one click.
  const firstOpen =
    weeks.find((w) => w.phase === 'current')?.week_no ??
    weeks.find((w) => w.phase === 'upcoming')?.week_no ??
    weeks[0]?.week_no ??
    1

  const [span, setSpan] = useState<WeekSpan>({
    start: defaults?.start_week ?? firstOpen,
    end: defaults?.end_week ?? firstOpen,
  })
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [type, setType] = useState<ProjectType>(defaults?.type ?? 'activity')
  const [typeLabel, setTypeLabel] = useState(defaults?.type_label ?? '')
  const [guidelines, setGuidelines] = useState(defaults?.guidelines ?? '')
  const [audience, setAudience] = useState<ProjectAudience>(defaults?.audience ?? 'individual')
  const [groupSetId, setGroupSetId] = useState(defaults?.group_set_id ?? '')
  const [totalPoints, setTotalPoints] = useState(defaults?.total_points ?? 100)
  const [dueAt, setDueAt] = useState(toLocalInput(defaults?.due_at ?? null))
  const [scheduled, setScheduled] = useState(Boolean(defaults?.release_at))
  const [releaseAt, setReleaseAt] = useState(toLocalInput(defaults?.release_at ?? null))
  const [criteria, setCriteria] = useState<CriterionInput[]>(defaultCriteria)
  const [file, setFile] = useState<File | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)

  const suggestions = useMemo(() => spanSuggestions(weeks, span), [weeks, span])
  const feasibility = assessDeadline({
    type,
    dueAt: fromLocalInput(dueAt),
    releaseAt: scheduled ? fromLocalInput(releaseAt) : null,
    spanEnd: spanEndDate(weeks, span),
  })
  // Closed sets are final records, not somewhere new work can be assigned. The
  // one already on this project stays listed so editing does not silently drop it.
  const openSets = groupSets.filter((s) => !s.closed_at || s.id === groupSetId)
  const chosenSet = openSets.find((s) => s.id === groupSetId)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setInvalid('Give the project a name.')
    if (type === 'other' && !typeLabel.trim()) return setInvalid('Name the project type.')
    if (audience === 'group' && !groupSetId) {
      return setInvalid('Pick which set of groups gets this project.')
    }
    setInvalid(null)
    onSubmit({
      input: {
        title,
        type,
        typeLabel: typeLabel || null,
        guidelines,
        startWeek: span.start,
        endWeek: span.end,
        audience,
        groupSetId: groupSetId || null,
        totalPoints,
        dueAt: fromLocalInput(dueAt),
        releaseAt: scheduled ? fromLocalInput(releaseAt) : null,
      },
      criteria,
      file,
    })
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-8">
      {(error || invalid) && <Alert tone="error">{error ?? invalid}</Alert>}

      <Section
        step={1}
        title="What it is based on"
        hint="Every project hangs off the weeks of this class's syllabus."
      >
        <WeekSpanPicker weeks={weeks} value={span} onChange={setSpan} />
      </Section>

      <Section step={2} title="The project" hint="Name it, say what it is, and set the brief.">
        <div className="space-y-4">
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Project Milestone 1 — database design"
                maxLength={140}
              />
            )}
          </Field>

          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-faint">From the syllabus:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTitle(s)}
                  className="rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink transition-colors hover:bg-[var(--surface-sunken)]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <Field label="Type">
            {(id) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => {
                  const next = e.target.value as ProjectType
                  setType(next)
                  const meta = PROJECT_TYPES.find((t) => t.value === next)
                  if (meta) setAudience(meta.defaultAudience)
                }}
                options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
            )}
          </Field>

          <p className="-mt-1 text-[12.5px] text-faint">
            {PROJECT_TYPES.find((t) => t.value === type)?.blurb}
          </p>

          {type === 'other' && (
            <Field label="Call it">
              {(id) => (
                <Input
                  id={id}
                  value={typeLabel}
                  onChange={(e) => setTypeLabel(e.target.value)}
                  placeholder="e.g. Case study"
                  maxLength={40}
                />
              )}
            </Field>
          )}

          <Field label="Who does it">
            {() => (
              <div className="grid gap-2 sm:grid-cols-2">
                {(['individual', 'group'] as ProjectAudience[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAudience(a)}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      audience === a
                        ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12'
                        : 'border-line hover:bg-[var(--surface-sunken)]'
                    }`}
                  >
                    <Icon name={a === 'group' ? 'users' : 'user'} size={18} className="mt-0.5 text-muted" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-ink">
                        {a === 'group' ? 'One group' : 'Each student'}
                      </span>
                      <span className="block text-[12.5px] text-muted">
                        {a === 'group'
                          ? 'Goes to the groups in one arrangement.'
                          : 'Goes to everyone on the roster.'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Field>

          {audience === 'group' &&
            (openSets.length === 0 ? (
              <Alert tone="info">
                This class has no groups to assign to. Create a set and put students in it,
                or make this an individual project.
              </Alert>
            ) : (
              <>
                <Field label="Which groups">
                  {(id) => (
                    <Select
                      id={id}
                      value={groupSetId}
                      onChange={(e) => setGroupSetId(e.target.value)}
                      placeholder="Pick a set of groups"
                      options={openSets.map((s) => ({
                        value: s.id,
                        label:
                          `${s.name} · ${s.group_count} group${s.group_count === 1 ? '' : 's'}` +
                          `, ${s.member_count} student${s.member_count === 1 ? '' : 's'}` +
                          (s.closed_at ? ' (final)' : ''),
                      }))}
                    />
                  )}
                </Field>
                {chosenSet && chosenSet.member_count === 0 && (
                  <Alert tone="info">
                    {chosenSet.name} has groups but nobody in them yet. Students see this
                    project once they are placed.
                  </Alert>
                )}
              </>
            ))}

          <Field label="Guidelines" optional>
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                placeholder="What to build, what to hand in, and how it will be checked."
              />
            )}
          </Field>
        </div>
      </Section>

      <Section step={3} title="Marking" hint="A total, and the criteria you mark against.">
        <div className="space-y-4">
          <Field label="Total points">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={1000}
                value={totalPoints}
                onChange={(e) => setTotalPoints(Number(e.target.value))}
                className="sm:max-w-[160px]"
              />
            )}
          </Field>
          <RubricEditor rows={criteria} onChange={setCriteria} totalPoints={totalPoints} />
        </div>
      </Section>

      <Section
        step={4}
        title="When"
        hint="Set the deadline, and hold the project back until you are ready."
      >
        <div className="space-y-4">
          <Field label="Deadline" optional>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            )}
          </Field>

          {feasibility && (
            <Alert tone={feasibility.tone}>{feasibility.message}</Alert>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {[false, true].map((s) => (
              <button
                key={String(s)}
                type="button"
                onClick={() => setScheduled(s)}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  scheduled === s
                    ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12'
                    : 'border-line hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <Icon name={s ? 'clock' : 'check'} size={18} className="mt-0.5 text-muted" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">
                    {s ? 'Schedule it' : 'Publish now'}
                  </span>
                  <span className="block text-[12.5px] text-muted">
                    {s
                      ? 'Stays hidden until the time you set.'
                      : 'Students see it as soon as you save.'}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {scheduled && (
            <Field label="Visible to students from">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={releaseAt}
                  onChange={(e) => setReleaseAt(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      </Section>

      <Section step={5} title="Files" hint="Attach the brief or a starter file. Optional.">
        <div className="space-y-2">
          <FileDrop
            file={file}
            onPick={setFile}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg"
            maxSize={20}
            hint="PDF, Word, Excel, PowerPoint, or an image. Up to 20 MB."
          />
          {defaults && defaults.attachment_count > 0 && (
            <p className="text-[12.5px] text-faint">
              {defaults.attachment_count} file{defaults.attachment_count === 1 ? '' : 's'} already
              attached — manage them on the project page.
            </p>
          )}
          {file && (
            <p className="text-[12.5px] text-faint">
              {file.name} · {formatBytes(file.size)} will be attached when you save.
            </p>
          )}
        </div>
      </Section>
    </form>
  )
}
