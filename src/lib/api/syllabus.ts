import { supabase } from '../supabase'
import type {
  ClassRow,
  ClassWeek,
  ParseStatus,
  SyllabusWeek,
  TeachingResource,
  WeekShift,
} from '../types'

/**
 * One row of `class_shift_impact`: a deadline that fell in a moved range.
 *
 * `parent` is the project a task belongs to, and empty for a project. Without
 * it "Write the ERD" in the review list tells the professor nothing about
 * which piece of work it belongs to.
 */
export type ShiftImpact = {
  kind: 'project' | 'task'
  ref_id: string
  label: string
  parent: string
  old_due: string
  new_due: string
}

export async function getResource(id: string) {
  const { data, error } = await supabase
    .from('teaching_resources')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as TeachingResource | null) ?? null
}

export async function listWeeks(resourceId: string) {
  const { data, error } = await supabase
    .from('syllabus_weeks')
    .select('*')
    .eq('resource_id', resourceId)
    .order('week_no')
  if (error) throw error
  return (data ?? []) as SyllabusWeek[]
}

export async function addWeek(resourceId: string, weekNo: number) {
  const { data, error } = await supabase
    .from('syllabus_weeks')
    .insert({ resource_id: resourceId, week_no: weekNo, title: `Week ${weekNo}` })
    .select('*')
    .single()
  if (error) throw error
  return data as SyllabusWeek
}

export async function updateWeek(id: string, patch: Partial<SyllabusWeek>) {
  const { error } = await supabase.from('syllabus_weeks').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteWeek(id: string) {
  const { error } = await supabase.from('syllabus_weeks').delete().eq('id', id)
  if (error) throw error
}

export async function setParseStatus(resourceId: string, status: ParseStatus) {
  const { error } = await supabase
    .from('teaching_resources')
    .update({ parse_status: status })
    .eq('id', resourceId)
  if (error) throw error
}

/** Replaces every week in one go — used by the parse flow and bulk edits. */
export async function replaceWeeks(
  resourceId: string,
  weeks: Pick<SyllabusWeek, 'week_no' | 'title' | 'topics' | 'outcomes'>[],
) {
  const { error: delErr } = await supabase
    .from('syllabus_weeks')
    .delete()
    .eq('resource_id', resourceId)
  if (delErr) throw delErr

  if (weeks.length === 0) return
  const { error } = await supabase
    .from('syllabus_weeks')
    .insert(weeks.map((w) => ({ ...w, resource_id: resourceId })))
  if (error) throw error
}

/* --------------------------------------------------------------- week map */

export async function classWeekMap(classId: string) {
  const { data, error } = await supabase
    .from('class_week_map')
    .select('*')
    .eq('class_id', classId)
    .order('week_no')
  if (error) throw error
  return (data ?? []) as ClassWeek[]
}

export async function setTermDates(classId: string, termStart: string | null, termEnd: string | null) {
  const { error } = await supabase
    .from('classes')
    .update({ term_start: termStart || null, term_end: termEnd || null })
    .eq('id', classId)
  if (error) throw error
}

/* ----------------------------------------------------------- term shifts */

/**
 * Moving a term's weeks after a disruption.
 *
 * Nothing here writes `class_week_shifts` directly — the table grants the
 * client no insert, update or delete at all. Both writes go through database
 * functions, which is where the ownership check, the `term_end` adjustment and
 * the author stamp live. Same shape as reassignments and privacy requests.
 */

/** Every recorded disruption on a class, oldest first. Students read this too. */
export async function listWeekShifts(classId: string) {
  const { data, error } = await supabase
    .from('class_week_shifts')
    .select('id, class_id, from_week, days, reason, created_at')
    .eq('class_id', classId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as WeekShift[]
}

/**
 * Move `fromWeek` and everything after it by `days`.
 *
 * Days rather than a target date, because the sibling class sharing this
 * syllabus needs the same shift and not the same date — its week 4 may already
 * sit somewhere else.
 */
export async function shiftClassWeeks(
  classId: string,
  fromWeek: number,
  days: number,
  reason: string,
) {
  const { data, error } = await supabase.rpc('shift_class_weeks', {
    p_class: classId,
    p_from_week: fromWeek,
    p_days: days,
    p_reason: reason,
  })
  if (error) throw error
  return data as WeekShift
}

/** What that shift left stranded: deadlines that fell in the moved range. */
export async function shiftImpact(shiftId: string) {
  const { data, error } = await supabase.rpc('class_shift_impact', { p_shift: shiftId })
  if (error) throw error
  return (data ?? []) as ShiftImpact[]
}

/** Move only the deadlines that were ticked, and tell the students. */
export async function applyShiftToDeadlines(
  shiftId: string,
  projectIds: string[],
  taskIds: string[],
) {
  const { data, error } = await supabase.rpc('apply_shift_to_deadlines', {
    p_shift: shiftId,
    p_projects: projectIds,
    p_tasks: taskIds,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/**
 * Other classes of mine that would plausibly have been hit by the same thing:
 * same syllabus, same term start, still live.
 *
 * Matched on term start rather than on accumulated offset so the answer is
 * predictable — two sections that began together are the ones a school-wide
 * closure hit together. Anything more clever would be a guess presented as a
 * fact, and each one is named before it moves.
 */
export async function siblingClasses(cls: Pick<ClassRow, 'id' | 'syllabus_id' | 'term_start'>) {
  if (!cls.syllabus_id || !cls.term_start) return []
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, initial, section, term_start, syllabus_id')
    .eq('syllabus_id', cls.syllabus_id)
    .eq('term_start', cls.term_start)
    .is('archived_at', null)
    .neq('id', cls.id)
  if (error) throw error
  return (data ?? []) as Pick<
    ClassRow,
    'id' | 'name' | 'initial' | 'section' | 'term_start' | 'syllabus_id'
  >[]
}

/* ------------------------------------------------------------------ parse */

/**
 * Runs in an Edge Function because it needs the Anthropic key, which must stay
 * server-side. Parsing is a convenience: on failure the editor still works.
 */
export async function parseSyllabus(resourceId: string) {
  const { data, error } = await supabase.functions.invoke('parse-syllabus', {
    body: { resource_id: resourceId },
  })
  if (error) throw error
  return data as { result: 'ok' | 'failed'; weeks?: number; message?: string }
}
