import { supabase } from '../supabase'
import type {
  GeneralDiscussion,
  GeneralDiscussionFolder,
  GeneralDiscussionMessage,
} from '../general/types'

/* A project's Discussion tab. Reads go straight to the tables (row-level
 * security keeps them to the project's members); every write is an RPC. */

export async function listDiscussionFolders(projectId: string) {
  const { data, error } = await supabase
    .from('general_discussion_folders')
    .select('*')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return (data ?? []) as GeneralDiscussionFolder[]
}

/** Every discussion in the project, newest first, live one included. */
export async function listDiscussions(projectId: string) {
  const { data, error } = await supabase
    .from('general_discussions')
    .select('*')
    .eq('project_id', projectId)
    .order('started_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralDiscussion[]
}

export async function listDiscussionMessages(discussionId: string) {
  const { data, error } = await supabase
    .from('general_discussion_messages')
    .select('*')
    .eq('discussion_id', discussionId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralDiscussionMessage[]
}

async function rpc<T = void>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export const startDiscussion = (projectId: string, folderId: string | null, topic: string) =>
  rpc<string>('start_general_discussion', { p_project: projectId, p_folder: folderId, p_topic: topic })

export const sendDiscussionMessage = (discussionId: string, body: string) =>
  rpc<string>('send_general_discussion_message', { p_discussion: discussionId, p_body: body })

export const stopDiscussion = (discussionId: string) =>
  rpc('stop_general_discussion', { p_discussion: discussionId })

/** Saves the edited file. `expected` is the `updated_at` the editor opened; returns the new one. */
export const saveDiscussionFile = (discussionId: string, html: string, expected: string) =>
  rpc<string>('save_general_discussion_file', { p_discussion: discussionId, p_html: html, p_expected: expected })

export const renameDiscussion = (discussionId: string, topic: string) =>
  rpc('rename_general_discussion', { p_discussion: discussionId, p_topic: topic })

export const moveDiscussion = (discussionId: string, folderId: string | null) =>
  rpc('move_general_discussion', { p_discussion: discussionId, p_folder: folderId })

export const deleteDiscussion = (discussionId: string) =>
  rpc('delete_general_discussion', { p_discussion: discussionId })

export const createDiscussionFolder = (projectId: string, name: string) =>
  rpc<string>('create_general_discussion_folder', { p_project: projectId, p_name: name })

export const renameDiscussionFolder = (folderId: string, name: string) =>
  rpc('rename_general_discussion_folder', { p_folder: folderId, p_name: name })

export const deleteDiscussionFolder = (folderId: string) =>
  rpc('delete_general_discussion_folder', { p_folder: folderId })
