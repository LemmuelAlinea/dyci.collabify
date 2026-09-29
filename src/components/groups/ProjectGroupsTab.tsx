import { useMemo } from 'react'
import { Alert } from '../ui/Alert'
import { Button, ButtonLink } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { GroupsBoard } from './GroupsBoard'
import { useGroupsData } from '../../hooks/useGroupsData'
import { setClosed } from '../../lib/api/groups'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { ClassSummary, ProjectSummary } from '../../lib/types'

/**
 * A group project's Groups tab: the same board as the Groups page and a class's
 * Groups tab, narrowed to this project's own group set, so only the groups and
 * students this project is worked by appear.
 *
 * Making or deleting a whole set stays on the Groups page: other projects may
 * use the same set, and deleting it from inside one project would reach them
 * too. Everything about the groups themselves (who is in which, names, locking)
 * is one click away on each group's own page, exactly as from the Groups page.
 */
export function ProjectGroupsTab({
  project,
  cls,
  viewerId,
}: {
  project: ProjectSummary
  /** The project's class, when the professor's class list has it. */
  cls: ClassSummary | null
  viewerId?: string
}) {
  const { show } = useToast()
  // Keyed on the id, not the class object: the page refetches on every live
  // refresh, and a new object here would reload the groups each time.
  const classId = project.class_id
  const ids = useMemo(() => [{ id: classId }], [classId])
  const { sets, groups, members, loading, error, reload } = useGroupsData(ids)

  const setId = project.group_set_id
  const mySets = useMemo(() => sets.filter((s) => s.id === setId), [sets, setId])
  const myGroups = useMemo(() => groups.filter((g) => g.set_id === setId), [groups, setId])
  const myMembers = useMemo(() => {
    const inSet = new Set(myGroups.map((g) => g.id))
    return members.filter((m) => inSet.has(m.group_id))
  }, [members, myGroups])
  const classes = useMemo(() => (cls ? [cls] : []), [cls])

  const canManage = !cls?.archived_at && !project.archived_at

  if (!setId) {
    return (
      <Alert tone="info">
        This project is not linked to a set of groups, so there are no groups to show here.
      </Alert>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading groups…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error" onRetry={reload}>{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {mySets[0] ? (
            <>
              Groups from <span className="font-medium text-ink">{mySets[0].name}</span>, the set this
              project is worked in. Open a group to move students, rename it or lock it.
            </>
          ) : (
            'The set of groups this project was made with is no longer there.'
          )}
        </p>
        <ButtonLink to={paths.groups} variant="ghost" size="sm" className="shrink-0 !rounded-lg">
          <Icon name="users" size={15} />
          All groups
        </ButtonLink>
      </div>

      <GroupsBoard
        classes={classes}
        sets={mySets}
        groups={myGroups}
        members={myMembers}
        linkBase={paths.groups}
        viewerId={viewerId}
        showFilters={myGroups.length > 6}
        showSetFilter={false}
        emptyTitle="No groups in this set yet"
        emptyBody="Make and fill groups on the Groups page. Once this set has groups, they show up here."
        setActions={
          canManage
            ? (set) => (
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={async () => {
                    try {
                      await setClosed(set.id, !set.closed_at)
                      show(set.closed_at ? `${set.name} reopened` : `${set.name} is now final`)
                      await reload()
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not change that.'), 'error')
                    }
                  }}
                >
                  <Icon name={set.closed_at ? 'refresh' : 'lock'} size={15} />
                  {set.closed_at ? 'Reopen' : 'Close set'}
                </Button>
              )
            : undefined
        }
      />
    </div>
  )
}
