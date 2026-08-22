import { useEffect, useMemo, useState } from 'react'
import { BoardSheet } from '../../../components/reports/BoardSheet'
import { ContributionSheet } from '../../../components/reports/ContributionSheet'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Field'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import { boardsFor } from '../../../lib/api/dashboard'
import { listReassignments } from '../../../lib/api/reassignments'
import { boardResult } from '../../../lib/api/results'
import { myBoardMembers, myBoardTasks, myWork } from '../../../lib/api/studentReports'
import type { MyBoardMember, MyBoardTask, MyWork } from '../../../lib/api/studentReports'
import { authErrorMessage } from '../../../lib/authError'
import { fullName } from '../../../lib/types'
import type { BoardSummary, ReassignmentRow } from '../../../lib/types'

type Kind = 'mine' | 'group'

/**
 * A student's own copy of the record.
 *
 * Two sheets, and the line between them is who they are about. **My work** is
 * one student in one class — what they held, what they finished, when they
 * worked. **My group's project** is one board: how the work was split, every
 * task with who held it, and the professor's answer with the reason in full.
 *
 * They print on the same letterhead as the professor's, from the same
 * components, and carry the same footer: no grade is recorded here. What is
 * different is the line under the signature. A professor's sheet is attested; a
 * student's is prepared, and the professor's copy is the one that counts.
 *
 * Nothing on this page can reach another group. The three views behind it are
 * scoped in the database to the person asking.
 */
export default function StudentReports() {
  const { profile } = useAuth()
  const [kind, setKind] = useState<Kind>('mine')
  const [rows, setRows] = useState<MyWork[] | null>(null)
  const [classId, setClassId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [tasks, setTasks] = useState<MyBoardTask[]>([])
  const [members, setMembers] = useState<MyBoardMember[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [requests, setRequests] = useState<ReassignmentRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [work, reqs] = await Promise.all([myWork(), listReassignments()])
        setRows(work)
        setRequests(reqs)
        setClassId((id) => id || (work[0]?.class_id ?? ''))
        setBoards(await boardsFor([...new Set(work.map((w) => w.project_id))]))
        setError(null)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load your work.'))
        setRows([])
      }
    })()
  }, [])

  useEffect(() => {
    if (!boardId) {
      setTasks([])
      setMembers([])
      setFeedback(null)
      return
    }
    void (async () => {
      try {
        const [t, m, r] = await Promise.all([
          myBoardTasks(boardId),
          myBoardMembers(boardId),
          boardResult(boardId),
        ])
        setTasks(t)
        setMembers(m)
        setFeedback(r?.feedback ?? null)
        setError(null)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load that board.'))
      }
    })()
  }, [boardId])

  const classes = useMemo(() => {
    const seen = new Map<string, string>()
    for (const w of rows ?? []) seen.set(w.class_id, `${w.class_initial} · ${w.class_name}`)
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [rows])

  const mine = useMemo(
    () => (rows ?? []).filter((w) => w.class_id === classId),
    [rows, classId],
  )

  // Group boards only: a solo board has no split to report and no groupmates.
  const groupBoards = useMemo(
    () => (rows ?? []).filter((w) => w.group_name),
    [rows],
  )

  const cls = mine[0] ?? (rows ?? []).find((w) => w.board_id === boardId) ?? null
  const board = boards.find((b) => b.id === boardId) ?? null
  const ready = kind === 'mine' ? Boolean(cls) : Boolean(board && cls)

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Gathering your work…
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <header className="print:hidden">
        <p className="eyebrow">Workspace</p>
        <h1 className="mt-1 text-[30px] leading-tight">Reports</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          Your own copy of what you did. Print it from here — your browser's print dialog
          saves it as a PDF — and keep it, or attach it to a defense record. It records
          effort, never a grade.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {rows.length === 0 ? (
        <EmptyState
          icon="file"
          title="Nothing to report yet"
          body="Once you hold a task on a project board, your record shows up here."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            <div className="flex rounded-xl surface-sunken p-1">
              {(
                [
                  ['mine', 'My work'],
                  ['group', "My group's project"],
                ] as [Kind, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-lg px-3.5 py-1.5 text-[13px] transition-colors ${
                    kind === k ? 'surface font-medium text-ink shadow-card' : 'text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <FilterPopover
              active={kind === 'mine' ? (classId ? 1 : 0) : boardId ? 1 : 0}
              summary={
                kind === 'mine'
                  ? classes.find((c) => c.value === classId)?.label
                  : groupBoards.find((b) => b.board_id === boardId)?.project_title
              }
              onClear={() => (kind === 'mine' ? setClassId('') : setBoardId(''))}
              label="Choose what to print"
            >
              {kind === 'mine' ? (
                <FilterField label="Class">
                  <Select
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                    placeholder="Pick a class"
                    options={classes}
                    className="!h-10 !text-[13.5px]"
                  />
                </FilterField>
              ) : (
                <FilterField label="Group project">
                  <Select
                    value={boardId}
                    onChange={(e) => setBoardId(e.target.value)}
                    placeholder="Pick a project"
                    options={groupBoards.map((b) => ({
                      value: b.board_id,
                      label: `${b.project_title} · ${b.group_name}`,
                    }))}
                    className="!h-10 !text-[13.5px]"
                  />
                </FilterField>
              )}
            </FilterPopover>

            <Button
              size="sm"
              className="!rounded-xl"
              disabled={!ready}
              onClick={() => window.print()}
            >
              <Icon name="file" size={14} />
              Print
            </Button>
          </div>

          {kind === 'group' && groupBoards.length === 0 ? (
            <EmptyState
              icon="users"
              title="No group work yet"
              body="This report covers a project your group shares. Everything you have so far is your own board."
            />
          ) : !ready ? (
            <EmptyState
              icon="file"
              title="Choose what to print"
              body={
                kind === 'mine'
                  ? 'Pick the class your report should cover.'
                  : 'Pick the group project your report should cover.'
              }
            />
          ) : kind === 'mine' && cls && profile ? (
            <ContributionSheet
              cls={cls}
              rows={mine.map((w) => ({
                ...w,
                student_id: profile.id,
                student_name: fullName(profile),
                avatar_url: profile.avatar_url,
              }))}
              reassignments={requests.filter((r) => r.class_id === cls.class_id)}
              professor={fullName(profile)}
              signatureLabel="Prepared by"
            />
          ) : board && cls ? (
            <BoardSheet
              cls={cls}
              board={board}
              tasks={tasks}
              members={members}
              feedback={feedback}
              professor={fullName(profile!)}
              signatureLabel="Prepared by"
            />
          ) : null}
        </>
      )}
    </div>
  )
}
