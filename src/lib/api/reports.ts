import { supabase } from '../supabase'
import type { BoardTask, ClassReport, StudentWork, WeekCoverage } from '../report'

/**
 * What the reports page reads. Each view is scoped to the class's own professor
 * in the database, so nothing here filters by role.
 *
 * Unlike the analytics fetchers, these return archived classes and archived
 * projects. That is the point of them: the report a chair asks for is the one
 * about the term that has just ended.
 */
export async function classReports() {
  const { data, error } = await supabase
    .from('report_class_summary')
    .select('*')
    .order('archived_at', { nullsFirst: true })
    .order('class_name')
  if (error) throw error
  return (data ?? []) as ClassReport[]
}

export async function weekCoverage(classId: string) {
  const { data, error } = await supabase
    .from('report_week_coverage')
    .select('*')
    .eq('class_id', classId)
    .order('week_no')
  if (error) throw error
  return (data ?? []) as WeekCoverage[]
}

export async function studentWork(classId: string) {
  const { data, error } = await supabase
    .from('report_student_work')
    .select('*')
    .eq('class_id', classId)
    .order('student_name')
  if (error) throw error
  return (data ?? []) as StudentWork[]
}

export async function boardTasks(boardId: string) {
  const { data, error } = await supabase
    .from('report_board_tasks')
    .select('*')
    .eq('board_id', boardId)
    .order('position')
  if (error) throw error
  return (data ?? []) as BoardTask[]
}
