import { useCallback, useEffect, useMemo, useState } from 'react'
import { GapList } from '../../../components/analytics/GapList'
import { MemberLoad } from '../../../components/analytics/MemberLoad'
import { PaceCard } from '../../../components/analytics/PaceCard'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { classGaps, classHealth, classPace, memberLoad } from '../../../lib/api/analytics'
import { authErrorMessage } from '../../../lib/authError'
import type {
  ClassGap,
  ClassHealth,
  ClassPace,
  MemberLoad as Load,
} from '../../../lib/types'

function Tile({ value, label, tone }: { value: number | string; label: string; tone?: 'warn' }) {
  return (
    <div className="surface rounded-card border border-line px-4 py-3 shadow-card">
      <p
        className={`font-mono text-[19px] ${
          tone === 'warn' && value !== 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="text-[12px] text-muted">{label}</p>
    </div>
  )
}

/**
 * What is actually happening across a professor's classes.
 *
 * Everything here is counted, not guessed. The one forward-looking number — will
 * this syllabus finish — is division, and the division is printed beside it. A
 * trained model over one class and four graded results would be a confident
 * number with nothing behind it.
 */
export default function Analytics() {
  const [pace, setPace] = useState<ClassPace[] | null>(null)
  const [gaps, setGaps] = useState<ClassGap[]>([])
  const [health, setHealth] = useState<ClassHealth[]>([])
  const [load, setLoad] = useState<Load[]>([])
  const [error, setError] = useState<string | null>(null)
  const [classId, setClassId] = useState('')

  const load_ = useCallback(async () => {
    try {
      const [p, g, h, m] = await Promise.all([
        classPace(),
        classGaps(),
        classHealth(),
        memberLoad(),
      ])
      setPace(p)
      setGaps(g)
      setHealth(h)
      setLoad(m)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the analytics.'))
      setPace([])
    }
  }, [])

  useEffect(() => {
    void load_()
  }, [load_])

  // Everything narrows together, so the page always describes one subject.
  const shownPace = useMemo(
    () => (classId ? (pace ?? []).filter((p) => p.class_id === classId) : (pace ?? [])),
    [pace, classId],
  )
  const shownGaps = useMemo(
    () => (classId ? gaps.filter((g) => g.class_id === classId) : gaps),
    [gaps, classId],
  )
  const shownLoad = useMemo(
    () => (classId ? load.filter((l) => l.class_id === classId) : load),
    [load, classId],
  )
  const shownHealth = useMemo(
    () => (classId ? health.filter((h) => h.class_id === classId) : health),
    [health, classId],
  )

  const totals = useMemo(
    () =>
      shownHealth.reduce(
        (acc, h) => ({
          boards: acc.boards + h.boards,
          empty: acc.empty + h.boards_empty,
          submitted: acc.submitted + h.boards_submitted,
          accepted: acc.accepted + h.boards_accepted,
          returned: acc.returned + h.boards_returned,
          late: acc.late + h.late_tasks,
          unclaimed: acc.unclaimed + h.tasks_unclaimed,
          tasks: acc.tasks + h.tasks,
          done: acc.done + h.tasks_done,
        }),
        {
          boards: 0, empty: 0, submitted: 0, accepted: 0,
          returned: 0, late: 0, unclaimed: 0, tasks: 0, done: 0,
        },
      ),
    [shownHealth],
  )

  if (pace === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Working it out…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Teaching</p>
        <h1 className="mt-1 text-[30px] leading-tight">Analytics</h1>
        <p className="mt-2 max-w-[66ch] text-[14.5px] text-muted">
          Where each class stands against the syllabus it was built on, and who is carrying
          the work. Every figure is counted from what has happened — the one projection is
          arithmetic, and it shows its working.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {pace.length > 1 && (
        <Select
          aria-label="Filter by class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          placeholder="Every class"
          options={pace.map((p) => ({
            value: p.class_id,
            label: `${p.class_initial} · ${p.class_name}`,
          }))}
          className="!h-9 !w-[260px] !text-[13px]"
        />
      )}

      {pace.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          body="A class needs its term dates and a syllabus before its pace means anything."
        />
      ) : (
        <>
          <section className="space-y-3">
            {shownPace.map((p) => (
              <PaceCard key={p.class_id} pace={p} />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px]">Where the work stands</h2>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Tile value={`${totals.done}/${totals.tasks}`} label="tasks done" />
              <Tile value={totals.boards} label="boards" />
              <Tile value={totals.submitted} label="handed in" />
              <Tile value={totals.accepted} label="accepted" />
              <Tile value={totals.returned} label="returned" />
              <Tile value={totals.late} label="handed in late" tone="warn" />
            </div>
            {(totals.empty > 0 || totals.unclaimed > 0) && (
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-amber-500" />
                {totals.empty > 0 && `${totals.empty} board${totals.empty === 1 ? '' : 's'} with no tasks on ${totals.empty === 1 ? 'it' : 'them'}`}
                {totals.empty > 0 && totals.unclaimed > 0 && ' · '}
                {totals.unclaimed > 0 && `${totals.unclaimed} task${totals.unclaimed === 1 ? '' : 's'} nobody has claimed`}
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px]">Weeks with nothing set</h2>
            <GapList gaps={shownGaps} />
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px]">Who is carrying the work</h2>
            <p className="max-w-[66ch] text-[13.5px] text-muted">
              Effort, not marks. A group at eighty per cent looks the same whether everyone
              did a share or one person did all of it.
            </p>
            <MemberLoad rows={shownLoad} />
          </section>
        </>
      )}
    </div>
  )
}
