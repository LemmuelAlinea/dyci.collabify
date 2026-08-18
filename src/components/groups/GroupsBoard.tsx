import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { GroupCard } from './GroupCard'
import { EMPTY_FILTERS, GroupFilters } from './GroupFilters'
import type { GroupFilterState } from './GroupFilters'
import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { fullName, modeLabel } from '../../lib/types'
import type { ClassSummary, GroupMember, GroupSet, GroupSummary } from '../../lib/types'
import { membersOf } from '../../hooks/useGroupsData'
import { groupWorkByGroup, listGroupBoards } from '../../lib/api/groupWork'
import type { GroupWorkSummary } from '../../lib/api/groupWork'

type Props = {
  classes: ClassSummary[]
  sets: GroupSet[]
  groups: GroupSummary[]
  members: GroupMember[]
  /** Where a card links to. */
  linkBase: string
  /** Marks the viewer's own group on the card. */
  viewerId?: string
  emptyTitle: string
  emptyBody: string
  emptyAction?: ReactNode
  /** Rendered beside each set heading — close/reopen controls for professors. */
  setActions?: (set: GroupSet) => ReactNode
  /** Hide the filter row when there is nothing to filter. */
  showFilters?: boolean
  /** Students never browse by set — they only see their own groups. */
  showSetFilter?: boolean
}

export function GroupsBoard({
  classes,
  sets,
  groups,
  members,
  linkBase,
  viewerId,
  emptyTitle,
  emptyBody,
  emptyAction,
  setActions,
  showFilters = true,
  showSetFilter = true,
}: Props) {
  const [filters, setFilters] = useState<GroupFilterState>(EMPTY_FILTERS)
  const [work, setWork] = useState(new Map<string, GroupWorkSummary>())

  // One query for the page: a card should not have to ask what its group holds.
  const groupIds = groups.map((g) => g.id).join(',')
  useEffect(() => {
    if (!groupIds) return setWork(new Map())
    void listGroupBoards(groupIds.split(','))
      .then((boards) => setWork(groupWorkByGroup(boards)))
      .catch(() => setWork(new Map()))
  }, [groupIds])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const setById = useMemo(() => new Map(sets.map((s) => [s.id, s])), [sets])

  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return groups.filter((g) => {
      if (filters.classId && g.class_id !== filters.classId) return false
      if (filters.setId && g.set_id !== filters.setId) return false
      if (!q) return true
      if (g.name.toLowerCase().includes(q)) return true
      // Searching a person's name should surface the group they are in.
      return membersOf(members, g.id).some((m) =>
        fullName(m.profile).toLowerCase().includes(q),
      )
    })
  }, [groups, members, filters])

  const bySet = useMemo(() => {
    const map = new Map<string, GroupSummary[]>()
    for (const g of visible) {
      const list = map.get(g.set_id) ?? []
      list.push(g)
      map.set(g.set_id, list)
    }
    return map
  }, [visible])

  const orderedSetIds = sets.map((s) => s.id).filter((id) => bySet.has(id))

  return (
    <div className="space-y-6">
      {showFilters && groups.length > 0 && (
        <GroupFilters
          value={filters}
          onChange={setFilters}
          classes={classes}
          sets={sets}
          showSetFilter={showSetFilter}
        />
      )}

      {groups.length === 0 ? (
        <EmptyState icon="users" title={emptyTitle} body={emptyBody} action={emptyAction} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search"
          title="Nothing matches"
          body="No group or member matches that search. Clear the filters and try again."
        />
      ) : (
        orderedSetIds.map((setId) => {
          const set = setById.get(setId)!
          const cls = classById.get(set.class_id)
          return (
            <section key={setId}>
              <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px]">{set.name}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                    <span>{cls ? `${cls.initial} · ${cls.name}` : 'Class'}</span>
                    <span>·</span>
                    <span>{modeLabel(set.mode)}</span>
                    {set.closed_at && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-300">
                          <Icon name="lock" size={12} />
                          Final
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {setActions?.(set)}
              </header>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(bySet.get(setId) ?? []).map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    members={membersOf(members, g.id)}
                    className={cls?.initial ?? ''}
                    to={`${linkBase}/${g.id}`}
                    highlight={
                      Boolean(viewerId) &&
                      membersOf(members, g.id).some((m) => m.student_id === viewerId)
                    }
                    work={work.get(g.id)}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
