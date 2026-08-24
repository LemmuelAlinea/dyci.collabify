import { useCallback, useEffect, useState } from 'react'
import { useLive } from './useLive'
import { listGroupMembers } from '../lib/api/groups'
import { listTasks, subscribeToBoard } from '../lib/api/tasks'
import { authErrorMessage } from '../lib/authError'
import type { BoardSummary, GroupMember, ProjectTask } from '../lib/types'

/**
 * One board's tasks and the people who can take them, kept live. Mirrors the
 * message thread: a realtime channel plus a slow poll, because a dropped socket
 * must not leave a group looking at a stale board.
 */
export function useTaskBoard(board: BoardSummary | null) {
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const boardId = board?.id
  const groupId = board?.group_id ?? null

  const load = useCallback(async () => {
    if (!boardId) return
    try {
      setTasks(await listTasks(boardId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the tasks.'))
    } finally {
      setLoading(false)
    }
  }, [boardId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Channel and poll are below; this is only the come-back-to-the-tab refresh.
  useLive(load, [], { every: 0 })

  useEffect(() => {
    if (!groupId) return setMembers([])
    void listGroupMembers([groupId]).then(setMembers).catch(() => setMembers([]))
  }, [groupId])

  useEffect(() => {
    if (!boardId) return
    return subscribeToBoard(boardId, () => void load())
  }, [boardId, load])

  useEffect(() => {
    if (!boardId) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 20_000)
    return () => clearInterval(id)
  }, [boardId, load])

  return { tasks, members, loading, error, reload: load }
}
