// src/lib/api/spaces.ts
/**
 * Every call a space makes.
 *
 * A space holds projects. Everyone in it reads every project inside; writing
 * still goes through project membership, so nothing here grants edit rights to
 * anything — see can_read_general_project in supabase/general-spaces.sql.
 *
 * Membership, levels, invitations, join codes and archiving go through RPCs:
 * general_spaces has no write policy at all, so there is no path that could set
 * created_by or archived_at directly.
 *
 * Its own module rather than more of src/lib/api/general.ts, which is already
 * a thousand lines and covers a different thing.
 */
import { supabase } from '../supabase'
import type { GeneralLevel } from '../general/permissions'
import type {
  GeneralSpace,
  GeneralSpaceSummary,
  MySpaceInvitation,
  SpaceInvitation,
  SpacePerson,
} from '../general/types'

/* ---------------------------------------------------------------- reading */

export async function listMySpaces() {
  const { data, error } = await supabase
    .from('general_space_overview')
    .select('*')
    .order('name')
  if (error) throw error
  return (data ?? []) as GeneralSpaceSummary[]
}

export async function getSpace(spaceId: string) {
  const { data, error } = await supabase
    .from('general_space_overview')
    .select('*')
    .eq('id', spaceId)
    .maybeSingle()
  if (error) throw error
  return (data as GeneralSpaceSummary | null) ?? null
}

/* ---------------------------------------------------------------- the space */

export async function createSpace(name: string, description = '') {
  const { data, error } = await supabase.rpc('create_general_space', {
    p_name: name,
    p_description: description,
  })
  if (error) throw error
  return data as GeneralSpace
}

export async function updateSpace(spaceId: string, name: string, description: string) {
  const { data, error } = await supabase.rpc('update_general_space', {
    p_space: spaceId,
    p_name: name,
    p_description: description,
  })
  if (error) throw error
  return data as GeneralSpace
}

/**
 * Archiving, never deleting. general_projects.space_id cascades, so dropping a
 * space would take every project inside it and everything inside those.
 */
export async function archiveSpace(spaceId: string, archived: boolean) {
  const { data, error } = await supabase.rpc('archive_general_space', {
    p_space: spaceId,
    p_archived: archived,
  })
  if (error) throw error
  return data as GeneralSpace
}

/* ---------------------------------------------------------------- joining */

export async function setSpaceJoinCode(spaceId: string, open: boolean, regenerate = false) {
  const { data, error } = await supabase.rpc('set_general_space_join_code', {
    p_space: spaceId,
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
export async function joinSpace(code: string) {
  const { data, error } = await supabase.rpc('join_general_space', { p_code: code })
  if (error) throw error
  if (!data) {
    throw new Error('That code does not match an open space. Check it with whoever shared it.')
  }
  return data as string
}

/* ---------------------------------------------------------------- people */

export async function listSpaceMembers(spaceId: string) {
  const { data, error } = await supabase.rpc('list_general_space_members', { p_space: spaceId })
  if (error) throw error
  return (data ?? []) as SpacePerson[]
}

export async function setSpaceLevel(spaceId: string, userId: string, level: GeneralLevel) {
  const { error } = await supabase.rpc('set_general_space_level', {
    p_space: spaceId,
    p_user: userId,
    p_level: level,
  })
  if (error) throw error
}

export async function removeSpaceMember(spaceId: string, userId: string) {
  const { error } = await supabase.rpc('remove_general_space_member', {
    p_space: spaceId,
    p_user: userId,
  })
  if (error) throw error
}

/** Leaving is removing yourself, which needs no permission. */
export async function leaveSpace(spaceId: string, userId: string) {
  return removeSpaceMember(spaceId, userId)
}

/* ---------------------------------------------------------------- invitations */

export async function inviteToSpace(spaceId: string, userId: string) {
  const { error } = await supabase.rpc('invite_to_general_space', {
    p_space: spaceId,
    p_user: userId,
  })
  if (error) throw error
}

export async function listSpaceInvitations(spaceId: string) {
  const { data, error } = await supabase.rpc('list_general_space_invitations', {
    p_space: spaceId,
  })
  if (error) throw error
  return (data ?? []) as SpaceInvitation[]
}

export async function listMySpaceInvitations() {
  const { data, error } = await supabase.rpc('list_my_general_space_invitations')
  if (error) throw error
  return (data ?? []) as MySpaceInvitation[]
}

export async function respondToSpaceInvitation(invitationId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_general_space_invitation', {
    p_invitation: invitationId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function withdrawSpaceInvitation(invitationId: string) {
  const { error } = await supabase.rpc('withdraw_general_space_invitation', {
    p_invitation: invitationId,
  })
  if (error) throw error
}

/* ---------------------------------------------------------------- projects */

/**
 * Who is on a project, for anybody who may read it.
 *
 * A space member who is not a project member can read general_members, but
 * profiles stayed narrow on purpose — joining to it from here would return
 * rows with no names. This RPC is the way across, and like every other list in
 * General it hands back a name and an avatar and never an email.
 */
export async function listProjectMembers(projectId: string) {
  const { data, error } = await supabase.rpc('list_general_project_members', {
    p_project: projectId,
  })
  if (error) throw error
  return (data ?? []) as SpacePerson[]
}
