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

/** The reports built as a ReportDoc, which share the preview, the live refresh and the export menu. */
export const DOC_KINDS: ReportKind[] = ['grading', 'peer', 'checkin', 'notes', 'progress', 'deliverables']

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
}

/**
 * The report named in the address, or the grading sheet. An own-key check, so
 * `?report=toString` and the other names every object inherits never pass for a report.
 */
export function parseReportKind(raw: string | null): ReportKind {
  return raw && Object.hasOwn(NEEDS, raw) ? (raw as ReportKind) : 'grading'
}
