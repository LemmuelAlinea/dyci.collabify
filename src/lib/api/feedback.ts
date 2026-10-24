import { supabase } from '../supabase'
import { safeFileName } from '../general/feedback'
import type {
  FeedbackKind,
  FeedbackListItem,
  FeedbackStatus,
  FeedbackThread,
  GeneralFeedback,
  GeneralFeedbackFile,
  GeneralFeedbackReply,
  StakeholderProject,
} from '../general/feedback'

/* A work project's Feedback tab. Reads go straight to the tables (row-level
 * security keeps them to the project's members); every write is an RPC, and a
 * post's files upload first so the RPC can take their paths. */

export const FEEDBACK_BUCKET = 'feedback-files'
export const FEEDBACK_FILE_LIMIT = 25 * 1024 * 1024
export const FEEDBACK_FILES_PER_POST = 10

function tally(rows: { feedback_id: string }[]) {
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.feedback_id, (out.get(r.feedback_id) ?? 0) + 1)
  return out
}

/** Every post in the project, newest first, with its reply and file counts. */
export async function listFeedback(projectId: string): Promise<FeedbackListItem[]> {
  const [posts, replies, files] = await Promise.all([
    supabase
      .from('general_feedback')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase.from('general_feedback_replies').select('feedback_id').eq('project_id', projectId),
    supabase.from('general_feedback_files').select('feedback_id').eq('project_id', projectId),
  ])
  if (posts.error) throw posts.error
  if (replies.error) throw replies.error
  if (files.error) throw files.error
  const replyCount = tally((replies.data ?? []) as { feedback_id: string }[])
  const fileCount = tally((files.data ?? []) as { feedback_id: string }[])
  return ((posts.data ?? []) as GeneralFeedback[]).map((p) => ({
    ...p,
    reply_count: replyCount.get(p.id) ?? 0,
    file_count: fileCount.get(p.id) ?? 0,
  }))
}

/** One post with its replies, oldest first, and every file on the post or its replies. Null when it is gone. */
export async function getFeedbackThread(feedbackId: string): Promise<FeedbackThread | null> {
  const [post, replies, files] = await Promise.all([
    supabase.from('general_feedback').select('*').eq('id', feedbackId).maybeSingle(),
    supabase.from('general_feedback_replies').select('*').eq('feedback_id', feedbackId).order('created_at'),
    supabase.from('general_feedback_files').select('*').eq('feedback_id', feedbackId).order('created_at'),
  ])
  if (post.error) throw post.error
  if (replies.error) throw replies.error
  if (files.error) throw files.error
  if (!post.data) return null
  return {
    post: post.data as GeneralFeedback,
    replies: (replies.data ?? []) as GeneralFeedbackReply[],
    files: (files.data ?? []) as GeneralFeedbackFile[],
  }
}

/**
 * Uploads each file to <project>/<folder>/<uuid>-<safe-name> and returns the
 * paths. The folder is one client uuid per post (it has no id yet) or the
 * post's id for a reply. The RPC reads each file's name and size from the
 * path and from Storage, so nothing else is sent. An upload that never
 * becomes a post is cleared by the storage sweep.
 */
async function upload(projectId: string, folder: string, files: File[]) {
  if (files.length > FEEDBACK_FILES_PER_POST) throw new Error('Attach up to 10 files at a time.')
  for (const file of files) {
    if (file.size > FEEDBACK_FILE_LIMIT) throw new Error(`${file.name} is over 25 MB. Share a link to it instead.`)
  }
  const paths: string[] = []
  for (const file of files) {
    const path = `${projectId}/${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const { error } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export async function createFeedback(
  projectId: string,
  kind: FeedbackKind,
  title: string,
  body: string,
  files: File[],
) {
  const paths = await upload(projectId, crypto.randomUUID(), files)
  return rpc<string>('create_general_feedback', {
    p_project: projectId,
    p_kind: kind,
    p_title: title.trim(),
    p_body: body.trim(),
    p_paths: paths,
  })
}

export async function replyFeedback(projectId: string, feedbackId: string, body: string, files: File[]) {
  const paths = await upload(projectId, feedbackId, files)
  return rpc<string>('reply_general_feedback', {
    p_feedback: feedbackId,
    p_body: body.trim(),
    p_paths: paths,
  })
}

export const setFeedbackStatus = (feedbackId: string, status: FeedbackStatus) =>
  rpc<void>('set_general_feedback_status', { p_feedback: feedbackId, p_status: status })

/** A link to open a feedback file, good for an hour. */
export async function feedbackFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

/** The caller's live projects where they are a stakeholder, for their Home. */
export async function listMyStakeholderProjects() {
  const { data, error } = await supabase.rpc('my_stakeholder_projects')
  if (error) throw error
  return ((data ?? []) as StakeholderProject[]).map((p) => ({
    ...p,
    progress_pct: Number(p.progress_pct),
  }))
}
