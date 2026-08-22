import { supabase } from '../supabase'
import type { TaskStatus } from '../types'

/**
 * A student's own record. Three narrow views, each scoped in the database to
 * the person asking — their own work, and the boards they are on.
 *
 * Deliberately not the professor's report views. Those hold every student in
 * the class and are gated by `is_class_professor`; letting a student in would
 * have put one predicate between them and the whole cohort's effort.
 */

/** my_work_report: one row per board this student is on. */
export type MyWork = {
  class_id: string
  class_initial: string
  class_name: string
  code: string
  section: string
  semester: string
  school_year: string
  project_id: string
  project_title: string
  project_due_at: string | null
  board_id: string
  group_name: string | null
  board_student_name: string | null
  submitted_at: string | null
  result_verdict: 'accepted' | 'returned' | null
  result_at: string | null
  board_tasks: number
  board_done: number
  tasks_held: number
  tasks_done: number
  tasks_late: number
  held_pct: number
  personal_pct: number | null
  first_activity: string | null
  last_finish: string | null
}

/** my_board_tasks: the work on a board this student is on. */
export type MyBoardTask = {
  task_id: string
  board_id: string
  class_id: string
  project_id: string
  project_title: string
  board_owner: string | null
  title: string
  weight: number
  status: TaskStatus
  author_role: 'professor' | 'student'
  due_at: string | null
  started_at: string | null
  done_at: string | null
  late: boolean
  position: number
  holders: string
  file_count: number
}

/** my_board_members: how the board's work was split. */
export type MyBoardMember = {
  board_id: string
  student_id: string
  student_name: string
  avatar_url: string | null
  tasks_held: number
  tasks_done: number
  tasks_late: number
  held_pct: number
  personal_pct: number | null
  is_me: boolean
}

export async function myWork() {
  const { data, error } = await supabase
    .from('my_work_report')
    .select('*')
    .order('project_title')
  if (error) throw error
  return (data ?? []) as MyWork[]
}

export async function myBoardTasks(boardId: string) {
  const { data, error } = await supabase
    .from('my_board_tasks')
    .select('*')
    .eq('board_id', boardId)
    .order('position')
  if (error) throw error
  return (data ?? []) as MyBoardTask[]
}

export async function myBoardMembers(boardId: string) {
  const { data, error } = await supabase
    .from('my_board_members')
    .select('*')
    .eq('board_id', boardId)
    .order('student_name')
  if (error) throw error
  return (data ?? []) as MyBoardMember[]
}
