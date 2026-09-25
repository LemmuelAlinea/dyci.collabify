/**
 * One CSV per table section, with names and dates written the way the page
 * shows them. `toCsv` adds the byte-order mark that keeps Excel reading
 * accented names correctly.
 */
import { toCsv } from '../../../lib/report'
import type { ReportData } from '../../../hooks/useGeneralReport'
import type { ScopeRow } from '../../../lib/api/generalReports'
import { mergePeople, sumSummary, onlyProject } from '../../../lib/general/reportData'
import { describeActivity } from '../../../lib/general/history'
import { REVIEW, STATUS, day, hours, moment } from './format'

export type CsvSection = 'projectComparison' | 'people' | 'activity' | 'tasks' | 'timeLogs' | 'commits' | 'reviews'

export const CSV_LABELS: Record<CsvSection, string> = {
  projectComparison: 'Project comparison',
  people: 'Who did what',
  activity: 'Activity',
  tasks: 'Tasks',
  timeLogs: 'Time logs',
  commits: 'Commits',
  reviews: 'Reviews',
}

export function sectionCsv(section: CsvSection, data: ReportData, projects: ScopeRow[]): string | null {
  const name = (id: string) => projects.find((p) => p.project_id === id)?.name ?? ''
  switch (section) {
    case 'projectComparison':
      if (!data.summary) return null
      return toCsv(
        ['Project', 'Done', 'Total', 'Progress %', 'Overdue', 'Hours', 'Active people', 'Commits'],
        projects.map((p) => {
          const t = sumSummary(onlyProject(data.summary, p.project_id))
          return [p.name, t.done, t.tasks_total, t.tasks_total ? Math.round((t.done / t.tasks_total) * 100) : 0,
            t.overdue_now, hours(t.minutes_in_range), t.members_active, t.commits_in_range]
        }),
      )
    case 'people':
      if (!data.people) return null
      return toCsv(
        ['Person', 'Level', 'Teams', 'Held now', 'Finished', 'Finished late', 'Points', 'Hours', 'Comments',
          'Files', 'Commits', 'Files changed', 'Reviews requested', 'Reviews done', 'First activity', 'Last activity'],
        mergePeople(data.people).map((r) => [r.name ?? 'Somebody', r.level ?? '', r.teams.join('; '), r.tasks_held_now,
          r.tasks_finished_in_range, r.tasks_finished_late, Number(r.points_finished), hours(r.minutes_logged), r.comments,
          r.files_uploaded, r.commits, r.files_changed, r.reviews_requested, r.reviews_done,
          moment(r.first_activity), moment(r.last_activity)]),
      )
    case 'activity':
      if (!data.activity) return null
      return toCsv(
        ['When', 'Project', 'Who', 'What', 'Task'],
        data.activity.map((r) => [moment(r.at), name(r.project_id), r.actor_name ?? 'Somebody', describeActivity(r), r.task_title ?? '']),
      )
    case 'tasks':
      if (!data.tasks) return null
      return toCsv(
        ['Project', 'Task', 'Status', 'Team', 'Held by', 'Created', 'Due', 'Finished', 'Late', 'Points',
          'Hours in range', 'Hours total', 'Comments', 'Files', 'Archived'],
        data.tasks.map((r) => [name(r.project_id), r.title, STATUS[r.status] ?? r.status, r.team, r.holders.join('; '),
          day(r.created_at), day(r.due_at), day(r.completed_at), r.late ? 'Late' : '', r.weight,
          hours(r.minutes_in_range), hours(r.minutes_total), r.comments, r.files, r.archived ? 'Archived' : '']),
      )
    case 'timeLogs':
      if (!data.timeLogs) return null
      return toCsv(
        ['Day', 'Project', 'Person', 'Task', 'Hours', 'Note'],
        data.timeLogs.map((r) => [r.logged_on, name(r.project_id), r.user_name ?? 'Somebody', r.task_title, hours(r.minutes), r.note]),
      )
    case 'commits':
      if (!data.commits) return null
      return toCsv(
        ['Project', '#', 'When', 'Author', 'Message', 'Added', 'Changed', 'Removed', 'From review', 'Reviewer'],
        data.commits.map((r) => [name(r.project_id), r.seq, moment(r.at), r.author ?? 'Somebody', r.message, r.added,
          r.changed, r.removed, r.change_title ?? '', r.reviewer ?? '']),
      )
    case 'reviews':
      if (!data.reviews) return null
      return toCsv(
        ['Project', 'Request', 'Author', 'Reviewer', 'Status', 'Opened', 'Decided', 'Decided by', 'Files', 'Comments', 'Hours open'],
        data.reviews.map((r) => [name(r.project_id), r.title, r.author ?? 'Somebody', r.reviewer ?? '', REVIEW[r.status] ?? r.status,
          moment(r.opened_at), moment(r.decided_at), r.decided_by ?? '', r.files, r.comments, r.hours_open]),
      )
  }
}
