import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActionMenu } from '../ui/ActionMenu'
import type { ActionMenuItem } from '../ui/ActionMenu'
import { Button } from '../ui/Button'
import { buttonClass } from '../ui/buttonClass'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { NEEDS } from '../../pages/app/reports/reportKind'
import type { ReportKind } from '../../pages/app/reports/reportKind'

/**
 * Choosing a report, at three widths.
 *
 * There are eight reports in four groups, each with a sentence explaining it,
 * and then up to four things to narrow it by. On a wide screen that is a column
 * beside the sheet and it reads well. Below that it was the whole of it stacked
 * on top of the sheet — on a phone you scrolled past seven cards and four
 * full-height selects before you saw a single line of the report you came for,
 * and a tablet in portrait got the same, because the sidebar only appeared at
 * 1280px.
 *
 * So: the same choices, two shapes, chosen by a container query at 860px —
 * 290 for the column, a gap, and enough sheet left to be worth showing. A
 * container and not `lg:`, because this page sits inside the app's rail: at a
 * 1024px window with the rail open there is only about 690px of page, which is
 * not enough for both, and a viewport breakpoint cannot know that. Collapse the
 * rail at the same window size and the column comes back, which is right.
 *
 * The catalogue is deliberately a dialog rather than a native select. The
 * sentence under each report is the part that tells a professor which of the
 * eight they actually want, and a native option list cannot carry it.
 */

export type ReportItem = {
  kind: ReportKind
  label: string
  body: string
}

export type ReportGroup = { group: string; items: ReportItem[] }

/** Just enough of `useReports` to drive the picker. */
export type PickerState = {
  kind: ReportKind
  choose: (k: ReportKind) => void
  classes: { class_id: string; class_initial: string; class_name: string; archived_at: string | null }[]
  classId: string
  setClassId: (v: string) => void
  /** Replaces the class list, for a report with an extra choice such as every class. */
  classOptions?: { value: string; label: string }[]
  /** The class select's value when it differs from `classId`, such as `all`. */
  classValue?: string
  projects: { id: string; title: string }[]
  projectId: string
  setProjectId: (v: string) => void
  boards: { id: string; group_name: string | null; student_name: string | null }[]
  boardId: string
  setBoardId: (v: string) => void
  students: { value: string; label: string }[]
  studentId: string
  setStudentId: (v: string) => void
  ready: boolean
  /** Replaces the project list, for a report with an extra choice such as all projects. */
  projectOptions?: { value: string; label: string }[]
  /** The student is a way to narrow the report, not something it needs. */
  studentOptional?: boolean
  /** Anything a report adds under its selects, such as a round or a switch. */
  extras?: ReactNode
}

const flat = (catalogue: ReportGroup[]) => catalogue.flatMap((g) => g.items)

function reportLabel(catalogue: ReportGroup[], kind: ReportKind) {
  return flat(catalogue).find((i) => i.kind === kind)?.label ?? 'Report'
}

/* ------------------------------------------------------------ the pieces */

/** The narrowing selects, in whatever order this report needs them. */
function About({ r }: { r: PickerState }) {
  const needs = NEEDS[r.kind]
  const size = '!h-11 !text-[13px] sm:!h-10 sm:!text-[13px]'

  return (
    <>
      {needs.includes('class') && (r.classOptions !== undefined || r.classes.length > 1) && (
        <Select
          aria-label="Class"
          value={r.classValue ?? r.classId}
          onChange={(e) => r.setClassId(e.target.value)}
          options={
            r.classOptions ??
            r.classes.map((c) => ({
              value: c.class_id,
              label: `${c.class_initial} · ${c.class_name}${c.archived_at ? ' (ended)' : ''}`,
            }))
          }
          className={size}
        />
      )}
      {needs.includes('project') && (
        <Select
          aria-label="Project"
          value={r.projectId}
          onChange={(e) => r.setProjectId(e.target.value)}
          placeholder="Pick a project"
          options={r.projectOptions ?? r.projects.map((p) => ({ value: p.id, label: p.title }))}
          className={size}
        />
      )}
      {r.studentOptional && (
        <div className="space-y-1">
          <Select
            aria-label="Student"
            value={r.studentId}
            onChange={(e) => r.setStudentId(e.target.value)}
            options={[{ value: '', label: 'Whole class' }, ...r.students]}
            className={size}
          />
          <p className="px-1 text-[12px] text-muted">Picking a student shows them across every project.</p>
        </div>
      )}
      {r.extras}
    </>
  )
}

function Actions({
  r,
  exports,
  printReady,
  className = '',
}: {
  r: PickerState
  exports: ActionMenuItem[]
  /** Whether there is a sheet to print. Defaults to the report having its choices. */
  printReady?: boolean
  className?: string
}) {
  return (
    // 44px on a phone, 36px where there is a pointer: these are the two things
    // on the page you actually press, and a thumb wants the taller target.
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <Button
        size="sm"
        className="!h-11 !rounded-xl sm:!h-9"
        disabled={!(printReady ?? r.ready)}
        onClick={() => window.print()}
      >
        <Icon name="file" size={14} />
        Print
      </Button>
      <ActionMenu
        label="Export"
        icon="download"
        items={exports}
        disabled={!r.ready}
        size="sm"
        showLabel
        align="start"
        triggerClassName={buttonClass({ variant: 'outline', size: 'sm', className: '!h-11 !rounded-xl sm:!h-9' })}
      />
    </div>
  )
}

