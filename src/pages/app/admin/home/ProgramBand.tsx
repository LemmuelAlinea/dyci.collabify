import { Alert } from '../../../../components/ui/Alert'
import { Badge } from '../../../../components/ui/Badge'
import { programClasses } from '../../../../lib/api/admin'
import { paceOf, readiness } from '../../../../lib/program'
import type { ProgramClass } from '../../../../lib/program'
import { paths } from '../../../../lib/paths'
import { Band, BandLoading } from './Band'
import { useRead } from './useRead'

const SHOWN = 4

/**
 * The academic program, read the way Program classes reads it: classes that
 * cannot start and classes behind on the syllabus. Classes whose term has
 * ended are left out, since neither question applies to them any more. The
 * band is absent when the program has no classes at all.
 */
export function ProgramBand() {
  const { data, failed, load } = useRead(programClasses)

  if (data && data.length === 0) return null

  const running = (data ?? []).filter((c) => c.archived_at === null)
  const notReady = running.filter((c) => readiness(c).length > 0)
  const behind = running.filter((c) => {
    const p = paceOf(c)
    return p ? p.weeks_covered < p.weeks_elapsed : false
  })

  return (
    <Band
      name="program"
      eyebrow="Academic program"
      title="Classes"
      link={{ to: paths.admin.classes, label: 'Open classes' }}
    >
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The program's classes did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the program…</BandLoading>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <ClassGroup
            kind="not-ready"
            label="Cannot start"
            note="Missing term dates, a syllabus, students or a released project."
            classes={notReady}
            empty="Every running class is ready to start."
          />
          <ClassGroup
            kind="behind"
            label="Behind on the syllabus"
            note="Fewer syllabus weeks covered than weeks gone by."
            classes={behind}
            empty="Every dated class is on pace."
          />
        </div>
      )}
    </Band>
  )
}

function ClassGroup({
  kind,
  label,
  note,
  classes,
  empty,
}: {
  kind: 'not-ready' | 'behind'
  label: string
  note: string
  classes: ProgramClass[]
  empty: string
}) {
  const rest = classes.length - SHOWN

  return (
    <div data-program={kind} className="rounded-card border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">{note}</p>
        </div>
        <span
          data-count
          className={`font-mono text-[22px] leading-none font-bold ${
            classes.length === 0
              ? 'text-ink'
              : kind === 'behind'
                ? 'text-danger-700 dark:text-danger-300'
                : 'text-warning-700 dark:text-warning-300'
          }`}
        >
          {classes.length}
        </span>
      </div>
      {classes.length === 0 ? (
        <p className="mt-3 text-[12px] text-faint">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {classes.slice(0, SHOWN).map((c) => (
            <li key={c.class_id}>
              <Badge tone={kind === 'behind' ? 'danger' : 'warning'}>
                {c.class_initial} · {c.section}
              </Badge>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <Badge>{rest} more</Badge>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
