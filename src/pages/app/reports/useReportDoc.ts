import { useCallback, useEffect, useState } from 'react'
import { listPeerRounds, peerComments, projectPeerResults } from '../../../lib/api/peer'
import { listCriteria } from '../../../lib/api/projects'
import { projectBoardScores, scoreSheet } from '../../../lib/api/scores'
import { authErrorMessage } from '../../../lib/authError'
import { generatedOn } from '../../../lib/report'
import type { ReportDoc } from '../../../lib/reports/doc'
import { gradingClassDoc, gradingGridDoc, gradingStudentDoc } from '../../../lib/reports/grading'
import { defaultRound, peerSummaryDoc } from '../../../lib/reports/peerSummary'
import type { PeerResult, PeerRoundStatus } from '../../../lib/types'
import type { useReports } from './useReports'

type R = ReturnType<typeof useReports>

const finalRows = (rows: PeerResult[]) => rows.filter((p) => p.kind === 'final' && !p.is_open)

/** Loads the data a new-style report needs and builds its document. Old sheets return null. */
export function useReportDoc(r: R, professor: string) {
  const [doc, setDoc] = useState<ReportDoc | null>(null)
  const [rounds, setRounds] = useState<PeerRoundStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  const { kind, cls, projectId, studentId, roundId, comments, projects, boards, work, students, ready } = r

  useEffect(() => {
    let live = true
    if ((kind !== 'grading' && kind !== 'peer') || !ready || !cls) {
      setDoc(null)
      setLoading(false)
      setError(null)
      return
    }
    const head = {
      classLine: `${cls.class_initial} · ${cls.class_name} · ${cls.section}`,
      professor,
      madeAt: generatedOn(),
    }
    const asProject = (p: { id: string; title: string; total_points: number }) => ({
      id: p.id,
      title: p.title,
      total_points: p.total_points,
    })
    setLoading(true)
    setError(null)
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
            if (live) setRounds(rs)
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
        }
        if (live) setDoc(next)
      } catch (err) {
        if (live) {
          setDoc(null)
          setError(authErrorMessage(err, 'Could not build that report. Try again.'))
        }
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [kind, cls, projectId, studentId, roundId, comments, projects, boards, work, students, ready, professor, nonce])

  return { doc, loading, error, retry, rounds }
}
