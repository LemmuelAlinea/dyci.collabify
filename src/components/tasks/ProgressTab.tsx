import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Icon'
import { BoardProgress } from './BoardProgress'
import { MemberProgress } from './MemberProgress'
import type { ProjectTasks } from './useProjectTasks'

/** Where a student's board stands, and who has done what on it. */
export function ProgressTab({ t, viewerId }: { t: ProjectTasks; viewerId: string | undefined }) {
  const { active } = t
  if (t.boards === null || t.boardLoading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading progress…
      </div>
    )
  }
  if (!active) {
    return (
      <EmptyState
        icon="chart"
        title="No progress to show"
        body="You are not in a group for this project yet."
      />
    )
  }
  return (
    <div className="space-y-4">
      <BoardProgress board={active} />
      <MemberProgress
        rows={t.progress}
        viewerId={viewerId}
        title={active.group_id ? 'Your group' : 'Your progress'}
      />
    </div>
  )
}
