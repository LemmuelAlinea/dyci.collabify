export type ReportKind = 'grading' | 'peer' | 'checkin' | 'notes' | 'progress' | 'deliverables' | 'formal' | 'activity'

/** Every report is built as a ReportDoc and shares the preview, the live refresh and the export menu. */
export const DOC_KINDS: ReportKind[] = ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables', 'formal', 'activity']

/** Which pickers a report needs before it can be drawn. */
export const NEEDS: Record<ReportKind, ('class' | 'project')[]> = {
  grading: ['class', 'project'],
  peer: ['class', 'project'],
  checkin: ['class'],
  notes: ['class'],
  progress: ['class', 'project'],
  deliverables: ['class', 'project'],
  formal: ['class'],
  activity: ['class'],
}

/** The seven sheets B4 retired, the report each now opens, and the address it needs there. */
export const LEGACY_REPORTS: Record<string, { kind: ReportKind; set: Record<string, string> }> = {
  class_term: { kind: 'formal', set: {} },
  term_summary: { kind: 'formal', set: { rclass: 'all' } },
  coverage: { kind: 'formal', set: {} },
  contribution: { kind: 'grading', set: { rproject: '' } },
  class_record: { kind: 'grading', set: { rproject: 'all', rstudent: '' } },
  comparison: { kind: 'progress', set: { rgroup: '' } },
  board: { kind: 'progress', set: {} },
}

/**
 * The report named in the address, or the grading sheet. A retired name reads
 * as its replacement. An own-key check, so `?report=toString` and the other
 * names every object inherits never pass for a report.
 */
export function parseReportKind(raw: string | null): ReportKind {
  if (raw && Object.hasOwn(LEGACY_REPORTS, raw)) return LEGACY_REPORTS[raw].kind
  return raw && Object.hasOwn(NEEDS, raw) ? (raw as ReportKind) : 'grading'
}

/** The address change that turns a retired sheet's link into its replacement, or null. */
export function legacyRedirect(raw: string | null): Record<string, string> | null {
  if (!raw || !Object.hasOwn(LEGACY_REPORTS, raw)) return null
  const { kind, set } = LEGACY_REPORTS[raw]
  return { report: kind, ...set }
}

/**
 * The class a report is about: the class page's own, the one in the address,
 * or the first. `all` is the term record's every-class choice; any other
 * report reads it as no choice, so it never reaches one that needs a class.
 */
export function chosenClass(
  kind: ReportKind,
  raw: string | null,
  locked: string | undefined,
  first: string | undefined,
): { classId: string; allClasses: boolean } {
  if (locked) return { classId: locked, allClasses: false }
  if (raw === 'all') return kind === 'formal' ? { classId: '', allClasses: true } : { classId: first ?? '', allClasses: false }
  return { classId: raw || first || '', allClasses: false }
}
