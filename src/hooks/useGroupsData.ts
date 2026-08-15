import { useCallback, useEffect, useState } from 'react'
import { listGroupMembers, listGroups, listSetsForClasses } from '../lib/api/groups'
import { authErrorMessage } from '../lib/authError'
import type { ClassSummary, GroupMember, GroupSet, GroupSummary } from '../lib/types'

/**
 * Sets, groups, and rosters for a list of classes, loaded together so the board
 * can render cards with faces in one pass rather than a query per card.
 */
export function useGroupsData(classes: ClassSummary[] | null) {
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
      const loadedGroups = await listGroups(loadedSets.map((s) => s.id))
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
  }, [classes])

  useEffect(() => {
    void load()
  }, [load])

  return { sets, groups, members, loading, error, reload: load }
}

export function membersOf(members: GroupMember[], groupId: string) {
  return members.filter((m) => m.group_id === groupId)
}
