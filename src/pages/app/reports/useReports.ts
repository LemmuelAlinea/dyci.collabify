import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLive } from '../../../hooks/useLive'
import { listMembers } from '../../../lib/api/classes'
import { boardsFor } from '../../../lib/api/dashboard'
import { listProjectsForClasses } from '../../../lib/api/projects'
import { listReassignments } from '../../../lib/api/reassignments'
import { boardResult } from '../../../lib/api/results'
import { boardTasks, classReports, studentWork, weekCoverage } from '../../../lib/api/reports'
import { authErrorMessage } from '../../../lib/authError'
import { NOTE_KIND_META } from '../../../lib/notes'
import type { BoardTask, ClassReport, StudentWork, WeekCoverage } from '../../../lib/report'
import { EVENT_META } from '../../../lib/reports/activityLog'
import { parseDueChoice, parseRangeChoice } from '../../../lib/reports/range'
import type { DueChoice, RangeChoice } from '../../../lib/reports/range'
import type {
  BoardSummary,
  ClassMember,
  ClassNoteKind,
  ProjectSummary,
  ReassignmentRow,
  TaskEventKind,
} from '../../../lib/types'

import { chosenClass, NEEDS, parseReportKind } from './reportKind'
import type { ReportKind } from './reportKind'

/** Reports that take a student but do not need one. On the activity log the student is who acted. */
export const OPTIONAL_STUDENT: ReportKind[] = ['grading', 'notes', 'activity']

export type NoteStatus = 'open' | 'resolved' | 'all'