/**
 * The eight, grouped. Used by the column and by the dialog, and the difference
 * between them is the sentence under each one.
 *
 * **Dense**, in the column: only the chosen report explains itself. Eight
 * descriptions at once is roughly eight hundred pixels of prose that somebody
 * reads once and then scrolls past every time afterwards — and it pushed Print
 * and the selects below the fold, which is how the controls for a page ended up
 * being the hardest part of it to find. Eight single lines are a list you can
 * take in at a glance, and the sentence arrives on the one you land on.
 *
 * **Full**, in the dialog: every description, because choosing is the only
 * thing that dialog is for and there is a whole screen to do it in.
 */
function Catalogue({
  catalogue,
  kind,
  onPick,
  dense = false,
}: {
  catalogue: ReportGroup[]
  kind: ReportKind
  onPick: (k: ReportKind) => void
  dense?: boolean
}) {
  return (
    <div className={dense ? 'space-y-3' : 'space-y-4'}>
      {catalogue.map((g) => (
        <div key={g.group} className={dense ? 'space-y-1' : 'space-y-2'}>
          <p
            className={
              dense
                ? 'px-1 pb-0.5 text-[12px] font-medium tracking-wide text-faint uppercase'
                : 'eyebrow text-faint'
            }
          >
            {g.group}
          </p>
          {g.items.map((item) => {
            const on = kind === item.kind
            return (
              <button
                key={item.kind}
                type="button"
                aria-pressed={on}
                onClick={() => onPick(item.kind)}
                className={`block w-full rounded-xl border text-left transition-colors ${
                  dense ? 'px-3 py-2' : 'px-3.5 py-2.5'
                } ${
                  on
                    ? 'border-navy-400 bg-navy-500/8'
                    : 'surface border-line hover:border-line-strong'
                }`}
              >
                <span
                  className={`flex items-center gap-2 text-ink ${
                    dense ? 'text-[13px]' : 'text-[14px]'
                  } ${on && dense ? 'font-medium' : ''}`}
                >
                  {item.label}
                  {on && (
                    <Icon
                      name="check"
                      size={14}
                      className="ml-auto shrink-0 text-navy-600 dark:text-navy-200"
                    />
                  )}
                </span>
                {(!dense || on) && (
                  <span
                    className={`block leading-relaxed text-muted ${
                      dense ? 'mt-1 text-[12px]' : 'mt-0.5 text-[12px]'
                    }`}
                  >
                    {item.body}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ the layouts */

/**
 * From 860px up: a column beside the sheet, and it stays put.
 *
 * It used to scroll away with the page. A class record runs to several screens,
 * so by the time a professor had read enough to know they wanted a different
 * report, or a different group, every control for changing it was above the
 * fold behind them — and Print, which is the whole point of the page, was the
 * furthest thing from wherever they were looking.
 *
 * Sticky, with its own scroll only if it outgrows the window. Nothing in here
 * opens a floating layer — the selects are native, so their popups escape the
 * box on their own — which is the reason an `overflow` on this column is safe
 * when it would not have been on the nav.
 */
export function ReportSidebar({
  catalogue,
  r,
  exports,
  printReady,
}: {
  catalogue: ReportGroup[]
  r: PickerState
  exports: ActionMenuItem[]
  printReady?: boolean
}) {
  return (
    <div className="hidden @min-[860px]:block print:hidden">
      <div className="sticky top-[72px] max-h-[calc(100dvh-96px)] space-y-4 overflow-y-auto pb-1 [scrollbar-width:thin]">
        <Catalogue catalogue={catalogue} kind={r.kind} onPick={r.choose} dense />

        <section className="space-y-2">
          <p className="px-1 text-[12px] font-medium tracking-wide text-faint uppercase">
            What it is about
          </p>
          <About r={r} />
        </section>

        <Actions r={r} exports={exports} printReady={printReady} />
      </div>
    </div>
  )
}

/** Below `lg`: one line above the sheet, and the catalogue behind a dialog. */
export function ReportBar({
  catalogue,
  r,
  exports,
  printReady,
}: {
  catalogue: ReportGroup[]
  r: PickerState
  exports: ActionMenuItem[]
  printReady?: boolean
}) {
  const [open, setOpen] = useState(false)
  const needs = NEEDS[r.kind].length + (r.studentOptional ? 1 : 0) + (r.extras ? 1 : 0)

  return (
    <div className="space-y-3 @min-[860px]:hidden print:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="surface flex w-full items-center gap-3 rounded-xl border border-[var(--control-line)] px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
      >
        <Icon name="file" size={16} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[12px] tracking-wider text-faint uppercase">
            Report
          </span>
          <span className="block truncate text-[14px] font-medium text-ink">
            {reportLabel(catalogue, r.kind)}
          </span>
        </span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-faint" />
      </button>

      {/* Two across when a report needs two things to narrow it, which is the
          most any of them needs beyond the class. */}
      <div className={`grid gap-2 ${needs > 1 ? 'sm:grid-cols-2' : ''}`}>
        <About r={r} />
      </div>

      <Actions r={r} exports={exports} printReady={printReady} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Which report"
        description="Pick one, then choose what it is about."
        size="md"
      >
        <Catalogue
          catalogue={catalogue}
          kind={r.kind}
          onPick={(k) => {
            r.choose(k)
            setOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}
