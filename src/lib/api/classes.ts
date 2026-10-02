import { supabase } from '../supabase'
import { byLastName } from '../types'
import { teachingClassFilter } from '../classSpace'
import type {
  ClassMember,
  ClassRow,
  ClassSummary,
  JoinResult,
  Semester,
  YearLevel,
} from '../types'

const PROFILE_COLS = 'id, first_name, middle_name, last_name, email, avatar_url'

/**
 * Every class this person teaches: their own, and the ones they co-teach
 * through a seat in the class's space. RLS lets them read both
 * (classes_select checks teaches_in_space).
 */
export async function listProfessorClasses(professorId: string, archived = false) {
  const { data: seats, error: seatError } = await supabase
    .from('general_space_members')
    .select('space_id')
    .eq('user_id', professorId)
    .in('level', ['owner', 'manager'])
  if (seatError) throw seatError

  const filter = teachingClassFilter(
    professorId,
    (seats ?? []).map((s) => s.space_id as string),
  )
  const base = supabase.from('class_overview').select('*')
  const mine = filter ? base.or(filter) : base.eq('professor_id', professorId)
  const query = mine.order('created_at', { ascending: false })

  const { data, error } = archived
    ? await query.not('archived_at', 'is', null)
    : await query.is('archived_at', null)

  if (error) throw error
  return (data ?? []) as ClassSummary[]
}

export async function listStudentClasses(studentId: string) {
  const { data: memberships, error: memberError } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('status', 'active')
  if (memberError) throw memberError

  const ids = (memberships ?? []).map((m) => m.class_id as string)
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('class_overview')
    .select('*')
    .in('id', ids)
    .is('archived_at', null)
    .order('name')
  if (error) throw error

  const classes = (data ?? []) as ClassSummary[]
  const professorIds = [...new Set(classes.map((c) => c.professor_id))]
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name, avatar_url')
    .in('id', professorIds)

  const byId = new Map((profs ?? []).map((p) => [p.id as string, p]))
  return classes.map((c) => ({ ...c, professor: byId.get(c.professor_id) })) as ClassSummary[]
}

export async function getClass(classId: string) {
  const { data, error } = await supabase
    .from('class_overview')
    .select('*')
    .eq('id', classId)
    .maybeSingle()
  if (error) throw error
  return (data as ClassSummary | null) ?? null
}

export type ClassInput = {
  name: string
  initial: string
  section: string
  year_level: YearLevel
  semester: Semester
  school_year: string
  description?: string | null
  syllabus_id?: string | null
  curriculum_id?: string | null
  student_cap?: number | null
}

export async function createClass(professorId: string, input: ClassInput) {
  // `code` is filled by the classes_set_code trigger, never by the client.
  const { data, error } = await supabase
    .from('classes')
    .insert({
      professor_id: professorId,
      ...input,
      initial: input.initial.trim().toUpperCase(),
      name: input.name.trim(),
      section: input.section.trim(),
      description: input.description?.trim() || null,
      syllabus_id: input.syllabus_id || null,
      curriculum_id: input.curriculum_id || null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ClassRow
}

export async function updateClass(classId: string, patch: Partial<ClassInput & { join_open: boolean }>) {
  const { data, error } = await supabase
    .from('classes')
    .update(patch)
    .eq('id', classId)
    .select('*')
    .single()
  if (error) throw error
  return data as ClassRow
}

export async function setArchived(classId: string, archived: boolean) {
  const { error } = await supabase
    .from('classes')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', classId)
  if (error) throw error
}

export async function listMembers(classId: string, includeRemoved = false) {
  const query = supabase
    .from('class_members')
    .select(`class_id, student_id, status, joined_at, removed_at, removed_by, profile:profiles!class_members_student_id_fkey (${PROFILE_COLS})`)
    .eq('class_id', classId)

  const { data, error } = includeRemoved ? await query : await query.eq('status', 'active')
  if (error) throw error

  const rows = (data ?? []) as unknown as ClassMember[]
  return rows.filter((r) => r.profile).sort((a, b) => byLastName(a.profile, b.profile))
}

export async function removeMember(classId: string, studentId: string, byProfessorId: string) {
  const { error } = await supabase
    .from('class_members')
    .update({
      status: 'removed',
      removed_at: new Date().toISOString(),
      removed_by: byProfessorId,
    })
    .eq('class_id', classId)
    .eq('student_id', studentId)
  if (error) throw error
}

/** Dropping the row clears the block, so the student can use the code again. */
/**
 * Puts a removed student back with what they had. Their group placement and
 * task claims were archived on removal, so this is a replay rather than a
 * fresh join — anything since deleted or filled is simply skipped.
 */
export async function restoreMember(classId: string, studentId: string) {
  const { data, error } = await supabase.rpc('restore_class_member', {
    p_class: classId,
    p_student: studentId,
  })
  if (error) throw error
  return data as {
    result: 'restored' | 'not_allowed' | 'not_removed' | 'full'
    groups?: number
    tasks?: number
  }
}

/** Claims the trail still remembers but the tables no longer hold. */
export async function recoverableWorkCount(classId: string, studentId: string) {
  const { data, error } = await supabase.rpc('recoverable_work_count', {
    p_class: classId,
    p_student: studentId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/** Rebuilds those claims, and the group placement they depend on. */
export async function recoverMemberWork(classId: string, studentId: string) {
  const { data, error } = await supabase.rpc('recover_member_work', {
    p_class: classId,
    p_student: studentId,
  })
  if (error) throw error
  return data as {
    result: 'recovered' | 'not_allowed' | 'not_a_member'
    groups?: number
    tasks?: number
  }
}

/** What a restore would bring back, so the professor knows before they press. */
export async function archivedMemberSummary(classId: string, studentId: string) {
  const { data, error } = await supabase.rpc('archived_member_summary', {
    p_class: classId,
    p_student: studentId,
  })
  if (error) throw error
  return data as { groups: number; tasks: number }
}

export async function joinClass(code: string) {
  const { data, error } = await supabase.rpc('join_class', { p_code: code })
  if (error) throw error
  const payload = data as { result: JoinResult; class_id?: string }
  return payload
}

export type JoinPreview = {
  result: JoinResult | 'ok'
  class_id?: string
  name?: string
  section?: string
  professor?: string
}

/** What an invite link shows before joining. Joins nothing. */
export async function previewJoin(code: string) {
  const { data, error } = await supabase.rpc('class_join_preview', { p_code: code })
  if (error) throw error
  return data as JoinPreview
}

export const JOIN_MESSAGE: Record<Exclude<JoinResult, 'joined'>, string> = {
  already_member: "You're already in that class.",
  not_found: 'No class uses that code. Check it with your professor.',
  closed: 'That class has closed joining. Ask your professor to reopen it.',
  full: 'That class is full. Ask your professor to raise its size limit.',
  archived: 'That class has been archived and no longer accepts students.',
  blocked: 'You were removed from that class. Contact your professor to be let back in.',
  not_student: 'Only student accounts can join a class.',
  not_signed_in: 'Sign in first, then try the code again.',
  inactive: 'This account is not active. Contact the program admin.',
  too_many:
    'Too many codes tried in the last hour. Check the code with your professor and try again later.',
}

/**
 * A past class's live projects and rubrics into another class. The copies
 * land archived with no dates, for the professor to restore one at a time.
 */
export async function copyClassProjects(sourceId: string, targetId: string) {
  const { data, error } = await supabase.rpc('copy_class_projects', {
    p_source: sourceId,
    p_target: targetId,
  })
  if (error) throw error
  return data as { copied: number; skipped: number; sets: number }
}