/** Whether a project choice is one this report can take: 'all' for the grading sheet and compliance, group projects for peer. */
function projectFits(kind: ReportKind, projectId: string, projects: { id: string; audience: string }[]) {
  if (!projectId) return false
  if (projectId === 'all') return kind === 'grading' || kind === 'deliverables'
  const p = projects.find((x) => x.id === projectId)
  return p !== undefined && (kind !== 'peer' || p.audience === 'group')
}

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
  const kind = parseReportKind(params.get('report'))
  const projectId = params.get('rproject') ?? ''
  const boardId = params.get('rgroup') ?? ''
  const studentId = params.get('rstudent') ?? ''
  const roundId = params.get('rround') ?? ''
  const comments = params.get('rcomments') === '1'
  // The check-in has no 30-day window, so a link carrying one reads as this week.
  const rawRange = parseRangeChoice(params.get('rrange'), kind === 'notes' || kind === 'activity' ? 'last30' : 'thisWeek')
  const rangeChoice = kind === 'checkin' && rawRange === 'last30' ? 'thisWeek' : rawRange
  const customFrom = params.get('rfrom') ?? ''
  const customTo = params.get('rto') ?? ''
  const dueChoice = parseDueChoice(params.get('rdue'))
  const rawKinds = params.get('rkinds') ?? ''
  const noteKinds = useMemo(
    () => rawKinds.split(',').filter((k) => Object.hasOwn(NOTE_KIND_META, k)) as ClassNoteKind[],
    [rawKinds],
  )
  const rawStatus = params.get('rstatus') ?? ''
  const noteStatus: NoteStatus = rawStatus === 'open' || rawStatus === 'resolved' ? rawStatus : 'all'
  const rawEvents = params.get('revents') ?? ''
  const eventKinds = useMemo(
    () => rawEvents.split(',').filter((k) => Object.hasOwn(EVENT_META, k)) as TaskEventKind[],
    [rawEvents],
  )

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
  // One flag per loader, so one finishing never clears the other's spinner.
  const [classBusy, setClassBusy] = useState(false)
  const [boardBusy, setBoardBusy] = useState(false)
  const busy = classBusy || boardBusy
  // The class the arrays above were last loaded for. Until it matches, a project
  // choice in the address cannot be judged, so it is neither used nor dropped.
  const [loadedFor, setLoadedFor] = useState('')

  const rawClass = params.get('rclass')
  const firstClass = classes?.[0]?.class_id
  // Memoized because the compiler cannot keep loadClass's memoization when classId comes from a bare call.
  const { classId, allClasses } = useMemo(
    () => chosenClass(kind, rawClass, lockedClassId, firstClass),
    [kind, rawClass, lockedClassId, firstClass],
  )
  const setClassId = useCallback(
    (v: string) => patch({ rclass: v, rproject: '', rgroup: '', rstudent: '', rround: '' }),
    [patch],
  )
  const setProjectId = useCallback((v: string) => patch({ rproject: v, rround: '' }), [patch])
  const setBoardId = useCallback((v: string) => patch({ rgroup: v }), [patch])
  const setStudentId = useCallback((v: string) => patch({ rstudent: v }), [patch])
  const setRoundId = useCallback((v: string) => patch({ rround: v }), [patch])
  const setComments = useCallback((on: boolean) => patch({ rcomments: on ? '1' : '' }), [patch])
  const setRangeChoice = useCallback(
    (v: RangeChoice) => patch(v === 'custom' ? { rrange: v } : { rrange: v, rfrom: '', rto: '' }),
    [patch],
  )
  const setDueChoice = useCallback(
    (v: DueChoice) => patch(v === 'custom' ? { rdue: v } : { rdue: v === 'all' ? '' : v, rfrom: '', rto: '' }),
    [patch],
  )
  const setCustomRange = useCallback((from: string, to: string) => patch({ rfrom: from, rto: to }), [patch])
  const setNoteKinds = useCallback((list: ClassNoteKind[]) => patch({ rkinds: list.join(',') }), [patch])
  const setNoteStatus = useCallback((v: NoteStatus) => patch({ rstatus: v === 'all' ? '' : v }), [patch])
  const setEventKinds = useCallback((list: TaskEventKind[]) => patch({ revents: list.join(',') }), [patch])

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
  // Each load takes a number; only the newest may write. Otherwise a slow load
  // for the previous class (or an older live refresh) landing last would put
  // its arrays and its `loadedFor` over the current class's.
  const classSeq = useRef(0)
  const loadClass = useCallback(async () => {
    const mine = ++classSeq.current
    const latest = () => mine === classSeq.current
    if (!classId) {
      setClassBusy(false)
      return
    }
    setClassBusy(true)
    try {
      const [w, s, m, p, r] = await Promise.all([
        weekCoverage(classId),
        studentWork(classId),
        listMembers(classId),
        listProjectsForClasses([classId]),
        listReassignments(),
      ])
      if (!latest()) return
      const b = await boardsFor(p.map((x) => x.id))
      if (!latest()) return
      // Written together after both round trips, so the page never holds this
      // class's projects beside another load's boards.
      setWeeks(w)
      setWork(s)
      setMembers(m)
      setProjects(p)
      setReassignments(r.filter((x) => x.class_id === classId))
      setBoards(b)
      setError(null)
    } catch (err) {
      if (latest()) setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      if (latest()) {
        setLoadedFor(classId)
        setClassBusy(false)
      }
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
    'group_members',
  ])

  // The verdict's reason lives on the result row rather than the board, so it
  // is only worth fetching once a board is actually chosen.
  // Its own counter: switching boards quickly must not let the first board's
  // tasks land over the second's.
  const boardSeq = useRef(0)
  useEffect(() => {
    const mine = ++boardSeq.current
    const latest = () => mine === boardSeq.current
    // Only the group report reads a board's tasks and verdict. For the intervention
    // log the group is just a filter, and fetching them would flash "Gathering it…".
    if (!boardId || kind !== 'board') {
      setTasks([])
      setFeedback(null)
      setBoardBusy(false)
      return
    }
    void (async () => {
      setBoardBusy(true)
      try {
        const [t, r] = await Promise.all([boardTasks(boardId), boardResult(boardId)])
        if (!latest()) return
        setTasks(t)
        setFeedback(r?.feedback ?? null)
        setError(null)
      } catch (err) {
        if (latest()) setError(authErrorMessage(err, 'Could not load that board.'))
      } finally {
        if (latest()) setBoardBusy(false)
      }
    })()
  }, [boardId, kind])

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

  /** True from choosing a class until its projects, boards and work have arrived. */
  const settling = Boolean(classId) && loadedFor !== classId

  const choose = useCallback(
    (next: ReportKind) => {
      // A picker the new report does not use would otherwise keep narrowing it.
      const out: Record<string, string> = { report: next }
      // A project the new report cannot take (all projects, or a solo project
      // for peer evaluation) is dropped rather than left to draw nothing.
      const keepsProject = NEEDS[next].includes('project') || next === 'activity'
      if (
        !keepsProject ||
        (NEEDS[next].includes('project') && !settling && !projectFits(next, projectId, projects)) ||
        (next === 'activity' && projectId === 'all')
      ) out.rproject = ''
      // The intervention log and the activity log filter by group without needing one.
      if (!NEEDS[next].includes('board') && next !== 'notes' && next !== 'activity') out.rgroup = ''
      if (!NEEDS[next].includes('student') && !OPTIONAL_STUDENT.includes(next)) out.rstudent = ''
      // Dates and filters belong to the reports that use them. The compliance report
      // takes its dates from `rdue`, but shares the custom From and To.
      const dated = next === 'checkin' || next === 'notes' || next === 'activity'
      if (!dated) out.rrange = ''
      if (!dated && next !== 'deliverables') {
        out.rfrom = ''
        out.rto = ''
      }
      if (next !== 'deliverables') out.rdue = ''
      if (next !== 'activity') out.revents = ''
      // Every class is the term record's alone.
      if (next !== 'formal' && params.get('rclass') === 'all') out.rclass = ''
      if (next !== 'notes') {
        out.rkinds = ''
        out.rstatus = ''
      }
      if (next !== 'peer') {
        out.rround = ''
        out.rcomments = ''
      }
      patch(out)
    },
    [patch, params, projectId, projects, settling],
  )

  /** Whether the chosen report has everything it needs to be drawn. */
  const ready =
    !settling &&
    (!NEEDS[kind].includes('class') || Boolean(cls) || allClasses) &&
    (!NEEDS[kind].includes('project') ||
      projectFits(kind, projectId, projects) ||
      (OPTIONAL_STUDENT.includes(kind) && Boolean(studentId))) &&
    (!NEEDS[kind].includes('board') || Boolean(board)) &&
    (!NEEDS[kind].includes('student') || Boolean(studentId))

  return {
    kind,
    choose,
    loading: classes === null,
    busy,
    settling,
    error,
    classes: classes ?? [],
    cls,
    classId,
    allClasses,
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
    rangeChoice,
    setRangeChoice,
    customFrom,
    customTo,
    setCustomRange,
    dueChoice,
    setDueChoice,
    noteKinds,
    setNoteKinds,
    noteStatus,
    setNoteStatus,
    eventKinds,
    setEventKinds,
    params,
    weeks,
    work,
    members,
    projects,
    boards: shownBoards,
    /** The class's boards, whatever project is picked. */
    allBoards: boards,
    board,
    tasks,
    feedback,
    reassignments,
    students,
    ready,
  }
}
