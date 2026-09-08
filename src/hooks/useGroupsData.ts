import { useCallback, useEffect, useState } from 'react'
import { useLive } from './useLive'
import { listGroupMembers, listGroups, listSetsForClasses } from '../lib/api/groups'
import { authErrorMessage } from '../lib/authError'
import type { ClassSummary, GroupMember, GroupSet, GroupSummary } from '../lib/types'

/**
 * Sets, groups, and rosters for a list of classes, loaded together so the board
 * can render cards with faces in one pass rather than a query per card.
 *
 * `archived` picks which shelf. Live groups by default; the archived ones are
 * the same query with the filter flipped, so the two views cannot drift into
 * showing different shapes of the same card.
 */
export function useGroupsData(classes: ClassSummary[] | null, archived = false) {
  const [sets, setSets] = useState<GroupSet[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!classes) return
    setLoading(true)
    try {
      const classIds = classes.map((c) => c.id)
      const loadedSets = await listSetsForClasses(classIds)
      const loadedGroups = await listGroups(loadedSets.map((s) => s.id), { archived })
      const loadedMembers = await listGroupMembers(loadedGroups.map((g) => g.id))
      setSets(loadedSets)
      setGroups(loadedGroups)
      setMembers(loadedMembers)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load groups.'))
    } finally {
      setLoading(false)
    }
  }, [classes, archived])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['group_sets', 'groups', 'group_members', 'class_members'])

  return { sets, groups, members, loading, error, reload: load }
}

export function membersOf(members: GroupMember[], groupId: string) {
  return members.filter((m) => m.group_id === groupId)
}
