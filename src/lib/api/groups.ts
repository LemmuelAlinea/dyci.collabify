import { supabase } from '../supabase'
import { byLastName } from '../types'
import { pastPairs } from '../grouping'
import type {
  GroupMember,
  GroupSet,
  GroupSummary,
  GroupingMode,
  JoinGroupResult,
  Profile,
} from '../types'

const PROFILE_COLS = 'id, first_name, middle_name, last_name, avatar_url'

/* ----------------------------------------------------------------- sets */

export async function listSetsForClasses(classIds: string[]) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('group_sets')
    .select('*')
    .in('class_id', classIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GroupSet[]
}

/** A set that still exists and still has groups, with its live head count. */
export type LiveGroupSet = GroupSet & { group_count: number; member_count: number }

/**
 * What a project can actually be assigned to. A set whose groups have all been
 * deleted is an empty shell — offering it would hand the project to nobody.
 */
export async function listLiveSets(classIds: string[]) {
  const sets = await listSetsForClasses(classIds)
  const groups = await listGroups(sets.map((s) => s.id))
  return sets
    .map((s) => {
      const mine = groups.filter((g) => g.set_id === s.id)
      return {
        ...s,
        group_count: mine.length,
        member_count: mine.reduce((n, g) => n + g.member_count, 0),
      }
    })
    .filter((s) => s.group_count > 0)
}

/**
 * Who has been in a group with whom in this class's earlier sets, archived
 * groups included, so a random shuffle can keep them apart.
 */
export async function pastGroupmates(classId: string) {
  const sets = await listSetsForClasses([classId])
  if (sets.length === 0) return new Set<string>()
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, student_id')
    .in('set_id', sets.map((s) => s.id))
  if (error) throw error
  return pastPairs((data ?? []) as { group_id: string; student_id: string }[])
}

/** How many projects still point at this set — checked before deleting it. */
export async function projectsUsingSet(setId: string) {
  const { data, error } = await supabase.rpc('projects_using_set', { p_set: setId })
  if (error) throw error
  return (data as number) ?? 0
}

