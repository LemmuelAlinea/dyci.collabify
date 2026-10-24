import type { ProjectRole } from './permissions'

/**
 * A work project's Feedback tab: what a post is, who may post, who may change
 * its status. Mirrors `general_feedback_check` in supabase/project-feedback.sql;
 * the database is the enforcement.
 */

export type FeedbackKind = 'input' | 'concern' | 'approval_request'
export type FeedbackStatus = 'open' | 'acknowledged' | 'resolved'

export const FEEDBACK_KINDS: FeedbackKind[] = ['input', 'concern', 'approval_request']
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['open', 'acknowledged', 'resolved']

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  input: 'Input',
  concern: 'Concern',
  approval_request: 'Approval request',
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export type FeedbackTone = 'pending' | 'warning' | 'success'

/** Open has not been looked at, Acknowledged is in hand, Resolved is done. */
export function feedbackStatusTone(status: FeedbackStatus): FeedbackTone {
  return status === 'resolved' ? 'success' : status === 'acknowledged' ? 'warning' : 'pending'
}

/** The project manager, coordinators and stakeholders post and reply. */
export function canPostFeedback(role: ProjectRole | null): boolean {
  return role === 'pm' || role === 'coordinator' || role === 'stakeholder'
}

/** Only the project manager and coordinators move a post between statuses. */
export function canSetFeedbackStatus(role: ProjectRole | null): boolean {
  return role === 'pm' || role === 'coordinator'
}

/** An author who left keeps their words; the name goes. */
export function feedbackAuthor(authorId: string | null, nameOf: (userId: string) => string): string {
  return authorId ? nameOf(authorId) : 'Former member'
}

/** A file name the storage path can carry, as discussions store theirs. */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(-120)
}

export type GeneralFeedback = {
  id: string
  project_id: string
  author_id: string | null
  kind: FeedbackKind
  title: string
  body: string
  status: FeedbackStatus
  status_changed_by: string | null
  status_changed_at: string | null
  created_at: string
}

export type GeneralFeedbackReply = {
  id: string
  feedback_id: string
  project_id: string
  author_id: string | null
  body: string
  created_at: string
}

export type GeneralFeedbackFile = {
  id: string
  feedback_id: string
  /** Null when the file came with the post itself. */
  reply_id: string | null
  project_id: string
  path: string
  name: string
  size_bytes: number
  created_at: string
}

/** A post as the list shows it. */
export type FeedbackListItem = GeneralFeedback & { reply_count: number; file_count: number }

export type FeedbackThread = {
  post: GeneralFeedback
  replies: GeneralFeedbackReply[]
  files: GeneralFeedbackFile[]
}
