import { useMemo, useState } from 'react'
import { Roster } from '../../../../components/analytics/Roster'
import { entryKey } from '../../../../components/analytics/flags'
import type { RosterEntry } from '../../../../components/analytics/flags'
import { StudentDrawer } from '../../../../components/analytics/StudentDrawer'
import { idleDays, lastWeeks, manilaDay, studentFlags } from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { Section } from './Section'

export function StudentsView({ data, onOpenTask }: { data: AnalyticsData; onOpenTask: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [seenScope, setSeenScope] = useState(data.scope.studentId)
  // A new scope starts fresh, so picking a student again reopens their drawer.
  if (seenScope !== data.scope.studentId) {
    setSeenScope(data.scope.studentId)
    setClosedFor(null)
  }

  const entries = useMemo<RosterEntry[]>(() => {
    const now = new Date()
    const today = manilaDay(now)
    const weeks = lastWeeks(today, 8)
    const inGroup = new Map(data.people.map((p) => [`${p.class_id}:${p.student_id}`, p.in_any_group]))
    const boardTasks = new Map(data.burns.map((b) => [b.board_id, b.task_count]))
    const termStarted = new Map(data.pace.map((p) => [p.class_id, p.term_start <= today]))
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
          termStarted: termStarted.get(r.class_id) ?? true,
        },
        now,
      )
      const groups = [
        ...new Set(
          data.members
            .filter((m) => m.student_id === r.student_id && m.class_id === r.class_id && m.group_name)
            .map((m) => m.group_name as string),
        ),
      ]
      return { ...r, flags, lowestShare, trend, idle: idleDays(r.last_active_at, now), groups }
    })
  }, [data.shownRoster, data.shownMembers, data.shownActivity, data.people, data.pace, data.burns, data.members])

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
        title="Students"
        subtitle={`${flagged} of ${entries.length} flagged. Flags are prompts for a conversation, never grades. Select a name for their full record.`}
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
