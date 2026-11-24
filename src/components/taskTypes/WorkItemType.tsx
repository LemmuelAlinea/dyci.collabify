import { resolveType } from '../../lib/taskTypes/typeSet'
import type { TaskTypeEntry } from '../../lib/taskTypes/typeSet'
import { TypeChip } from './TypeChip'

/** A work item's type chip in Backlog and Sprints. A source with no type set (a class board) shows none. */
export function WorkItemType({ set, item }: { set?: TaskTypeEntry[]; item: { kind?: 'task' | 'bug'; task_type?: string | null } }) {
  if (!set) return null
  return <TypeChip entry={resolveType(set, item, 'work')} />
}
