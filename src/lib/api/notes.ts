import { supabase } from '../supabase'
import { pageAll } from './paging'
import type { AddableNoteKind } from '../notes'
import type { ClassNote, NoteLogRow } from '../types'

export type NewClassNote = {
  classId: string
  studentId: string | null
  boardId: string | null
  kind: AddableNoteKind
  body: string
  /** YYYY-MM-DD, or null for no follow-up. */
  followUpOn: string | null
}

/** Every note the professor can read, newest first. Paged: a long term passes a thousand. */
export async function listClassNotes() {
  return pageAll<ClassNote>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ClassNote[]
  })
}

/** One class's notes with names, oldest first, archived classes included. */
export async function listClassNoteLog(classId: string) {
  return pageAll<NoteLogRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_note_log')
      .select('*')
      .eq('class_id', classId)
      .order('created_at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as NoteLogRow[]
  })
}

export async function addClassNote(input: NewClassNote) {
  const { error } = await supabase.rpc('add_class_note', {
    p_class: input.classId,
    p_student: input.studentId,
    p_board: input.boardId,
    p_kind: input.kind,
    p_body: input.body,
    p_follow_up: input.followUpOn,
  })
  if (error) throw error
}

export async function resolveClassNote(noteId: string, outcome: string) {
  const { error } = await supabase.rpc('resolve_class_note', { p_note: noteId, p_outcome: outcome })
  if (error) throw error
}
