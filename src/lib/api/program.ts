import { supabase } from '../supabase'
import type { ProgramNotice, ProgramSection, SectionOverview } from '../program'
import type { YearLevel } from '../types'

/**
 * What the program office owns: its notices and its sections.
 *
 * Writing is the chair's alone and the database says so — every call here that
 * changes something is refused for anybody else by policy, not by this file.
 */

/* -------------------------------------------------------------- notices */

export async function listNotices() {
  const { data, error } = await supabase
    .from('program_notices')
    .select('*')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProgramNotice[]
}

export async function postNotice(input: { title: string; body: string; pinned: boolean }) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('program_announcements').insert({
    author_id: me.user?.id,
    title: input.title.trim(),
    body: input.body.trim(),
    pinned: input.pinned,
  })
  if (error) throw error
}

export async function editNotice(
  id: string,
  patch: { title?: string; body?: string; pinned?: boolean },
) {
  const { error } = await supabase
    .from('program_announcements')
    .update({ ...patch, edited_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteNotice(id: string) {
  const { error } = await supabase.from('program_announcements').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------- sections */

/** Every section, for the chair's registry page. */
export async function listSectionOverview() {
  const { data, error } = await supabase
    .from('program_section_overview')
    .select('*')
    .order('school_year', { ascending: false })
    .order('year_level')
    .order('name')
  if (error) throw error
  return (data ?? []) as SectionOverview[]
}

/** The plain list, for the picker on the class form. */
export async function listSections() {
  const { data, error } = await supabase
    .from('program_sections')
    .select('*')
    .is('archived_at', null)
    .order('year_level')
    .order('name')
  if (error) throw error
  return (data ?? []) as ProgramSection[]
}

export async function createSection(input: {
  name: string
  year_level: YearLevel
  school_year: string
  adviser_id: string | null
}) {
  const { error } = await supabase.from('program_sections').insert({
    name: input.name.trim(),
    year_level: input.year_level,
    school_year: input.school_year.trim(),
    adviser_id: input.adviser_id,
  })
  if (error) throw error
}

export async function updateSection(
  id: string,
  patch: Partial<{ name: string; adviser_id: string | null; archived_at: string | null }>,
) {
  const { error } = await supabase.from('program_sections').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteSection(id: string) {
  const { error } = await supabase.from('program_sections').delete().eq('id', id)
  if (error) throw error
}
