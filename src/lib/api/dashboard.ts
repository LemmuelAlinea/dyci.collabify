import { supabase } from './../supabase'
import { listRecentAnnouncements } from './announcements'
import { listStudentClasses } from './classes'
import { listProjectsForClasses } from './projects'
import { listBoards, myTasks } from './tasks'
import type { MyTask } from './tasks'
import type {
  Announcement,
  BoardSummary,
  ClassSummary,
  ClassWeek,
  MemberProgress,
  ProjectSummary,
} from '../types'

/** Anything with a date the viewer has to meet, from either source. */
export type Deadline = {
  id: string
  kind: 'task' | 'project'
  title: string
  context: string
  due_at: string
  to: string
  done: boolean
}

export type StudentDashboard = {
  classes: ClassSummary[]
  announcements: Announcement[]
  tasks: MyTask[]
  projects: ProjectSummary[]
  boards: BoardSummary[]
  standing: (MemberProgress & { project_title: string })[]
  currentWeeks: ClassWeek[]
  unclaimed: number
  openSets: number
  deadlines: Deadline[]
}

const WEEK = 7 * 86_400_000

export async function studentDashboard(studentId: string): Promise<StudentDashboard> {
  const classes = await listStudentClasses(studentId)
  const classIds = classes.map((c) => c.id)

  const [announcements, tasks, projects, currentWeeks] = await Promise.all([
    listRecentAnnouncements(classIds),
    myTasks(studentId),
    listProjectsForClasses(classIds),
    currentWeekFor(classIds),
  ])

  // RLS hands a student only the boards they work on, so one query covers every
  // project at once rather than one per card.
  const boards = await boardsFor(projects.map((p) => p.id))
  const [standing, unclaimed, openSets] = await Promise.all([
    standingFor(studentId, projects),
    unclaimedFor(boards.map((b) => b.id)),
    openSetsFor(classIds, studentId),
  ])

  const soon = Date.now() + WEEK
  const deadlines: Deadline[] = [
    ...tasks
      .filter((t) => t.due_at)
      .map((t) => ({
        id: t.id,
        kind: 'task' as const,
        title: t.title,
        context: `${t.project_title} · ${t.class_initial}`,
        due_at: t.due_at as string,
        to: `/student/projects/${t.project_id}`,
        done: t.status === 'done',
      })),
    ...projects
      .filter((p) => p.due_at)
      .map((p) => ({
        id: p.id,
        kind: 'project' as const,
        title: p.title,
        context: `${p.class_initial} · ${p.class_name}`,
        due_at: p.due_at as string,
        to: `/student/projects/${p.id}`,
        done: false,
      })),
  ]
    .filter((d) => !d.done && new Date(d.due_at).getTime() < soon)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))

  return {
    classes,
    announcements,
    tasks: tasks.filter((t) => t.status !== 'done'),
    projects,
    boards,
    standing,
    currentWeeks,
    unclaimed,
    openSets,
    deadlines,
  }
}

/* ------------------------------------------------------------------ parts */

export async function boardsFor(projectIds: string[]) {
  if (projectIds.length === 0) return []
  const { data, error } = await supabase
    .from('task_board_overview')
    .select('*')
    .in('project_id', projectIds)
  if (error) throw error
  return (data ?? []) as BoardSummary[]
}

/** The viewer's own row on every board, with the project it belongs to. */
async function standingFor(studentId: string, projects: ProjectSummary[]) {
  if (projects.length === 0) return []
  const { data, error } = await supabase
    .from('task_member_progress')
    .select('*')
    .eq('student_id', studentId)
    .in(
      'project_id',
      projects.map((p) => p.id),
    )
  if (error) throw error

  const titles = new Map(projects.map((p) => [p.id, p.title]))
  return ((data ?? []) as MemberProgress[])
    .filter((row) => row.task_count > 0)
    .map((row) => ({ ...row, project_title: titles.get(row.project_id) ?? 'Project' }))
}

/** Work sitting on their boards that nobody has taken. */
async function unclaimedFor(boardIds: string[]) {
  if (boardIds.length === 0) return 0
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, board_id, status, task_assignees (task_id)')
    .in('board_id', boardIds)
    .neq('status', 'done')
  if (error) throw error
  type Row = { task_assignees: { task_id: string }[] }
  return ((data ?? []) as unknown as Row[]).filter((t) => t.task_assignees.length === 0).length
}

