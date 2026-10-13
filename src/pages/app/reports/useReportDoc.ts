import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { boardBurn, classActions, dailyActivity, milestoneProgress, studentRoster, taskStates } from '../../../lib/api/analytics'
import { listClassNoteLog, listClassNotes } from '../../../lib/api/notes'
import { listPeerRounds, peerComments, projectPeerResults } from '../../../lib/api/peer'
import { listCriteria } from '../../../lib/api/projects'
import { boardResultsFor } from '../../../lib/api/results'
import { projectBoardScores, scoreSheet } from '../../../lib/api/scores'
import { manilaDay } from '../../../lib/analyticsMath'
import { authErrorMessage } from '../../../lib/authError'
import { rankActions } from '../../../lib/insight'
import { generatedOn } from '../../../lib/report'
import { checkInDoc } from '../../../lib/reports/checkIn'
import type { ReportDoc } from '../../../lib/reports/doc'
import { gradingClassDoc, gradingGridDoc, gradingStudentDoc } from '../../../lib/reports/grading'
import { interventionLogDoc } from '../../../lib/reports/interventionLog'
import { defaultRound, peerSummaryDoc } from '../../../lib/reports/peerSummary'
import { resolveRange } from '../../../lib/reports/range'
import type { ClassNoteKind, PeerResult, PeerRoundStatus } from '../../../lib/types'
import type { useReports } from './useReports'

type R = ReturnType<typeof useReports>

type Built = {
  doc: ReportDoc | null
  key: string
  /** The build for this key failed and there is no sheet to fall back on. */
  error: string | null
  /** A refresh failed behind a sheet that is still shown. */
  refreshError: string | null
}

const finalRows = (rows: PeerResult[]) => rows.filter((p) => p.kind === 'final' && !p.is_open)

