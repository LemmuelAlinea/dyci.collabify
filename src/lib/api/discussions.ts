import { supabase } from '../supabase'
import { invokeFunction } from './functions'
import type { PollActions } from './polls'
import type { Poll } from '../types'
import type {
  GeneralDiscussion,
  GeneralDiscussionFile,
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

/** Every discussion in the project, newest first, live one included. Trashed ones are left out. */
export async function listDiscussions(projectId: string) {
  const { data, error } = await supabase
    .from('general_discussions')
    .select('*')
    .eq('project_id', projectId)
    .is('trashed_at', null)
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

/** Moves a stopped discussion to the caller's Trash, where it waits 30 days. */
export const trashDiscussion = (discussionId: string) =>
  rpc('trash_general_discussion', { p_discussion: discussionId })

export const createDiscussionFolder = (projectId: string, name: string) =>
  rpc<string>('create_general_discussion_folder', { p_project: projectId, p_name: name })

export const renameDiscussionFolder = (folderId: string, name: string) =>
  rpc('rename_general_discussion_folder', { p_folder: folderId, p_name: name })

export const deleteDiscussionFolder = (folderId: string) =>
  rpc('delete_general_discussion_folder', { p_folder: folderId })

/* ------------------------------------------------------------ polls */

const POLL_COLS = `
  id, message_id, discussion_id, created_by, question, allow_multiple, allow_new_options, closed_at,
  options:general_discussion_poll_options (id, poll_id, label, position),
  votes:general_discussion_poll_votes (
    option_id, user_id,
    voter:profiles!general_discussion_poll_votes_user_id_fkey (first_name, last_name, avatar_url)
  )
`

/** A discussion's polls by the message that carries each, shaped like a chat poll. */
export async function listDiscussionPolls(discussionId: string) {
  const { data, error } = await supabase
    .from('general_discussion_polls')
    .select(POLL_COLS)
    .eq('discussion_id', discussionId)
  if (error) throw error
  const rows = (data ?? []) as unknown as (Omit<Poll, 'conversation_id'> & { discussion_id: string })[]
  return new Map(rows.map((p) => [p.message_id, { ...p, conversation_id: p.discussion_id } as Poll]))
}

export const createDiscussionPoll = (input: {
  discussionId: string
  question: string
  options: string[]
  allowMultiple: boolean
  allowNewOptions: boolean
}) =>
  rpc<{ result: string; poll_id?: string }>('create_general_discussion_poll', {
    p_discussion: input.discussionId,
    p_question: input.question,
    p_options: input.options,
    p_allow_multiple: input.allowMultiple,
    p_allow_new_options: input.allowNewOptions,
  })

/** The same three calls the chat's PollCard makes, pointed at discussion polls. */
export const discussionPollActions: PollActions = {
  castVote: (optionId, selected) =>
    rpc('cast_general_discussion_poll_vote', { p_option: optionId, p_selected: selected }),
  addOption: (pollId, label) => rpc('add_general_discussion_poll_option', { p_poll: pollId, p_label: label }),
  setClosed: (pollId, closed) => rpc('set_general_discussion_poll_closed', { p_poll: pollId, p_closed: closed }),
}

/* ------------------------------------------------------------ voice */

export const VOICE_BUCKET = 'discussion-voice'
/** Five minutes, the most one voice message may run. */
export const VOICE_MAX_MS = 5 * 60_000

/** Uploads a recording into the live discussion and sends it. Returns the message id. */
export async function sendDiscussionVoice(input: {
  projectId: string
  discussionId: string
  blob: Blob
  ms: number
}) {
  const type = input.blob.type.split(';')[0] || 'audio/webm'
  const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm'
  const path = `${input.projectId}/${input.discussionId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(VOICE_BUCKET)
    .upload(path, input.blob, { contentType: type, upsert: false })
  if (error) throw error
  return rpc<string>('send_general_discussion_voice', {
    p_discussion: input.discussionId,
    p_path: path,
    p_ms: Math.max(1, Math.min(Math.round(input.ms), VOICE_MAX_MS)),
  })
}

/** Asks the server to transcribe a voice message. Resolves with its answer; never throws. */
export async function transcribeVoice(messageId: string) {
  try {
    return await invokeFunction<{ result: 'ok' | 'failed'; status?: string; message?: string }>(
      'transcribe-voice',
      { message_id: messageId },
    )
  } catch {
    return { result: 'failed' as const, message: 'The recording could not be transcribed. Try again.' }
  }
}

export const editDiscussionTranscript = (messageId: string, body: string) =>
  rpc('edit_general_discussion_transcript', { p_message: messageId, p_body: body })

/** Playable links for recordings, an hour each, keyed by path. */
export async function voiceUrls(paths: string[]) {
  if (paths.length === 0) return new Map<string, string>()
  const { data, error } = await supabase.storage.from(VOICE_BUCKET).createSignedUrls(paths, 3600)
  if (error) throw error
  const out = new Map<string, string>()
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}

/* ------------------------------------------------------------ shared files */

export const DISCUSSION_FILES_BUCKET = 'discussion-files'
export const DISCUSSION_FILE_LIMIT = 25 * 1024 * 1024
export const DISCUSSION_FILES_PER_MESSAGE = 10

/** A discussion's shared files by the message that carries them. */
export async function listDiscussionFiles(discussionId: string) {
  const { data, error } = await supabase
    .from('general_discussion_files')
    .select('*')
    .eq('discussion_id', discussionId)
    .order('created_at')
  if (error) throw error
  const out = new Map<string, GeneralDiscussionFile[]>()
  for (const f of (data ?? []) as GeneralDiscussionFile[]) out.set(f.message_id, [...(out.get(f.message_id) ?? []), f])
  return out
}

/** Uploads files into the live discussion and sends them with an optional caption. */
export async function sendDiscussionFiles(input: {
  projectId: string
  discussionId: string
  body: string
  files: File[]
}) {
  // An upload that never becomes a message is cleared by the storage sweep.
  const sent: { path: string; name: string; mime: string; size: number }[] = []
  for (const file of input.files) {
    if (file.size > DISCUSSION_FILE_LIMIT) throw new Error(`${file.name} is over 25 MB. Share a link to it instead.`)
    const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-120)
    const path = `${input.projectId}/${input.discussionId}/${crypto.randomUUID()}-${safe}`
    const { error } = await supabase.storage
      .from(DISCUSSION_FILES_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (error) throw error
    sent.push({ path, name: file.name.trim().slice(0, 255) || 'file', mime: file.type, size: file.size })
  }
  return rpc<string>('send_general_discussion_files', {
    p_discussion: input.discussionId,
    p_body: input.body,
    p_files: sent,
  })
}

/** A link to open a shared file, good for an hour. */
export async function discussionFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(DISCUSSION_FILES_BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

/** A shared file's bytes, as a File, to copy onto a task. */
export async function downloadDiscussionFile(path: string, name: string, mime: string | null) {
  const { data, error } = await supabase.storage.from(DISCUSSION_FILES_BUCKET).download(path)
  if (error || !data) throw error ?? new Error(`${name} could not be read.`)
  return new File([data], name, { type: mime ?? data.type })
}
