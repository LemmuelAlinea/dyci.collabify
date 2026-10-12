import { supabase } from '../supabase'
import type {
  ActivityDay,
  BoardBurn,
  BoardCycle,
  ClassGap,
  ClassHealth,
  ClassPace,
  ClassUnmeasured,
  MemberLoad,
  MilestoneProgress,
  RosterRow,
  SprintProgress,
  TaskState,
} from '../types'
import { pageAll } from './paging'
import type { ActionRow, BoardDiagnosis, Participation, Pressure } from '../insight'

/**
 * Everything the analytics page reads. Each view is scoped to the class's own
 * professor in the database, so nothing here filters by class or by role — an
 * unfiltered select already returns only what the caller owns.
 */
export async function classPace() {
  const { data, error } = await supabase.from('class_pace').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassPace[]
}

/**
 * The classes the pace figure cannot speak for. Read alongside `classPace` so
 * a class missing its term dates or its syllabus says so instead of vanishing.
 */
export async function classesUnmeasured() {
  const { data, error } = await supabase.from('class_unmeasured').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassUnmeasured[]
}

export async function classGaps() {
  const { data, error } = await supabase.from('class_gaps').select('*').order('week_no')
  if (error) throw error
  return (data ?? []) as ClassGap[]
}

export async function classHealth() {
  const { data, error } = await supabase.from('class_health').select('*').order('class_name')
  if (error) throw error
  return (data ?? []) as ClassHealth[]
}

/** Paged: a class of forty across several projects passes a thousand rows. */
export async function memberLoad() {
  return pageAll<MemberLoad>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_member_load')
      .select('*')
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as MemberLoad[]
  })
}

/** Board-level burn: the projection one level below the syllabus. Paged. */
export async function boardBurn() {
  return pageAll<BoardBurn>(async (from, to) => {
    const { data, error } = await supabase
      .from('board_burn')
      .select('*')
      .order('board_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as BoardBurn[]
  })
}

/* ------------------------------------------------ why, what next, what to do */

/** Every cause of trouble a board has evidence for, one row per board. */
export async function boardDiagnoses() {
  const { data, error } = await supabase.from('board_diagnosis').select('*')
  if (error) throw error
  return (data ?? []) as BoardDiagnosis[]
}

/** Who in the class is anywhere near the work — including who is nowhere near it. */
export async function classParticipation() {
  const { data, error } = await supabase
    .from('class_participation')
    .select('*')
    .order('tasks_held')
  if (error) throw error
  return (data ?? []) as Participation[]
}

/** Open work by the week it falls due, plus what is already past due. */
export async function deadlinePressure() {
  const { data, error } = await supabase
    .from('deadline_pressure')
    .select('*')
    .order('week_start', { nullsFirst: true })
  if (error) throw error
  return (data ?? []) as Pressure[]
}

/**
 * The recommendations, as facts. `rankActions` turns them into sentences and
 * merges in the one rule that needs the burn projection.
 */
export async function classActions() {
  const { data, error } = await supabase.from('class_actions').select('*').order('severity')
  if (error) throw error
  return (data ?? []) as ActionRow[]
}

/**
 * The leaf of the filter chain. Paged: a busy class passes a thousand tasks.
 * Due date keeps the list the way the page shows it; the id makes the order
 * stable between pages.
 */
export async function taskStates() {
  return pageAll<TaskState>(async (from, to) => {
    const { data, error } = await supabase
      .from('task_state')
      .select('*')
      .order('due_at', { nullsFirst: false })
      .order('task_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as TaskState[]
  })
}

/* ------------------------------------------------------------ over time */

/** Events per board, person, day and kind. Paged: a term runs to thousands of rows. */
export async function dailyActivity() {
  return pageAll<ActivityDay>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_daily_activity')
      .select('*')
      .order('day')
      .order('board_id')
      .order('actor_id', { nullsFirst: true })
      .order('kind')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ActivityDay[]
  })
}

export async function studentRoster() {
  return pageAll<RosterRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_student_roster')
      .select('*')
      .order('student_name')
      .order('class_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as RosterRow[]
  })
}

export async function boardCycles() {
  return pageAll<BoardCycle>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_board_cycles')
      .select('*')
      .order('board_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as BoardCycle[]
  })
}

export async function milestoneProgress() {
  return pageAll<MilestoneProgress>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_milestones')
      .select('*')
      .order('due_on')
      .order('milestone_id')
      .order('board_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as MilestoneProgress[]
  })
}

export async function sprintProgress() {
  return pageAll<SprintProgress>(async (from, to) => {
    const { data, error } = await supabase
      .from('analytics_sprints')
      .select('*')
      .order('starts_on')
      .order('sprint_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as SprintProgress[]
  })
}
