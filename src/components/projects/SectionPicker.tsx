import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import type { LiveGroupSet } from '../../lib/api/groups'
import type { SectionTarget } from '../../lib/api/projects'
import type { ClassSummary, ProjectAudience } from '../../lib/types'

/**
 * Rows that share a checkbox, a title and a right-hand slot. Written here
 * rather than reached for from ui/ because a checkbox is the one control the
 * design system never needed until now — everything else is a single choice.
 */
function Row({
  checked,
  disabled,
  onToggle,
  title,
  hint,
  children,
}: {
  checked: boolean
  disabled?: boolean
  onToggle: () => void
  title: string
  hint: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        checked ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12' : 'border-line'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={checked}
        className="flex w-full items-start gap-3 text-left disabled:cursor-not-allowed"
      >
        <span
          className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border ${
            checked
              ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-500'
              : 'border-[var(--control-line)]'
          }`}
        >
          {checked && <Icon name="check" size={12} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-ink">{title}</span>
          <span className="block text-[12.5px] text-muted">{hint}</span>
        </span>
      </button>
      {children && <div className="mt-3 pl-[30px]">{children}</div>}
    </div>
  )
}

export type SectionChoice = SectionTarget & { classId: string }

/**
 * Which sections a new project is written to.
 *
 * The class the professor already picked is the first section and cannot be
 * unticked — it is the one they are creating from, and the week span came from
 * its syllabus. Everything else is theirs to add.
 *
 * A section is offered but marked when its syllabus differs from the first
 * one's: week 5 is then a different topic there, which is a judgement the
 * professor makes rather than something to refuse. A section with no syllabus
 * at all is refused, because a project has nowhere to hang.
 */
export function SectionPicker({
  primary,
  classes,
  groupSets,
  audience,
  chosen,
  onChange,
}: {
  primary: ClassSummary
  /** Every class the professor teaches, the primary one included. */
  classes: ClassSummary[]
  /** Live sets for every class in `classes`, loaded in one go. */
  groupSets: LiveGroupSet[]
  audience: ProjectAudience
  chosen: SectionChoice[]
  onChange: (next: SectionChoice[]) => void
}) {
  const others = classes.filter((c) => c.id !== primary.id)
  // Same course, same term — the sections this feature exists for. Offering
  // them first is what keeps the list from reading as "all my classes".
  const sameCourse = others.filter(
    (c) =>
      c.initial === primary.initial &&
      c.semester === primary.semester &&
      c.school_year === primary.school_year,
  )
  const rest = others.filter((c) => !sameCourse.includes(c))

  const setsFor = (classId: string) => groupSets.filter((s) => s.class_id === classId)
  const pick = (classId: string) => chosen.find((c) => c.classId === classId)

  function toggle(cls: ClassSummary) {
    if (cls.id === primary.id) return
    const already = pick(cls.id)
    if (already) {
      onChange(chosen.filter((c) => c.classId !== cls.id))
    } else {
      const only = setsFor(cls.id)
      onChange([
        ...chosen,
        // One arrangement is not a choice worth making them make.
        { classId: cls.id, groupSetId: only.length === 1 ? only[0].id : null },
      ])
    }
  }

  function setGroupSet(classId: string, setId: string) {
    onChange(
      chosen.map((c) => (c.classId === classId ? { ...c, groupSetId: setId || null } : c)),
    )
  }

  function row(cls: ClassSummary, isPrimary: boolean) {
    const sets = setsFor(cls.id)
    const chosenHere = isPrimary || Boolean(pick(cls.id))
    const noSyllabus = !cls.syllabus_id
    const otherSyllabus = !isPrimary && !noSyllabus && cls.syllabus_id !== primary.syllabus_id
    const noGroups = audience === 'group' && sets.length === 0

    const hint = isPrimary
      ? 'The section you are creating from.'
      : noSyllabus
        ? 'No syllabus attached, so a project has no weeks to hang off.'
        : noGroups
          ? 'No groups to assign to. Make a set in this class first.'
          : `${cls.student_count} student${cls.student_count === 1 ? '' : 's'}`

    return (
      <Row
        key={cls.id}
        checked={chosenHere}
        disabled={isPrimary || noSyllabus || noGroups}
        onToggle={() => toggle(cls)}
        title={`${cls.initial}  ·  ${cls.section}`}
        hint={hint}
      >
        {otherSyllabus && chosenHere && (
          <p className="flex gap-1.5 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-300">
            <Icon name="clock" size={13} className="mt-0.5 shrink-0" />
            This section follows a different syllabus, so the same week numbers may not
            be the same topic.
          </p>
        )}
        {audience === 'group' && chosenHere && !isPrimary && sets.length > 0 && (
          <Select
            value={pick(cls.id)?.groupSetId ?? ''}
            onChange={(e) => setGroupSet(cls.id, e.target.value)}
            placeholder="Pick this section's groups"
            options={sets.map((s) => ({
              value: s.id,
              label:
                `${s.name} · ${s.group_count} group${s.group_count === 1 ? '' : 's'}` +
                (s.closed_at ? ' · final' : ''),
            }))}
            className="h-11 text-[14px]"
          />
        )}
      </Row>
    )
  }

  const count = chosen.length + 1

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {row(primary, true)}
        {sameCourse.map((c) => row(c, false))}
      </div>

      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-ink">
            <span className="inline-flex items-center gap-1.5">
              <Icon
                name="chevronDown"
                size={14}
                className="transition-transform group-open:rotate-180"
              />
              Your other classes ({rest.length})
            </span>
          </summary>
          <div className="mt-3 space-y-2">{rest.map((c) => row(c, false))}</div>
        </details>
      )}

      {count > 1 && (
        <Alert tone="info">
          <p>
            {count} sections get their own copy — their own boards, deadline and rubric.
            Afterwards you choose which of them an edit applies to, so one section can be
            given an extension without moving the others.
          </p>
        </Alert>
      )}
    </div>
  )
}
