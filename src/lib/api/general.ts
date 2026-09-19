// src/lib/api/general.ts
/**
 * Every call the General workplace makes.
 *
 * Membership, levels, grants, requests, invitations, join codes and archiving
 * go through RPCs; the tables have no write policy for them. Teams, positions,
 * fields and tasks are written directly and fenced by row-level security, so a
 * write that RLS filters out changes nothing *without an error*. `changed()`
 * turns that silence into a message.
 */
import { supabase } from '../supabase'
import type { PresetPayload } from '../general/presets'
import type { FieldType, FieldValue } from '../general/fields'
import type { GeneralLevel, GeneralPermission } from '../general/permissions'
import type { GeneralTaskStatus } from '../general/progress'
import type {
  GeneralAccessRequest,
  GeneralComment,
  GeneralCounts,
  GeneralField,
  GeneralFieldValue,
  GeneralFile,
  GeneralGrant,
  GeneralLog,
  GeneralMember,
  GeneralPosition,
  GeneralPositionHolder,
  GeneralProject,
  GeneralProjectSummary,
  GeneralStatus,
  GeneralTask,
  GeneralTaskEvent,
  GeneralTeam,
  GeneralTeamMember,
  MyInvitation,
  PersonHit,
  DraftConflict,
  FileAction,
  FileKind,
  GeneralBlob,
  GeneralCommit,
  GeneralRepo,
  GeneralRepoChange,
  GeneralRepoComment,
  GeneralRepoSummary,
  GeneralDraft,
  GeneralDraftFile,
  GeneralTreeFile,
  RepoFile,
  ProjectInvitation,
} from '../general/types'

const PERSON = 'id, first_name, last_name, avatar_url'
const BUCKET = 'general-files'
export const GENERAL_FILE_LIMIT = 25 * 1024 * 1024

function changed<T>(rows: T[] | null, message: string): T[] {
  if (!rows || rows.length === 0) throw new Error(message)
  return rows
}

/* ---------------------------------------------------------------- projects */

export async function listMyGeneralProjects() {
  const { data, error } = await supabase
    .from('general_project_overview')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralProjectSummary[]
}

export async function getGeneralProject(projectId: string) {
  const { data, error } = await supabase
    .from('general_project_overview')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  return (data as GeneralProjectSummary | null) ?? null
}

/**
 * The preset's content goes down with the project so the database applies it in
 * one transaction. A project is never half set up, and a preset that fails
 * takes nothing with it.
 */
export async function createGeneralProject(input: {
  name: string
  description: string
  startsOn: string | null
  endsOn: string | null
  preset?: string | null
  content?: PresetPayload | null
}) {
  const { data, error } = await supabase.rpc('create_general_project', {
    p_name: input.name,
    p_description: input.description,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_preset: input.preset ?? null,
    p_content: input.content ?? null,
  })
  if (error) throw error
  return data as GeneralProject
}

export type ProjectPatch = Partial<{
  name: string
  description: string
  starts_on: string | null
  ends_on: string | null
  status: GeneralStatus
  points_enabled: boolean
}>

export async function updateGeneralProject(projectId: string, patch: ProjectPatch) {
  const { data, error } = await supabase
    .from('general_projects')
    .update(patch)
    .eq('id', projectId)
    .select('id')
  if (error) throw error
  changed(
    data,
    'That change did not go through. The project may have been archived, or you may no longer have permission to edit it. Reload to see where things stand.',
  )
}

export async function archiveGeneralProject(projectId: string, archived: boolean) {
  const { error } = await supabase.rpc('archive_general_project', {
    p_project: projectId,
    p_archived: archived,
  })
  if (error) throw error
}

export async function setJoinCode(projectId: string, open: boolean, regenerate = false) {
  const { data, error } = await supabase.rpc('set_general_join_code', {
    p_project: projectId,
    p_open: open,
    p_regenerate: regenerate,
  })
  if (error) throw error
  return (data as string | null) ?? null
}

/**
 * A wrong code comes back as null rather than an error, so the rate limit that
 * counted the attempt is not rolled back with it.
 */
export async function joinGeneralProject(code: string) {
  const { data, error } = await supabase.rpc('join_general_project', { p_code: code })
  if (error) throw error
  if (!data) throw new Error('That code does not match an open project. Check it with whoever shared it.')
  return data as string
}

