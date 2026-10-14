import { useMemo, useState } from 'react'
import { Roster } from '../../../../components/analytics/Roster'
import { entryKey } from '../../../../components/analytics/flags'
import type { RosterEntry } from '../../../../components/analytics/flags'
import { StudentDrawer } from '../../../../components/analytics/StudentDrawer'
import { idleDays, lastWeeks, manilaDay, studentFlags } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { termsOf } from '../window'
import { Section } from './Section'

export function StudentsView({
  data,
  onOpenTask,
  openRequest,
}: {
  data: AnalyticsData
  onOpenTask: (id: string) => void
  /** Bumped each time a follow-up asks for the scoped student's record, even one just closed. */
  openRequest: number
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [seenRequest, setSeenRequest] = useState(openRequest)
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest)
    setClosedFor(null)
    setPicked(null)
  }
  const [seenScope, setSeenScope] = useState(data.scope.studentId)
  // A new scope starts fresh, so picking a student again reopens their drawer.
  if (seenScope !== data.scope.studentId) {
    setSeenScope(data.scope.studentId)
    setClosedFor(null)
  }

  const { shownPace, shownUnmeasured } = data
  const entries = useMemo<RosterEntry[]>(() => {
    const now = new Date()
    const today = manilaDay(now)
    const weeks = lastWeeks(today, 8)
    const inGroup = new Map(data.people.map((p) => [`${p.class_id}:${p.student_id}`, p.in_any_group]))
    const boardTasks = new Map(data.burns.map((b) => [b.board_id, b.task_count]))
    const termStarted = new Map(
      [...termsOf({ shownPace, shownUnmeasured })].map(([id, t]) => [id, t.start <= today]),
    )
    return data.shownRoster.map((r) => {
      const shares = data.shownMembers
        .filter(
          (m) =>
            m.student_id === r.student_id &&
            m.class_id === r.class_id &&
            m.group_size >= 2 &&
            (boardTasks.get(m.board_id) ?? 0) > 0,
        )
        .map((m) => Number(m.held_pct))
      const lowestShare = shares.length ? Math.min(...shares) : null
      const mine = data.shownActivity.filter((a) => a.actor_id === r.student_id && a.class_id === r.class_id)
      const trend = weeks.map((w, i) => {
        const end = weeks[i + 1] ?? '9999-12-31'
        return mine.filter((a) => a.day >= w && a.day < end).reduce((s, a) => s + a.n, 0)
      })
      const flags = studentFlags(
        {
          held: r.held,
          done: r.done,
          late: r.late,
          lowestShare,
          inAnyGroup: inGroup.get(`${r.class_id}:${r.student_id}`) ?? true,
          lastActiveAt: r.last_active_at,
          // No term at all means not started: no "inactive" flag before one is set.
          termStarted: termStarted.get(r.class_id) ?? false,
        },
        now,
      )
      return { ...r, flags, lowestShare, trend, idle: idleDays(r.last_active_at, now), groups: r.group_names }
    })
  }, [data.shownRoster, data.shownMembers, data.shownActivity, data.people, shownPace, shownUnmeasured, data.burns])

  // Narrowing to a student in the scope bar opens their drawer, once.
  const { studentId, classId } = data.scope
  const scopedEntry =
    studentId && closedFor !== studentId
      ? entries.find((e) => e.student_id === studentId && (!classId || e.class_id === classId))
      : undefined
  const openId = picked ?? (scopedEntry ? entryKey(scopedEntry) : null)
  const open = entries.find((e) => entryKey(e) === openId) ?? null
  const flagged = entries.filter((e) => e.flags.length > 0).length

  return (
    <div className="space-y-5">
      <Section
        id="attn-students"
        title="Students"
        subtitle={`${flagged} of ${entries.length} flagged. Flags are prompts for a conversation. Notes record that conversation and only teaching staff can read them. Select a name for their full record.`}
      >
        <Roster entries={entries} onOpen={setPicked} />
      </Section>
      <StudentDrawer
        entry={open}
        data={data}
        onClose={() => {
          setPicked(null)
          setClosedFor(data.scope.studentId || null)
        }}
        onOpenTask={(id) => {
          setPicked(null)
          setClosedFor(data.scope.studentId || null)
          onOpenTask(id)
        }}
      />
    </div>
  )
}
