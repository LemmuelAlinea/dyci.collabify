import { supabase } from '../supabase'
import type { ClassWeek, ParseStatus, SyllabusWeek, TeachingResource } from '../types'

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