/* ---------------------------------------------------------------- members */

export async function listGeneralMembers(projectId: string) {
  const { data, error } = await supabase
    .from('general_members')
    .select(`project_id, user_id, level, joined_at, profile:profiles (${PERSON}, status)`)
    .eq('project_id', projectId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []) as unknown as GeneralMember[]
}

export async function setMemberLevel(projectId: string, userId: string, level: GeneralLevel) {
  const { error } = await supabase.rpc('set_general_member_level', {
    p_project: projectId,
    p_user: userId,
    p_level: level,
  })
  if (error) throw error
}

export async function removeMember(projectId: string, userId: string) {
  const { error } = await supabase.rpc('remove_general_member', {
    p_project: projectId,
    p_user: userId,
  })
  if (error) throw error
}

export async function leaveProject(projectId: string) {
  const { error } = await supabase.rpc('leave_general_project', { p_project: projectId })
  if (error) throw error
}

/* ---------------------------------------------------------------- permissions */

export async function listGrants(projectId: string) {
  const { data, error } = await supabase
    .from('general_grants')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralGrant[]
}

export async function grantPermission(projectId: string, userId: string, permission: GeneralPermission) {
  const { error } = await supabase.rpc('grant_general_permission', {
    p_project: projectId,
    p_user: userId,
    p_permission: permission,
  })
  if (error) throw error
}

export async function revokePermission(projectId: string, userId: string, permission: GeneralPermission) {
  const { error } = await supabase.rpc('revoke_general_permission', {
    p_project: projectId,
    p_user: userId,
    p_permission: permission,
  })
  if (error) throw error
}

/** RLS narrows this: an Owner gets every request, anyone else only their own. */
export async function listAccessRequests(projectId: string) {
  const { data, error } = await supabase
    .from('general_access_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralAccessRequest[]
}

export async function requestAccess(projectId: string, permission: GeneralPermission, reason: string) {
  const { error } = await supabase.rpc('request_general_access', {
    p_project: projectId,
    p_permission: permission,
    p_reason: reason,
  })
  if (error) throw error
}

export async function answerAccessRequest(requestId: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc('answer_general_access_request', {
    p_request: requestId,
    p_approve: approve,
    p_note: note,
  })
  if (error) throw error
}

export async function withdrawAccessRequest(requestId: string) {
  const { error } = await supabase.rpc('withdraw_general_access_request', { p_request: requestId })
  if (error) throw error
}

/* ---------------------------------------------------------------- invitations */

export async function searchPeople(query: string) {
  const { data, error } = await supabase.rpc('search_general_people', { p_query: query })
  if (error) throw error
  return (data ?? []) as PersonHit[]
}

export async function inviteToProject(projectId: string, userId: string) {
  const { error } = await supabase.rpc('invite_to_general_project', {
    p_project: projectId,
    p_user: userId,
  })
  if (error) throw error
}

/**
 * Through an RPC, not an embed: an invitation must not open the invitee's
 * profile row (and with it their email) to the project. Names and photos only.
 */
export async function listProjectInvitations(projectId: string) {
  const { data, error } = await supabase.rpc('list_general_project_invitations', {
    p_project: projectId,
  })
  if (error) throw error
  type Row = {
    invitation_id: string
    invitee_id: string
    invitee_first_name: string
    invitee_last_name: string
    invitee_avatar_url: string | null
    invited_by: string | null
    created_at: string
  }
  return ((data ?? []) as Row[]).map(
    (r): ProjectInvitation => ({
      id: r.invitation_id,
      project_id: projectId,
      invitee: r.invitee_id,
      invited_by: r.invited_by,
      status: 'pending',
      created_at: r.created_at,
      answered_at: null,
      invitee_profile: {
        id: r.invitee_id,
        first_name: r.invitee_first_name,
        last_name: r.invitee_last_name,
        avatar_url: r.invitee_avatar_url,
      },
    }),
  )
}

export async function withdrawInvitation(invitationId: string) {
  const { error } = await supabase.rpc('withdraw_general_invitation', { p_invitation: invitationId })
  if (error) throw error
}

/** Through an RPC for the same reason as listProjectInvitations. */
export async function listMyInvitations(userId: string) {
  const { data, error } = await supabase.rpc('list_my_general_invitations')
  if (error) throw error
  type Row = {
    invitation_id: string
    project_id: string
    project_name: string
    project_description: string
    inviter_id: string | null
    inviter_first_name: string | null
    inviter_last_name: string | null
    inviter_avatar_url: string | null
    created_at: string
  }
  return ((data ?? []) as Row[]).map(
    (r): MyInvitation => ({
      id: r.invitation_id,
      project_id: r.project_id,
      invitee: userId,
      invited_by: r.inviter_id,
      status: 'pending',
      created_at: r.created_at,
      answered_at: null,
      project: { id: r.project_id, name: r.project_name, description: r.project_description },
      inviter: r.inviter_id
        ? {
            id: r.inviter_id,
            first_name: r.inviter_first_name ?? '',
            last_name: r.inviter_last_name ?? '',
            avatar_url: r.inviter_avatar_url,
          }
        : null,
    }),
  )
}

export async function respondToInvitation(invitationId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_general_invitation', {
    p_invitation: invitationId,
    p_accept: accept,
  })
  if (error) throw error
}