export async function createSet(input: {
  classId: string
  name: string
  mode: GroupingMode
  defaultLimit: number
}) {
  const { data, error } = await supabase
    .from('group_sets')
    .insert({
      class_id: input.classId,
      name: input.name.trim(),
      mode: input.mode,
      default_limit: input.defaultLimit,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as GroupSet
}

export async function renameSet(setId: string, name: string) {
  const { error } = await supabase
    .from('group_sets')
    .update({ name: name.trim() })
    .eq('id', setId)
  if (error) throw error
}

export async function setClosed(setId: string, closed: boolean) {
  const { error } = await supabase
    .from('group_sets')
    .update({ closed_at: closed ? new Date().toISOString() : null })
    .eq('id', setId)
  if (error) throw error
}

export async function deleteSet(setId: string) {
  const { error } = await supabase.from('group_sets').delete().eq('id', setId)
  if (error) throw error
}

/** Class members with no group in this set — drives the close confirmation. */
export async function ungroupedStudents(setId: string) {
  const { data, error } = await supabase.rpc('ungrouped_students', { p_set: setId })
  if (error) throw error
  return (data ?? []) as { student_id: string; first_name: string; last_name: string }[]
}

/* --------------------------------------------------------------- groups */

/**
 * Groups in these sets.
 *
 * Live ones by default: an archived group is put away, and a list that keeps
 * showing it has not put it anywhere. `archived: true` is the other half of
 * the same switch, for the shelf a professor goes to when they want it back.
 */
export async function listGroups(setIds: string[], opts: { archived?: boolean } = {}) {
  if (setIds.length === 0) return []
  const query = supabase.from('group_overview').select('*').in('set_id', setIds).order('position')
  const { data, error } = opts.archived
    ? await query.not('archived_at', 'is', null)
    : await query.is('archived_at', null)
  if (error) throw error
  return (data ?? []) as GroupSummary[]
}

export async function getGroup(groupId: string) {
  const { data, error } = await supabase
    .from('group_overview')
    .select('*')
    .eq('id', groupId)
    .maybeSingle()
  if (error) throw error
  return (data as GroupSummary | null) ?? null
}

export async function listGroupMembers(groupIds: string[]) {
  if (groupIds.length === 0) return []
  const { data, error } = await supabase
    .from('group_members')
    .select(
      `group_id, set_id, student_id, added_by, joined_at, profile:profiles!group_members_student_id_fkey (${PROFILE_COLS})`,
    )
    .in('group_id', groupIds)
  if (error) throw error
  const rows = (data ?? []) as unknown as GroupMember[]
  return rows.filter((r) => r.profile).sort((a, b) => byLastName(a.profile, b.profile))
}

export async function renameGroup(groupId: string, name: string) {
  const { error } = await supabase.from('groups').update({ name: name.trim() }).eq('id', groupId)
  if (error) throw error
}

export async function setGroupLimit(groupId: string, limit: number) {
  const { error } = await supabase.from('groups').update({ member_limit: limit }).eq('id', groupId)
  if (error) throw error
}

/** "Apply to every group in this set" from the limit editor. */
export async function setLimitForSet(setId: string, limit: number) {
  const { error } = await supabase
    .from('groups')
    .update({ member_limit: limit })
    .eq('set_id', setId)
  if (error) throw error
  const { error: setErr } = await supabase
    .from('group_sets')
    .update({ default_limit: limit })
    .eq('id', setId)
  if (setErr) throw setErr
}

export async function addGroup(setId: string, name: string, limit: number, position: number) {
  const { data, error } = await supabase
    .from('groups')
    .insert({ set_id: setId, name: name.trim(), member_limit: limit, position })
    .select('*')
    .single()
  if (error) throw error
  return data as GroupSummary
}

/**
 * Put a group away, or bring it back.
 *
 * Nothing else moves: its members stay placed, its board and its conversation
 * stay whole, and restoring it is this call with `false`. That is the whole
 * reason it exists — the alternative was a delete that took all three.
 *
 * A plain update rather than an RPC, the same shape as archiving a class.
 * `groups_write` already restricts it to the set's professor, and
 * `guard_group_columns` reverts the column for anybody else, so a member
 * renaming their own group cannot archive it.
 */
export async function archiveGroup(groupId: string, archived: boolean) {
  const { error } = await supabase
    .from('groups')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', groupId)
  if (error) throw error
}

/**
 * Remove a group for good.
 *
 * Only works on a group that never held anything. `guard_group_delete()` in
 * the database refuses it the moment there is a task or a message behind it,
 * and says what is there — because this delete cascades into the group's board
 * and its conversation, and neither can be put back.
 */
export async function deleteGroup(groupId: string) {
  const { error } = await supabase.from('groups').delete().eq('id', groupId)
  if (error) throw error
}

/* -------------------------------------------------------------- members */

/** Professor placing a student. Moving is delete-then-insert in one call. */
export async function placeStudent(input: {
  groupId: string
  setId: string
  studentId: string
  byProfessorId: string
}) {
  const { error: clearErr } = await supabase
    .from('group_members')
    .delete()
    .eq('set_id', input.setId)
    .eq('student_id', input.studentId)
  if (clearErr) throw clearErr

  const { error } = await supabase.from('group_members').insert({
    group_id: input.groupId,
    set_id: input.setId,
    student_id: input.studentId,
    added_by: input.byProfessorId,
  })
  if (error) throw error
}

export async function removeFromGroup(groupId: string, studentId: string) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('student_id', studentId)
  if (error) throw error
}

/* ------------------------------------------------------------ bulk save */

export type ArrangementGroup = { name: string; member_limit: number; students: string[] }

export async function saveArrangement(setId: string, groups: ArrangementGroup[]) {
  const { data, error } = await supabase.rpc('save_group_arrangement', {
    p_set: setId,
    p_groups: groups,
  })
  if (error) throw error
  return data as { result: 'saved' | 'closed' | 'not_allowed'; groups?: number }
}

/* --------------------------------------------------------- student moves */

export async function joinGroup(groupId: string) {
  const { data, error } = await supabase.rpc('join_group', { p_group: groupId })
  if (error) throw error
  return data as { result: JoinGroupResult; group_id?: string }
}

export async function leaveGroup(groupId: string) {
  const { data, error } = await supabase.rpc('leave_group', { p_group: groupId })
  if (error) throw error
  return data as { result: 'left' | 'closed' | 'not_student_formed' | 'not_found' }
}

export const JOIN_GROUP_MESSAGE: Record<Exclude<JoinGroupResult, 'joined'>, string> = {
  already_here: "You're already in this group.",
  full: 'That group is full. Pick one with an open slot.',
  closed: 'Your professor has finalised these groups, so they can no longer change.',
  not_student_formed: 'Your professor arranges the groups for this set.',
  not_in_class: 'You are not in the class this group belongs to.',
  not_found: 'That group no longer exists.',
  not_signed_in: 'Sign in first, then try again.',
}

export type PickableStudent = Pick<
  Profile,
  'id' | 'first_name' | 'middle_name' | 'last_name' | 'avatar_url'
>
