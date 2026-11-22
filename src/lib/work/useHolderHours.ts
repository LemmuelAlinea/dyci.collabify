import { useEffect, useState } from 'react'
import { holderRoom, spacePeopleHours, spacePeopleLoad, type HolderRoom, type PeopleHours, type PeopleLoad } from '../api/workload'
import { formatHours, workWeek } from './hours'

export type HolderTone = 'success' | 'warning' | 'danger' | 'pending'
/** A planner's label also carries this week's minutes, so a dialog can project a pick. */
export type HolderLabel = { text: string; tone: HolderTone; load?: number; available?: number }

/**
 * Who is picking holders: a planner (the project manager, a coordinator or the
 * task's team lead) sees hours; a Member in an Open project sees only who has
 * no room; anyone else sees nothing.
 */
export type HolderViewer = 'planner' | 'member' | 'none'

const bare = (minutes: number) => formatHours(minutes).replace(/ h$/, '')

/** "14 / 16 h this week" for each person the hours read returned; "Not set" without weekly hours. */
export function plannerHolderLabels(load: PeopleLoad[], hours: PeopleHours[]): Map<string, HolderLabel> {
  const used = new Map<string, number>()
  for (const row of load) used.set(row.user_id, (used.get(row.user_id) ?? 0) + row.load_minutes)
  const labels = new Map<string, HolderLabel>()
  for (const row of hours) {
    if (row.available_minutes == null) {
      labels.set(row.user_id, { text: 'Not set', tone: 'pending' })
      continue
    }
    const minutes = used.get(row.user_id) ?? 0
    const ratio = row.available_minutes > 0 ? minutes / row.available_minutes : minutes > 0 ? Infinity : 0
    labels.set(row.user_id, {
      text: `${bare(minutes)} / ${bare(row.available_minutes)} h this week`,
      tone: ratio > 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success',
      load: minutes,
      available: row.available_minutes,
    })
  }
  return labels
}

/** Only a person with no room gets a label, and never with hours. */
export function memberHolderLabels(rooms: HolderRoom[]): Map<string, HolderLabel> {
  const labels = new Map<string, HolderLabel>()
  for (const row of rooms) if (row.room === 'full') labels.set(row.user_id, { text: 'No room this week', tone: 'danger' })
  return labels
}

/**
 * Labels for the people in a holder picker. One read per change of people,
 * task or `refresh` (pass the task's holders, so a pick reads the hours again).
 */
export function useHolderHours({ spaceId, userIds, taskId, viewer, refresh = '' }: {
  spaceId: string | null | undefined
  userIds: string[]
  taskId: string | null
  viewer: HolderViewer
  refresh?: string
}): Map<string, HolderLabel> {
  const [labels, setLabels] = useState<Map<string, HolderLabel>>(() => new Map())
  const key = [...userIds].sort().join(',')
  useEffect(() => {
    let current = true
    const ids = key ? key.split(',') : []
    if (!spaceId || ids.length === 0 || viewer === 'none' || (viewer === 'member' && !taskId)) {
      setLabels(new Map())
      return
    }
    const read = viewer === 'planner'
      ? (() => {
          const week = workWeek()
          return Promise.all([spacePeopleLoad(spaceId, week.from, week.to, ids), spacePeopleHours(spaceId, week.from, week.to, ids)])
            .then(([load, hours]) => plannerHolderLabels(load, hours))
        })()
      : holderRoom(taskId!, ids).then(memberHolderLabels)
    // Hours are a hint: a failed read shows no labels rather than an error.
    void read.then((next) => { if (current) setLabels(next) }).catch(() => { if (current) setLabels(new Map()) })
    return () => { current = false }
  }, [spaceId, key, taskId, viewer, refresh])
  return labels
}