/** Student-formed sets still open that they have not joined. */
async function openSetsFor(classIds: string[], studentId: string) {
  if (classIds.length === 0) return 0
  const { data, error } = await supabase
    .from('group_sets')
    .select('id')
    .in('class_id', classIds)
    .eq('mode', 'student_formed')
    .is('closed_at', null)
  if (error) throw error

  const sets = (data ?? []) as { id: string }[]
  if (sets.length === 0) return 0

  const { data: mine, error: mErr } = await supabase
    .from('group_members')
    .select('set_id')
    .eq('student_id', studentId)
    .in(
      'set_id',
      sets.map((s) => s.id),
    )
  if (mErr) throw mErr

  const joined = new Set((mine ?? []).map((m) => (m as { set_id: string }).set_id))
  return sets.filter((s) => !joined.has(s.id)).length
}

export async function currentWeekFor(classIds: string[]) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('class_week_map')
    .select('*')
    .in('class_id', classIds)
    .eq('phase', 'current')
  if (error) throw error
  return (data ?? []) as ClassWeek[]
}

/* -------------------------------------------------------------- professor */

export type StalledBoard = BoardSummary & { reason: 'empty' | 'quiet'; days: number }

export type Attention = {
  id: string
  icon: 'clock' | 'calendar' | 'file' | 'kanban'
  title: string
  body: string
  to: string
}

export type ProfessorDashboard = {
  classes: ClassSummary[]
  projects: ProjectSummary[]
  boards: BoardSummary[]
  stalled: StalledBoard[]
  attention: Attention[]
}

/** Nothing has moved here in a week — or nothing was ever put on it. */
export function findStalled(boards: BoardSummary[], days = 7): StalledBoard[] {
  const cutoff = Date.now() - days * 86_400_000
  return boards
    .filter((b) => b.group_id && b.done_pct < 100)
    .map((b) => {
      if (b.task_count === 0) return { ...b, reason: 'empty' as const, days: 0 }
      const last = b.last_activity ? new Date(b.last_activity).getTime() : 0
      return {
        ...b,
        reason: 'quiet' as const,
        days: Math.floor((Date.now() - last) / 86_400_000),
      }
    })
    .filter((b) => b.reason === 'empty' || new Date(b.last_activity ?? 0).getTime() < cutoff)
    .sort((a, b) => b.days - a.days)
}

export async function professorDashboard(
  professorId: string,
  classes: ClassSummary[],
): Promise<ProfessorDashboard> {
  const classIds = classes.map((c) => c.id)
  const projects = await listProjectsForClasses(classIds)
  const boards = await boardsFor(projects.map((p) => p.id))

  const { data: resources } = await supabase
    .from('teaching_resources')
    .select('id, title, kind, parse_status')
    .eq('professor_id', professorId)
    .eq('kind', 'syllabus')

  const withTasks = new Set(boards.filter((b) => b.task_count > 0).map((b) => b.project_id))

  const attention: Attention[] = [
    ...classes
      .filter((c) => !c.archived_at && !c.term_start)
      .map((c) => ({
        id: `term-${c.id}`,
        icon: 'calendar' as const,
        title: `${c.initial} has no term dates`,
        body: 'Its syllabus weeks have no calendar dates until you set them.',
        to: `/professor/classes/${c.id}`,
      })),
    ...((resources ?? []) as { id: string; title: string; parse_status?: string }[])
      .filter((r) => r.parse_status && r.parse_status !== 'verified')
      .map((r) => ({
        id: `syl-${r.id}`,
        icon: 'file' as const,
        title: `${r.title} is not verified`,
        body: 'Check the weeks it drafted, then mark it verified.',
        to: `/professor/syllabi/${r.id}`,
      })),
    ...projects
      .filter((p) => p.scheduled)
      .map((p) => ({
        id: `rel-${p.id}`,
        icon: 'clock' as const,
        title: `${p.title} is scheduled`,
        body: `Students see it on ${new Date(p.release_at as string).toLocaleString()}.`,
        to: `/professor/projects/${p.id}`,
      })),
    ...projects
      .filter((p) => !p.archived_at && !p.scheduled && !withTasks.has(p.id))
      .map((p) => ({
        id: `task-${p.id}`,
        icon: 'kanban' as const,
        title: `${p.title} has no tasks yet`,
        body: 'Nobody has broken it down — set the first task, or let the group.',
        to: `/professor/projects/${p.id}`,
      })),
  ]

  return { classes, projects, boards, stalled: findStalled(boards), attention }
}

/** Average completion across a project's groups. */
export function projectAverage(boards: BoardSummary[], projectId: string) {
  const mine = boards.filter((b) => b.project_id === projectId)
  if (mine.length === 0) return { pct: 0, groups: 0, started: 0 }
  const pct = mine.reduce((n, b) => n + Number(b.done_pct), 0) / mine.length
  return {
    pct: Math.round(pct * 10) / 10,
    groups: mine.length,
    started: mine.filter((b) => b.task_count > 0).length,
  }
}

export { listBoards }