/* ---------------------------------------------------------------- teams and positions */

const NO_STRUCTURE =
  'That change did not go through. It may already be gone, the project may be archived, or you may no longer have permission to manage teams and positions. Reload to see where things stand.'

export async function listTeams(projectId: string) {
  const { data, error } = await supabase
    .from('general_teams')
    .select('*')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return (data ?? []) as GeneralTeam[]
}

export async function createTeam(projectId: string, name: string) {
  const { error } = await supabase.from('general_teams').insert({ project_id: projectId, name: name.trim() })
  if (error) throw error
}

export async function renameTeam(teamId: string, name: string) {
  const { data, error } = await supabase
    .from('general_teams')
    .update({ name: name.trim() })
    .eq('id', teamId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function deleteTeam(teamId: string) {
  const { data, error } = await supabase.from('general_teams').delete().eq('id', teamId).select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listTeamMembers(projectId: string) {
  const { data, error } = await supabase
    .from('general_team_members')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralTeamMember[]
}

export async function addTeamMember(teamId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_team_members')
    .insert({ team_id: teamId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('team_id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listPositions(projectId: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .select('*')
    .eq('project_id', projectId)
    .order('sort')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralPosition[]
}

export async function createPosition(projectId: string, name: string, teamId: string | null, sort: number) {
  const { error } = await supabase
    .from('general_positions')
    .insert({ project_id: projectId, name: name.trim(), team_id: teamId, sort })
  if (error) throw error
}

export async function renamePosition(positionId: string, name: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .update({ name: name.trim() })
    .eq('id', positionId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function deletePosition(positionId: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .delete()
    .eq('id', positionId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listPositionHolders(projectId: string) {
  const { data, error } = await supabase
    .from('general_position_holders')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralPositionHolder[]
}

export async function addPositionHolder(positionId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_position_holders')
    .insert({ position_id: positionId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function removePositionHolder(positionId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_position_holders')
    .delete()
    .eq('position_id', positionId)
    .eq('user_id', userId)
    .select('position_id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

/* ---------------------------------------------------------------- fields */

const NO_FIELDS =
  'That change did not go through. The field may already be gone, the project may be archived, or you may no longer have permission to edit it. Reload to see where things stand.'

export async function listFields(projectId: string) {
  const { data, error } = await supabase
    .from('general_fields')
    .select('*')
    .eq('project_id', projectId)
    .order('sort')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralField[]
}

export async function createField(input: {
  projectId: string
  name: string
  type: FieldType
  options: string[]
  sort: number
}) {
  const { error } = await supabase.from('general_fields').insert({
    project_id: input.projectId,
    name: input.name.trim(),
    type: input.type,
    options: input.options.map((o) => o.trim()),
    sort: input.sort,
  })
  if (error) throw error
}

export async function updateField(
  fieldId: string,
  patch: Partial<{ name: string; type: FieldType; options: string[]; sort: number }>,
) {
  const { data, error } = await supabase
    .from('general_fields')
    .update(patch)
    .eq('id', fieldId)
    .select('id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

export async function deleteField(fieldId: string) {
  const { data, error } = await supabase.from('general_fields').delete().eq('id', fieldId).select('id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

export async function listFieldValues(fieldIds: string[]) {
  if (fieldIds.length === 0) return []
  const { data, error } = await supabase
    .from('general_field_values')
    .select('*')
    .in('field_id', fieldIds)
  if (error) throw error
  return (data ?? []) as GeneralFieldValue[]
}

export async function setFieldValue(fieldId: string, value: FieldValue) {
  const { data, error } = await supabase
    .from('general_field_values')
    .upsert({ field_id: fieldId, value }, { onConflict: 'field_id' })
    .select('field_id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

export async function clearFieldValue(fieldId: string) {
  const { data, error } = await supabase
    .from('general_field_values')
    .delete()
    .eq('field_id', fieldId)
    .select('field_id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

/* ---------------------------------------------------------------- tasks */

export async function listTasks(projectId: string) {
  const { data, error } = await supabase
    .from('general_task_overview')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralTask[]
}

export async function createTask(input: {
  projectId: string
  title: string
  description: string
  dueAt: string | null
  teamId: string | null
  weight: number
}) {
  const { data, error } = await supabase
    .from('general_tasks')
    .insert({
      project_id: input.projectId,
      title: input.title.trim(),
      description: input.description,
      due_at: input.dueAt,
      team_id: input.teamId,
      weight: input.weight,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export type TaskPatch = Partial<{
  title: string
  description: string
  status: GeneralTaskStatus
  due_at: string | null
  team_id: string | null
  weight: number
}>

export async function updateTask(taskId: string, patch: TaskPatch) {
  const { data, error } = await supabase
    .from('general_tasks')
    .update(patch)
    .eq('id', taskId)
    .select('id')
  if (error) throw error
  // Only reached when the row is invisible: not on this project, or the task
  // is gone. A member who simply does not hold the task is refused earlier, by
  // guard_general_task, with its own message.
  changed(data, 'You are not on this project, or this task no longer exists.')
}

export async function deleteTask(taskId: string) {
  const { data, error } = await supabase.from('general_tasks').delete().eq('id', taskId).select('id')
  if (error) throw error
  changed(data, 'Only its creator, before anyone takes it, or someone who manages tasks can remove this.')
}

export async function assignTask(taskId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_task_assignees')
    .insert({ task_id: taskId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function unassignTask(taskId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_task_assignees')
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .select('task_id')
  if (error) throw error
  changed(data, 'You cannot take this person off the task. Ask somebody who manages tasks.')
}

export async function listComments(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralComment[]
}

export async function addComment(taskId: string, projectId: string, body: string) {
  const { error } = await supabase
    .from('general_task_comments')
    .insert({ task_id: taskId, project_id: projectId, body: body.trim() })
  if (error) throw error
}

export async function deleteComment(commentId: string) {
  const { data, error } = await supabase
    .from('general_task_comments')
    .delete()
    .eq('id', commentId)
    .select('id')
  if (error) throw error
  changed(data, 'You cannot remove this comment. Only its author or somebody who manages tasks can.')
}

export async function listFiles(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_files')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralFile[]
}

export async function uploadTaskFile(projectId: string, taskId: string, file: File) {
  if (file.size > GENERAL_FILE_LIMIT) throw new Error('Files can be up to 25 MB.')
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-120)
  // The storage policy reads the project and task off the first two segments.
  const path = `${projectId}/${taskId}/${crypto.randomUUID()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { error } = await supabase.from('general_task_files').insert({
    task_id: taskId,
    project_id: projectId,
    file_path: path,
    file_name: file.name.trim().slice(0, 255) || 'file',
    mime_type: file.type || null,
    size_bytes: file.size,
  })
  if (error) {
    // Do not leave an orphan object behind if the row is rejected.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

/** Storage first: the remove policy reads the row to know who uploaded it. */
export async function deleteTaskFile(file: GeneralFile) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([file.file_path])
  if (storageError) throw storageError
  const { data, error } = await supabase
    .from('general_task_files')
    .delete()
    .eq('id', file.id)
    .select('id')
  if (error) throw error
  changed(data, 'You cannot remove this file. Only whoever added it, or somebody who can edit files, can.')
}

/** The bucket is private, so viewing goes through a ten-minute signed URL. */
export async function generalFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

export async function listLogs(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_logs')
    .select('*')
    .eq('task_id', taskId)
    .order('logged_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralLog[]
}

export async function addLog(taskId: string, projectId: string, minutes: number, note: string) {
  const { error } = await supabase
    .from('general_task_logs')
    .insert({ task_id: taskId, project_id: projectId, minutes, note: note.trim() })
  if (error) throw error
}

export async function deleteLog(logId: string) {
  const { data, error } = await supabase.from('general_task_logs').delete().eq('id', logId).select('id')
  if (error) throw error
  changed(data, 'You can only remove your own time entries.')
}

export async function listTaskEvents(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_events')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralTaskEvent[]
}

/* ---------------------------------------------------------------- admin */

export async function generalCounts() {
  const { data, error } = await supabase.rpc('general_counts')
  if (error) throw error
  const row = ((data ?? []) as GeneralCounts[])[0]
  return row ?? { projects: 0, active_projects: 0, archived_projects: 0, people: 0 }
}

/* -------------------------------------------------------------- repository */

const NO_REPO =
  'That change did not go through. The repository may be gone, the project may be archived, or you may no longer have permission to write to it. Reload to see where things stand.'

export async function getRepo(projectId: string) {
  const { data, error } = await supabase
    .from('general_repo_overview')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as GeneralRepoSummary | null
}

export async function createRepo(projectId: string, name: string, description = '') {
  const { data, error } = await supabase.rpc('create_general_repo', {
    p_project: projectId,
    p_name: name.trim(),
    p_description: description,
  })
  if (error) throw error
  return data as GeneralRepo
}

export async function updateRepo(repoId: string, patch: { name?: string; description?: string }) {
  const { data, error } = await supabase
    .from('general_repos')
    .update(patch)
    .eq('id', repoId)
    .select('id')
  if (error) throw error
  changed(data, NO_REPO)
}

export async function listTree(repoId: string) {
  const { data, error } = await supabase
    .from('general_repo_tree')
    .select('*')
    .eq('repo_id', repoId)
    .order('path')
  if (error) throw error
  return (data ?? []) as GeneralTreeFile[]
}

export async function listCommits(repoId: string) {
  const { data, error } = await supabase
    .from('general_commits')
    .select('*')
    .eq('repo_id', repoId)
    .order('seq', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralCommit[]
}

export async function listCommitFiles(commitId: string) {
  const { data, error } = await supabase
    .from('general_blobs')
    .select('*')
    .eq('commit_id', commitId)
    .order('path')
  if (error) throw error
  return (data ?? []) as GeneralBlob[]
}

/**
 * What a path said as of a commit. Used to show what a change would do, since
 * the tree only ever holds the newest content.
 */
export async function contentAt(repoId: string, path: string, seq: number) {
  const { data, error } = await supabase
    .from('general_blobs')
    .select('action, content')
    .eq('repo_id', repoId)
    .eq('path', path)
    .lte('seq', seq)
    .order('seq', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0] as { action: FileAction; content: string } | undefined
  return !row || row.action === 'removed' ? null : row.content
}

export async function commitFiles(input: {
  repoId: string
  message: string
  baseSeq: number
  files: RepoFile[]
}) {
  const { data, error } = await supabase.rpc('commit_general_files', {
    p_repo: input.repoId,
    p_message: input.message,
    p_base_seq: input.baseSeq,
    p_files: input.files,
  })
  if (error) throw error
  return data as GeneralCommit
}

export async function listRepoChanges(repoId: string) {
  const { data, error } = await supabase
    .from('general_repo_changes')
    .select('*')
    .eq('repo_id', repoId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralRepoChange[]
}

export async function openRepoChange(input: {
  repoId: string
  projectId: string
  authorId: string
  title: string
  body: string
  baseSeq: number
  files: RepoFile[]
}) {
  const { data, error } = await supabase
    .from('general_repo_changes')
    .insert({
      repo_id: input.repoId,
      project_id: input.projectId,
      author_id: input.authorId,
      title: input.title.trim(),
      body: input.body,
      base_seq: input.baseSeq,
      files: input.files,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as GeneralRepoChange
}

export async function withdrawRepoChange(changeId: string) {
  const { data, error } = await supabase
    .from('general_repo_changes')
    .update({ status: 'withdrawn' })
    .eq('id', changeId)
    .select('id')
  if (error) throw error
  changed(data, 'That change is no longer yours to withdraw. It may have been answered already.')
}

export async function answerRepoChange(changeId: string, merge: boolean, note = '') {
  const { data, error } = await supabase.rpc('answer_general_repo_change', {
    p_change: changeId,
    p_merge: merge,
    p_note: note,
  })
  if (error) throw error
  return data as GeneralRepoChange
}

export async function listRepoComments(changeId: string) {
  const { data, error } = await supabase
    .from('general_repo_comments')
    .select('*')
    .eq('change_id', changeId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralRepoComment[]
}

export async function addRepoComment(input: {
  changeId: string
  projectId: string
  authorId: string
  path: string | null
  body: string
}) {
  const { error } = await supabase.from('general_repo_comments').insert({
    change_id: input.changeId,
    project_id: input.projectId,
    author_id: input.authorId,
    path: input.path,
    body: input.body.trim(),
  })
  if (error) throw error
}

export async function deleteRepoComment(commentId: string) {
  const { data, error } = await supabase
    .from('general_repo_comments')
    .delete()
    .eq('id', commentId)
    .select('id')
  if (error) throw error
  changed(data, 'That comment is already gone.')
}

/* ---------------------------------------------------------------- drafts */

/** Your working copy of this project's files, started if you have none. */
export async function myDraft(repoId: string) {
  const { data, error } = await supabase.rpc('my_general_draft', { p_repo: repoId })
  if (error) throw error
  return data as GeneralDraft
}

export async function listDraftFiles(draftId: string) {
  const { data, error } = await supabase
    .from('general_draft_files')
    .select('*')
    .eq('draft_id', draftId)
    .order('path')
  if (error) throw error
  return (data ?? []) as GeneralDraftFile[]
}

export async function saveDraftFile(input: {
  repoId: string
  path: string
  action: FileAction
  kind: FileKind
  content?: string
  storagePath?: string | null
}) {
  const { data, error } = await supabase.rpc('save_general_draft_file', {
    p_repo: input.repoId,
    p_path: input.path,
    p_action: input.action,
    p_kind: input.kind,
    p_content: input.content ?? '',
    p_storage: input.storagePath ?? null,
  })
  if (error) throw error
  return data as GeneralDraftFile
}

export async function discardDraftFile(repoId: string, path: string) {
  const { error } = await supabase.rpc('discard_general_draft_file', {
    p_repo: repoId,
    p_path: path,
  })
  if (error) throw error
}

export async function discardDraft(repoId: string) {
  const { error } = await supabase.rpc('discard_general_draft', { p_repo: repoId })
  if (error) throw error
}

/** Which of your draft's files Main has changed since you started. */
export async function draftConflicts(repoId: string) {
  const { data, error } = await supabase.rpc('general_draft_conflicts', { p_repo: repoId })
  if (error) throw error
  return (data ?? []) as DraftConflict[]
}

export async function syncDraft(repoId: string) {
  const { data, error } = await supabase.rpc('sync_general_draft', { p_repo: repoId })
  if (error) throw error
  return data as GeneralDraft
}

export async function submitDraft(repoId: string, title: string, body = '') {
  const { data, error } = await supabase.rpc('submit_general_draft', {
    p_repo: repoId,
    p_title: title.trim(),
    p_body: body,
  })
  if (error) throw error
  return data as GeneralRepoChange
}

/**
 * Uploads a file the site cannot edit and answers where it landed.
 *
 * The path is `<project>/files/<random>-<name>`, which is the only shape the
 * storage policy and `commit_general_files` both accept — so an upload can
 * never be pointed at another project.
 */
export async function uploadProjectFile(projectId: string, file: File) {
  if (file.size > GENERAL_FILE_LIMIT) throw new Error('Files can be up to 25 MB.')
  const safe = (file.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-120)
  const path = `${projectId}/files/${crypto.randomUUID()}-${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
  if (error) throw error
  return path
}

export async function projectFileUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  if (error) throw error
  return data.signedUrl
}
