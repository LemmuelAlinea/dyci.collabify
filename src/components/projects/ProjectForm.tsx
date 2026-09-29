import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { FileDrop } from '../ui/FileDrop'
import { formatBytes } from '../../lib/formatBytes'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { RubricEditor } from './RubricEditor'
import { SectionPicker } from './SectionPicker'
import type { SectionChoice } from './SectionPicker'
import { WeekSpanPicker } from './WeekSpanPicker'
import { spanEndDate, spanSuggestions } from './weekSpan'
import type { WeekSpan } from './WeekSpanPicker'
import {
  PROJECT_TYPES,
  assessDeadline,
} from '../../lib/types'
import type {
  ClassSummary,
  ClassWeek,
  ProjectAudience,
  ProjectSummary,
  ProjectType,
} from '../../lib/types'
import type { LiveGroupSet } from '../../lib/api/groups'
import { draftProject } from '../../lib/api/projects'
import type { CriterionInput, ProjectInput } from '../../lib/api/projects'
import { authErrorMessage } from '../../lib/authError'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null
}

/** 11:59 pm on the last day of the span, as a datetime-local value. */
function spanDeadline(weeks: ClassWeek[], span: WeekSpan) {
  const end = spanEndDate(weeks, span)
  return end ? `${end.slice(0, 10)}T23:59` : ''
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
          <h3 className=" leading-tight font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-[13px] text-muted">{hint}</p>
        </div>
      </div>
      <div className="sm:pl-10">{children}</div>
    </section>
  )
}

/** Everything a new project needs to be written to more than one section. */
export type SectionOptions = {
  primary: ClassSummary
  /** Every class the professor teaches, the primary one included. */
  classes: ClassSummary[]
  /** Live sets across all of those classes, loaded in one go. */
  groupSets: LiveGroupSet[]
}

export type ProjectFormValue = {
  input: Omit<ProjectInput, 'classId'>
  criteria: CriterionInput[]
  file: File | null
  /** The sections beyond the primary one. Empty for an ordinary project. */
  sections: SectionChoice[]
}

