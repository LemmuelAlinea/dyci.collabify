export type ReportKind =
  | 'class_term'
  | 'coverage'
  | 'contribution'
  | 'board'
  | 'comparison'
  | 'class_record'
  | 'term_summary'
  | 'grading'
  | 'peer'
  | 'checkin'
  | 'notes'
  | 'progress'
  | 'deliverables'
  | 'formal'
  | 'activity'

/** The reports built as a ReportDoc, which share the preview, the live refresh and the export menu. */
export const DOC_KINDS: ReportKind[] = ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables', 'formal', 'activity']

/** Which pickers a report needs before it can be drawn. */
export const NEEDS: Record<ReportKind, ('class' | 'project' | 'board' | 'student')[]> = {
  class_term: ['class'],
  coverage: ['class'],
  contribution: ['class', 'student'],
  board: ['class', 'project', 'board'],
  comparison: ['class', 'project'],
  class_record: ['class'],
  term_summary: [],
  grading: ['class', 'project'],
  peer: ['class', 'project'],
  checkin: ['class'],
  notes: ['class'],
  progress: ['class', 'project'],
  deliverables: ['class', 'project'],
  formal: ['class'],
  activity: ['class'],
}

/**
 * The report named in the address, or the grading sheet. An own-key check, so
 * `?report=toString` and the other names every object inherits never pass for a report.
 */
export function parseReportKind(raw: string | null): ReportKind {
  return raw && Object.hasOwn(NEEDS, raw) ? (raw as ReportKind) : 'grading'
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
