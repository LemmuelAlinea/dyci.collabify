import type { AppNotification, Role } from '../../lib/types'
import { paths } from '../../lib/paths'

/** Where a notification opens. An invitation opens the Inbox with it marked. */
export function destination(n: AppNotification, role: Role | null, teaches: boolean): string {
  switch (n.type) {
    case 'reassign_requested':
    case 'reassign_decided':
      // Someone who teaches answers reassignments on their own page; a student
      // falls through to the class project the task is on.
      if (teaches) return paths.reassignments
      break
    case 'general_invited':
      return n.general_project_id ? `${paths.inbox}?invite=project:${n.general_project_id}` : paths.inbox
    case 'space_invited':
      return n.general_space_id ? `${paths.inbox}?invite=space:${n.general_space_id}` : paths.inbox
    case 'privacy_request':
      if (role === 'admin') return paths.admin.privacy
      return n.title.startsWith('Privacy request') ? paths.privacyQueue : paths.privacyRequest
    case 'weekly_digest':
      // About everything at once, so My tasks, the page it summarises.
      return role === 'student' ? paths.tasks : paths.home
    case 'review_requested':
    case 'review_answered':
      if (n.general_project_id) return `${paths.project(n.general_project_id)}?tab=files`
      // A class project's Files.
      return n.project_id ? `${paths.classProject(n.project_id)}?tab=files` : paths.home
    case 'discussion_started':
      if (n.general_project_id) return `${paths.project(n.general_project_id)}?tab=discussion`
      return n.project_id ? `${paths.classProject(n.project_id)}?tab=discussion` : paths.home
    case 'file_shared':
      if (n.general_project_id) return `${paths.project(n.general_project_id)}?tab=shared`
      // A class project's group.
      return n.project_id ? `${paths.classProject(n.project_id)}?tab=shared` : paths.home
    case 'feedback_posted':
    case 'feedback_reply':
    case 'feedback_status':
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=feedback` : paths.home
    case 'task_sent_back':
      // QA sent a task back: open the task, where the note is the newest comment.
      if (n.general_project_id) {
        return `${paths.project(n.general_project_id)}${n.general_task_id ? `?task=${n.general_task_id}` : ''}`
      }
      return paths.home
    case 'join_requested':
      // Someone asked to join: the project manager or a coordinator answers it in Settings.
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=settings&section=members` : paths.home
    case 'join_answered':
      return n.general_project_id ? paths.project(n.general_project_id) : paths.home
    case 'sprint_automation':
      // A sprint started, finished or was created on its own: open the Sprints view.
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=plan&work=sprints` : paths.home
    case 'milestone_overdue':
      // A milestone is past its due date. The notification carries no milestone, so open the project's Milestones.
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=plan&work=milestones` : paths.home
    case 'sprint_ending_soon':
    case 'sprint_completed':
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=plan&work=sprints` : paths.home
    case 'milestone_due_soon':
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=plan&work=milestones` : paths.home
    case 'general_task_overdue':
      // A holder's notice names the task; the planners' daily summary names none, so open the Tasks tab.
      if (!n.general_project_id) return paths.home
      return n.general_task_id
        ? `${paths.project(n.general_project_id)}?task=${n.general_task_id}`
        : `${paths.project(n.general_project_id)}?tab=tasks`
    case 'draft_waiting':
      return n.general_project_id ? `${paths.project(n.general_project_id)}?tab=files&view=draft` : paths.home
    case 'meeting_scheduled':
    case 'meeting_changed':
    case 'meeting_cancelled':
      return n.meeting_id ? `${paths.meetings}?meeting=${n.meeting_id}` : paths.meetings
    case 'board_submitted':
      // A hand-in is answered from its class's Submissions, where it waits.
      if (teaches && n.class_id) return `${paths.class(n.class_id)}?tab=submissions&status=waiting`
      break
    case 'group_leader':
      return n.group_id ? paths.group(n.group_id) : paths.home
    case 'general_access_requested':
      if (n.general_project_id) return `${paths.project(n.general_project_id)}?tab=members`
      // A class board's Files, where its leader answers.
      return n.project_id ? `${paths.classProject(n.project_id)}?tab=files` : paths.home
  }
  if (n.general_project_id) {
    return `${paths.project(n.general_project_id)}${n.general_task_id ? `?task=${n.general_task_id}` : ''}`
  }
  // A class space opens its class; a work space opens itself.
  if (n.general_space_id && !n.class_id) return paths.space(n.general_space_id)
  if (n.project_id && role !== 'admin') return paths.classProject(n.project_id)
  if (n.class_id) return role === 'admin' ? paths.home : paths.class(n.class_id)
  return paths.home
}