/** Loads the data a new-style report needs and builds its document. Old sheets return null. */
export function useReportDoc(r: R, professor: string) {
  // The doc and the choices it was built for travel together, so a rebuild in
  // flight never lets the previous project's sheet pass for the current one.
  const [built, setBuilt] = useState<Built>({ doc: null, key: '', error: null, refreshError: null })
  // Tagged with its project, so a new project never shows the previous one's rounds.
  const [roundsOf, setRoundsOf] = useState<{ projectId: string; list: PeerRoundStatus[] }>({ projectId: '', list: [] })
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  const {
    kind, cls, classId, projectId, boardId, studentId, roundId, comments, projects, boards, allBoards, work, students, ready,
    rangeChoice, customFrom, customTo, noteKinds, noteStatus,
  } = r
  const noteKindsKey = noteKinds.join(',')
  const currentKey = [
    kind, classId, projectId, studentId, roundId, comments ? 1 : 0,
    rangeChoice, customFrom, customTo, noteKindsKey, noteStatus, boardId,
  ].join('|')
  const termStart = cls?.term_start ?? null
  const ended = Boolean(cls?.archived_at)
  const classLine = cls ? `${cls.class_initial} · ${cls.class_name} · ${cls.section}` : ''

  // Scores and peer ratings are not in the class loader's tables. Listen for
  // them here so a score confirmed in another tab reaches the sheet; realtime
  // and focus only, no extra poll. The check-in and the log read tasks, events,
  // decisions and notes, which the class loader does not watch.
  useLive(
    retry,
    [
      'member_scores', 'board_scores', 'score_releases', 'project_criteria', 'peer_ratings', 'peer_rounds',
      'class_notes', 'task_events', 'project_tasks', 'board_results',
    ],
    { every: 0, enabled: (kind === 'grading' || kind === 'peer' || kind === 'checkin' || kind === 'notes') && ready },
  )

  // Live updates hand back fresh arrays with the same rows in them. The build
  // keys on what is in them, so a refresh that changed nothing it reads does
  // not fetch and redraw the sheet.
  const onePerProject = kind === 'grading' && !studentId && projectId !== '' && projectId !== 'all'
  const projectsSig = useMemo(() => projects.map((p) => `${p.id}:${p.title}:${p.total_points}`).join('|'), [projects])
  const studentsSig = useMemo(() => students.map((s) => s.value).join('|'), [students])
  const boardsSig = useMemo(
    () => (onePerProject ? boards.map((b) => `${b.id}:${b.group_name ?? b.student_name ?? ''}`).join('|') : ''),
    [onePerProject, boards],
  )
  const workSig = useMemo(
    () =>
      onePerProject
        ? work
            .filter((w) => w.project_id === projectId)
            .map((w) => `${w.board_id}:${w.student_id}:${w.held_pct}:${w.tasks_held}:${w.tasks_done}:${w.tasks_late}`)
            .join('|')
        : '',
    [onePerProject, work, projectId],
  )

  // The check-in reads hand-ins and due dates off the class loader's arrays, so a
  // hand-in or a moved deadline arriving there has to rebuild it.
  const checkInSig = useMemo(
    () =>
      kind === 'checkin'
        ? [
            ...allBoards.map((b) => `${b.id}:${b.group_name ?? b.student_name ?? ''}:${b.project_title}:${b.submitted_at ?? ''}`),
            ...projects.map((p) => `${p.id}:${p.due_at ?? ''}`),
          ].join('|')
        : '',
    [kind, allBoards, projects],
  )

  // The arrays themselves, read when a build starts. Kept beside the effect
  // rather than in its dependencies, which are the signatures above.
  const data = useRef({ projects, boards, allBoards, work, students })
  useEffect(() => {
    data.current = { projects, boards, allBoards, work, students }
  })

  useEffect(() => {
    let live = true
    const key = currentKey
    if ((kind !== 'grading' && kind !== 'peer' && kind !== 'checkin' && kind !== 'notes') || !ready || !classLine) {
      setBuilt({ doc: null, key, error: null, refreshError: null })
      setLoading(false)
      return
    }
    const { projects, boards, allBoards, work, students } = data.current
    const head = { classLine, professor, madeAt: generatedOn() }
    // A custom range typed backwards is put in order, and a half-filled one reads as the last 7 days.
    const today = manilaDay(new Date())
    const range = resolveRange(rangeChoice, today, { from: customFrom, to: customTo })
    const asProject = (p: { id: string; title: string; total_points: number }) => ({
      id: p.id,
      title: p.title,
      total_points: p.total_points,
    })
    setLoading(true)
    setBuilt((prev) => (prev.error || prev.refreshError ? { ...prev, error: null, refreshError: null } : prev))
    void (async () => {
      try {
        let next: ReportDoc | null = null
        if (kind === 'grading' && studentId) {
          const student = students.find((s) => s.value === studentId)
          const parts = await Promise.all(
            projects.map(async (p) => {
              const [sheet, criteria, peer] = await Promise.all([
                scoreSheet(p.id),
                listCriteria(p.id),
                projectPeerResults(p.id),
              ])
              const row = sheet.find((x) => x.student_id === studentId) ?? null
              const boardScores = row ? await projectBoardScores([row.board_id]) : []
              return { project: asProject(p), row, criteria, boardScores, peer: finalRows(peer) }
            }),
          )
          next = gradingStudentDoc({
            ...head,
            student: { id: studentId, name: student?.label ?? 'Student' },
            projects: parts,
          })
        } else if (kind === 'grading' && projectId === 'all') {
          const sheets = await Promise.all(
            projects.map(async (p) => ({ project: asProject(p), sheet: await scoreSheet(p.id) })),
          )
          next = gradingGridDoc({
            ...head,
            students: students.map((s) => ({ id: s.value, name: s.label })),
            projects: sheets,
          })
        } else if (kind === 'grading') {
          const p = projects.find((x) => x.id === projectId)
          if (p) {
            const [sheet, criteria, peer] = await Promise.all([
              scoreSheet(p.id),
              listCriteria(p.id),
              projectPeerResults(p.id),
            ])
            const boardScores = await projectBoardScores([...new Set(sheet.map((x) => x.board_id))])
            next = gradingClassDoc({
              ...head,
              project: asProject(p),
              sheet,
              criteria,
              boardScores,
              boardNames: new Map(boards.map((b) => [b.id, b.group_name ?? b.student_name ?? 'A board'])),
              work: work.filter((w) => w.project_id === p.id),
              peer: finalRows(peer),
            })
          }
        } else if (kind === 'peer') {
          const p = projects.find((x) => x.id === projectId)
          if (p) {
            const rs = await listPeerRounds(p.id)
            if (live) setRoundsOf({ projectId: p.id, list: rs })
            const round = rs.find((x) => x.id === roundId) ?? defaultRound(rs)
            if (round) {
              // Written comments are fetched for the chosen round only, and only when asked for.
              const [all, cs] = await Promise.all([
                projectPeerResults(p.id),
                comments ? peerComments(round.id) : Promise.resolve(null),
              ])
              next = peerSummaryDoc({
                ...head,
                projectTitle: p.title,
                round,
                results: all.filter((x) => x.round_id === round.id),
                comments: cs,
              })
            }
          }
        } else if (kind === 'checkin') {
          // An ended class has nothing in the Phase A views, so the document says so without fetching them.
          const load = <T,>(f: () => Promise<T[]>) => (ended ? Promise.resolve([] as T[]) : f())
          const [activity, tasks, roster, milestones, actionRows, burns, results, notes] = await Promise.all([
            load(dailyActivity), load(taskStates), load(studentRoster), load(milestoneProgress), load(classActions), load(boardBurn),
            load(() => boardResultsFor(allBoards.map((b) => b.id))), load(listClassNotes),
          ])
          const inClass = <T extends { class_id: string }>(xs: T[]) => xs.filter((x) => x.class_id === classId)
          const names = new Map(inClass(roster).map((x) => [x.student_id, x.student_name]))
          const boardName = new Map(allBoards.map((b) => [b.id, b.group_name ?? b.student_name ?? 'A board']))
          next = checkInDoc({
            ...head,
            range,
            termStart,
            ended,
            activity: inClass(activity),
            tasks: inClass(tasks),
            roster: inClass(roster),
            milestones: inClass(milestones),
            boards: allBoards.map((b) => ({
              board_id: b.id,
              name: boardName.get(b.id)!,
              project_title: b.project_title,
              submitted_at: b.submitted_at,
            })),
            results,
            projects: projects.map((p) => ({ id: p.id, title: p.title, due_at: p.due_at })),
            actions: rankActions(inClass(actionRows), inClass(burns)),
            notes: inClass(notes),
            noteName: (n) => (n.student_id ? (names.get(n.student_id) ?? 'a student') : (boardName.get(n.board_id ?? '') ?? 'a group')),
          })
        } else if (kind === 'notes') {
          const rows = await listClassNoteLog(classId)
          next = interventionLogDoc({
            ...head,
            range,
            asOf: today,
            notes: rows,
            filters: {
              kinds: noteKindsKey ? (noteKindsKey.split(',') as ClassNoteKind[]) : [],
              status: noteStatus,
              studentId,
              boardId,
            },
          })
        }
        if (live) setBuilt({ doc: next, key, error: null, refreshError: null })
      } catch (err) {
        if (live) {
          const message = authErrorMessage(err, 'Could not build that report. Try again.')
          // A failed refresh keeps the sheet already on screen for these choices.
          setBuilt((prev) =>
            prev.key === key && prev.doc
              ? { ...prev, refreshError: message }
              : { doc: null, key, error: message, refreshError: null },
          )
        }
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [
    currentKey,
    kind,
    classLine,
    projectId,
    studentId,
    boardId,
    roundId,
    comments,
    rangeChoice,
    customFrom,
    customTo,
    noteKindsKey,
    noteStatus,
    termStart,
    ended,
    classId,
    ready,
    professor,
    nonce,
    projectsSig,
    studentsSig,
    boardsSig,
    workSig,
    checkInSig,
  ])

  const current = built.key === currentKey
  return {
    doc: built.doc,
    current,
    loading,
    error: current ? built.error : null,
    refreshError: current ? built.refreshError : null,
    retry,
    rounds: roundsOf.projectId === projectId ? roundsOf.list : [],
  }
}