export function ProjectForm({
  formId,
  weeks,
  groupSets,
  defaults,
  defaultCriteria = [],
  sectionOptions,
  error,
  onSubmit,
}: {
  formId: string
  weeks: ClassWeek[]
  groupSets: LiveGroupSet[]
  defaults?: ProjectSummary
  defaultCriteria?: CriterionInput[]
  /** Set only when creating: offers the other sections of the same course. */
  sectionOptions?: SectionOptions
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
  // The error lands at the top of a scrolling modal; this is what carries the
  // professor back to it.
  const alertRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  const [title, setTitle] = useState(defaults?.title ?? '')
  const [type, setType] = useState<ProjectType>(defaults?.type ?? 'activity')
  const [typeLabel, setTypeLabel] = useState(defaults?.type_label ?? '')
  const [guidelines, setGuidelines] = useState(defaults?.guidelines ?? '')
  const [audience, setAudience] = useState<ProjectAudience>(defaults?.audience ?? 'individual')
  const [groupSetId, setGroupSetId] = useState(defaults?.group_set_id ?? '')
  const [totalPoints, setTotalPoints] = useState(defaults?.total_points ?? 100)
  // A new project's deadline follows the end of its weeks until the professor
  // types one. An edited project keeps what it had.
  const [dueTouched, setDueTouched] = useState(Boolean(defaults))
  const [dueAt, setDueAt] = useState(
    defaults ? toLocalInput(defaults.due_at) : spanDeadline(weeks, span),
  )
  const [scheduled, setScheduled] = useState(Boolean(defaults?.release_at))
  const [releaseAt, setReleaseAt] = useState(toLocalInput(defaults?.release_at ?? null))
  const [criteria, setCriteria] = useState<CriterionInput[]>(defaultCriteria)
  const [file, setFile] = useState<File | null>(null)
  const [sections, setSections] = useState<SectionChoice[]>([])
  const [invalid, setInvalid] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [confirmDraft, setConfirmDraft] = useState(false)

  const hasBrief =
    guidelines.trim().length > 0 || criteria.some((c) => c.label.trim() || c.description.trim())

  /**
   * Fills the brief and the rubric from the weeks picked above. Only ever
   * fills the form: nothing is saved until the professor saves the project.
   */
  async function draftBrief() {
    const classId = weeks[0]?.class_id
    if (!classId) return
    setDrafting(true)
    setDraftError(null)
    setDraftNote(null)
    try {
      const res = await draftProject({
        classId,
        startWeek: span.start,
        endWeek: span.end,
        title,
        type,
        typeLabel,
        audience,
        totalPoints,
      })
      if (res.result !== 'ok') {
        setDraftError(res.message ?? 'No draft could be produced.')
        return
      }
      if (!res.guidelines?.trim() && !res.criteria?.length) {
        setDraftError(res.note || 'These weeks give too little to draft from. Write the brief by hand.')
        return
      }
      setGuidelines(res.guidelines ?? '')
      if (res.criteria?.length) setCriteria(res.criteria)
      setDraftNote(
        res.note ||
          'Drafted from the weeks above. Read it through and change anything before you save.',
      )
    } catch (err) {
      setDraftError(authErrorMessage(err, 'The draft could not be produced. Try again.'))
    } finally {
      setDrafting(false)
    }
  }

  function changeSpan(next: WeekSpan) {
    setSpan(next)
    if (!dueTouched) setDueAt(spanDeadline(weeks, next))
  }

  const suggestions = useMemo(() => spanSuggestions(weeks, span), [weeks, span])
  const feasibility = assessDeadline({
    type,
    dueAt: fromLocalInput(dueAt),
    releaseAt: scheduled ? fromLocalInput(releaseAt) : null,
    spanEnd: spanEndDate(weeks, span),
  })
  // A closed set is a finalised arrangement — the strongest thing to assign to,
  // not something to hide. Only sets with no groups left are unusable.
  const chosenSet = groupSets.find((s) => s.id === groupSetId)

  // A save that failed on the server lands in the same place, and is just as
  // easy to miss from the bottom of the form.
  useEffect(() => {
    if (!error) return
    alertRef.current?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'center',
    })
  }, [error, reduce])

  /**
   * Say what is wrong, then take the professor to it. The form is four sections
   * inside a scrolling modal, so on a long one the message can be well above
   * the fold when the button is pressed — and a save that appears to do nothing
   * reads as broken rather than refused.
   *
   * Scrolling here rather than in an effect on `invalid` is deliberate: pressing
   * save twice on the same mistake leaves the message unchanged, and an effect
   * keyed on it would not fire the second time.
   */
  function fail(message: string) {
    setInvalid(message)
    // Next frame, so the alert is in the DOM to be scrolled to.
    requestAnimationFrame(() => {
      alertRef.current?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      })
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return fail('Give the project a name.')
    if (type === 'other' && !typeLabel.trim()) return fail('Name the project type.')
    if (audience === 'group' && !groupSetId) {
      return fail('Pick which set of groups gets this project.')
    }
    // A section with no arrangement named would be refused by the database
    // anyway, and the whole fan-out with it — better to say which one here.
    if (audience === 'group') {
      const missing = sections.find((x) => !x.groupSetId)
      if (missing) {
        const cls = sectionOptions?.classes.find((c) => c.id === missing.classId)
        return fail(
          `Pick which groups get this project in ${cls ? `${cls.initial} · ${cls.section}` : 'the other section'}.`,
        )
      }
    }
    if (!guidelines.trim()) {
      return fail('Say what the work is. Students see this as the brief.')
    }

    // A half-filled row is worse than no row: it marks against a criterion
    // nobody named, or names one worth nothing.
    const filled = criteria.filter((c) => c.label.trim() || c.max_points > 0)
    if (filled.length === 0) {
      return fail('Add at least one criterion to mark against.')
    }
    const unnamed = filled.find((c) => !c.label.trim())
    if (unnamed) return fail('Every criterion needs a name.')
    const worthless = filled.find((c) => !(c.max_points > 0))
    if (worthless) {
      return fail(`"${worthless.label.trim()}" needs to be worth more than zero.`)
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
      criteria: criteria.filter((c) => c.label.trim()),
      file,
      sections,
    })
  }

  return (
    <form id={formId} onSubmit={submit} className="space-y-8">
      <div ref={alertRef} className="scroll-mt-4">
        {(error || invalid) && <Alert tone="error">{error ?? invalid}</Alert>}
      </div>

      <Section
        step={1}
        title="What it is based on"
        hint="Every project hangs off the weeks of this class's syllabus."
      >
        <WeekSpanPicker weeks={weeks} value={span} onChange={changeSpan} />
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
              <span className="text-[12px] text-faint">From the syllabus:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTitle(s)}
                  className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink transition-colors hover:bg-[var(--surface-sunken)]"
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

          <p className="-mt-1 text-[12px] text-faint">
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
                      <span className="block text-[12px] text-muted">
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
            (groupSets.length === 0 ? (
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
                      options={groupSets.map((s) => ({
                        value: s.id,
                        label:
                          `${s.name} · ${s.group_count} group${s.group_count === 1 ? '' : 's'}` +
                          `, ${s.member_count} student${s.member_count === 1 ? '' : 's'}` +
                          (s.closed_at ? ' · final' : ''),
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
                {chosenSet &&
                  !chosenSet.closed_at &&
                  chosenSet.mode === 'student_formed' && (
                    <Alert tone="info">
                      {chosenSet.name} is still open, so students can move between groups.
                      Close the set once the teams are final.
                    </Alert>
                  )}
              </>
            ))}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line px-3.5 py-3">
            <p className="text-[13px] text-muted">
              Start the brief and rubric from weeks {span.start}–{span.end} of the syllabus.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={drafting}
              onClick={() => (hasBrief ? setConfirmDraft(true) : void draftBrief())}
            >
              {!drafting && <Icon name="spark" size={14} />}
              Draft with AI
            </Button>
          </div>
          {draftError && <Alert tone="error">{draftError}</Alert>}
          {draftNote && (
            <p className="flex items-start gap-2 text-[12px] text-muted">
              <Icon name="info" size={14} className="mt-px shrink-0" />
              {draftNote}
            </p>
          )}
          <ConfirmDialog
            open={confirmDraft}
            onClose={() => setConfirmDraft(false)}
            onConfirm={() => void draftBrief()}
            tone="primary"
            title="Replace the brief and rubric?"
            confirmLabel="Replace them"
            body="The draft takes the place of what you have written in Guidelines and the rubric. Nothing is saved until you save the project."
          />

          <Field label="Guidelines">
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

      {sectionOptions && (
        <Section
          step={3}
          title="Where it runs"
          hint="Give the same project to more than one section of the course."
        >
          <SectionPicker
            primary={sectionOptions.primary}
            classes={sectionOptions.classes}
            groupSets={sectionOptions.groupSets}
            audience={audience}
            chosen={sections}
            onChange={setSections}
          />
        </Section>
      )}

      <Section step={sectionOptions ? 4 : 3} title="Marking" hint="A total, and the criteria you mark against. At least one is required.">
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
        step={sectionOptions ? 5 : 4}
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
                onChange={(e) => {
                  setDueTouched(true)
                  setDueAt(e.target.value)
                }}
              />
            )}
          </Field>
          {!dueTouched && dueAt && (
            <p className="text-[12px] text-faint">
              Set to the end of week {span.end}. Change it if the work is due sooner.
            </p>
          )}

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
                  <span className="block text-[12px] text-muted">
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

      <Section step={sectionOptions ? 6 : 5} title="Files" hint="Attach the brief or a starter file. Optional.">
        <div className="space-y-2">
          <FileDrop
            file={file}
            onPick={setFile}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg"
            maxSize={20}
            hint="PDF, Word, Excel, PowerPoint, or an image. Up to 20 MB."
          />
          {defaults && defaults.attachment_count > 0 && (
            <p className="text-[12px] text-faint">
              {defaults.attachment_count} file{defaults.attachment_count === 1 ? '' : 's'} already
              attached — manage them on the project page.
            </p>
          )}
          {file && (
            <p className="text-[12px] text-faint">
              {file.name} · {formatBytes(file.size)} will be attached when you save.
            </p>
          )}
        </div>
      </Section>
    </form>
  )
}
