import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLive } from '../../../hooks/useLive'
import { listMembers } from '../../../lib/api/classes'
import { boardsFor } from '../../../lib/api/dashboard'
import { listProjectsForClasses } from '../../../lib/api/projects'
import { listReassignments } from '../../../lib/api/reassignments'
import { boardResult } from '../../../lib/api/results'
import { boardTasks, classReports, studentWork, weekCoverage } from '../../../lib/api/reports'
import { authErrorMessage } from '../../../lib/authError'
import type { BoardTask, ClassReport, StudentWork, WeekCoverage } from '../../../lib/report'
import type { BoardSummary, ClassMember, ProjectSummary, ReassignmentRow } from '../../../lib/types'

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
}

/** Reports that take a student but do not need one. */
export const OPTIONAL_STUDENT: ReportKind[] = ['grading']

/**
 * Everything the reports page reads, loaded in the order the pickers narrow.
 *
 * Reports are print-shaped rather than screen-shaped: one sheet is about one
 * subject, so this fetches per class rather than pulling every class's work up
 * front the way the analytics page does. A professor prints one report at a
 * time, and the class list alone is enough to draw the page.
 */
export function useReports(professorId: string | undefined, lockedClassId?: string) {
  // Every choice lives in the address, so a report can be linked and a reload
  // keeps it. The keys are prefixed because this page also renders inside a
  // class, whose own tab sits in `?tab=`.
  const [params, setParams] = useSearchParams()
  const patch = useCallback(
    (next: Record<string, string>) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          for (const [k, v] of Object.entries(next)) {
            if (v) n.set(k, v)
            else n.delete(k)
          }
          return n
        },
        { replace: true },
      ),
    [setParams],
  )
  const asked = params.get('report')
  const kind: ReportKind = asked && asked in NEEDS ? (asked as ReportKind) : 'grading'
  const projectId = params.get('rproject') ?? ''
  const boardId = params.get('rgroup') ?? ''
  const studentId = params.get('rstudent') ?? ''
  const roundId = params.get('rround') ?? ''
  const comments = params.get('rcomments') === '1'

  const [classes, setClasses] = useState<ClassReport[] | null>(null)
  const [weeks, setWeeks] = useState<WeekCoverage[]>([])
  const [work, setWork] = useState<StudentWork[]>([])
  const [members, setMembers] = useState<ClassMember[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [reassignments, setReassignments] = useState<ReassignmentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const classId = lockedClassId || params.get('rclass') || classes?.[0]?.class_id || ''
  const setClassId = useCallback(
    (v: string) => patch({ rclass: v, rproject: '', rgroup: '', rstudent: '', rround: '' }),
    [patch],
  )
  const setProjectId = useCallback((v: string) => patch({ rproject: v, rround: '' }), [patch])
  const setBoardId = useCallback((v: string) => patch({ rgroup: v }), [patch])
  const setStudentId = useCallback((v: string) => patch({ rstudent: v }), [patch])
  const setRoundId = useCallback((v: string) => patch({ rround: v }), [patch])
  const setComments = useCallback((on: boolean) => patch({ rcomments: on ? '1' : '' }), [patch])

  const loadClasses = useCallback(async () => {
    if (!professorId) return
    try {
      const rows = (await classReports()).filter(
        (row) => !lockedClassId || row.class_id === lockedClassId,
      )
      setClasses(rows)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your classes.'))
      setClasses([])
    }
  }, [professorId, lockedClassId])

  useEffect(() => {
    void loadClasses()
  }, [loadClasses])

  useLive(loadClasses, ['classes', 'class_members'])

  // One class's worth of everything. Cheap enough to fetch together, and it
  // keeps the four sheets that read from a class in step with each other.
  const loadClass = useCallback(async () => {
    if (!classId) return
    setBusy(true)
    try {
      const [w, s, m, p, r] = await Promise.all([
        weekCoverage(classId),
        studentWork(classId),
        listMembers(classId),
        listProjectsForClasses([classId]),
        listReassignments(),
      ])
      setWeeks(w)
      setWork(s)
      setMembers(m)
      setProjects(p)
      setReassignments(r.filter((x) => x.class_id === classId))
      setBoards(await boardsFor(p.map((x) => x.id)))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      setBusy(false)
    }
  }, [classId])

  useEffect(() => {
    void loadClass()
  }, [loadClass])

  useLive(loadClass, [
    'projects',
    'project_boards',
    'project_tasks',
    'task_assignees',
    'board_results',
    'task_reassignments',
    'syllabus_weeks',
    'class_members',
  ])

  // The verdict's reason lives on the result row rather than the board, so it
  // is only worth fetching once a board is actually chosen.
  useEffect(() => {
    if (!boardId) {
      setTasks([])
      setFeedback(null)
      return
    }
    void (async () => {
      setBusy(true)
      try {
        const [t, r] = await Promise.all([boardTasks(boardId), boardResult(boardId)])
        setTasks(t)
        setFeedback(r?.feedback ?? null)
        setError(null)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load that board.'))
      } finally {
        setBusy(false)
      }
    })()
  }, [boardId])

  const cls = useMemo(
    () => (classes ?? []).find((c) => c.class_id === classId) ?? null,
    [classes, classId],
  )
  const shownBoards = useMemo(
    () => boards.filter((b) => (projectId && projectId !== 'all' ? b.project_id === projectId : true)),
    [boards, projectId],
  )
  const board = useMemo(() => boards.find((b) => b.id === boardId) ?? null, [boards, boardId])

  /** Everyone with work in this class, for the contribution picker. */
  const students = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of members) {
      if (m.profile) seen.set(m.student_id, `${m.profile.last_name}, ${m.profile.first_name}`)
    }
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    )
  }, [members])

  const choose = useCallback(
    (next: ReportKind) => {
      // A picker the new report does not use would otherwise keep narrowing it.
      const out: Record<string, string> = { report: next }
      if (!NEEDS[next].includes('project')) out.rproject = ''
      // "All projects" only means something to the grading sheet.
      else if (next !== 'grading' && projectId === 'all') out.rproject = ''
      if (!NEEDS[next].includes('board')) out.rgroup = ''
      if (!NEEDS[next].includes('student') && !OPTIONAL_STUDENT.includes(next)) out.rstudent = ''
      if (next !== 'peer') {
        out.rround = ''
        out.rcomments = ''
      }
      patch(out)
    },
    [patch, projectId],
  )

  /** Whether the chosen report has everything it needs to be drawn. */
  const ready =
    (!NEEDS[kind].includes('class') || Boolean(cls)) &&
    (!NEEDS[kind].includes('project') ||
      Boolean(projectId) ||
      (OPTIONAL_STUDENT.includes(kind) && Boolean(studentId))) &&
    (!NEEDS[kind].includes('board') || Boolean(board)) &&
    (!NEEDS[kind].includes('student') || Boolean(studentId))

  return {
    kind,
    choose,
    loading: classes === null,
    busy,
    error,
    classes: classes ?? [],
    cls,
    classId,
    setClassId,
    projectId,
    setProjectId,
    boardId,
    setBoardId,
    studentId,
    setStudentId,
    roundId,
    setRoundId,
    comments,
    setComments,
    params,
    weeks,
    work,
    members,
    projects,
    boards: shownBoards,
    board,
    tasks,
    feedback,
    reassignments,
    students,
    ready,
  }
}
