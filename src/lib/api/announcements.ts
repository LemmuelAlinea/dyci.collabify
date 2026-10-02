import { supabase } from '../supabase'
import { invokeFunction } from './functions'
import { listProfessorClasses } from './classes'
import type { Announcement, AnnouncementAttachment, AnnouncementLink } from '../types'

const BUCKET = 'class-files'

const SELECT = `
  id, class_id, author_id, title, body, pinned, edited_at, created_at, updated_at, links,
  attachments:announcement_attachments (id, announcement_id, file_path, file_name, mime_type, size_bytes),
  author:profiles!announcements_author_id_fkey (first_name, last_name, avatar_url)
`

export async function listAnnouncements(classId: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select(SELECT)
    .eq('class_id', classId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Announcement[]
}

/** Across every class the viewer is in — what the dashboard swiper shows. */
export async function listRecentAnnouncements(classIds: string[], limit = 8) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('announcements')
    .select(SELECT)
    .in('class_id', classIds)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as Announcement[]
}

export async function createAnnouncement(input: {
  classId: string
  authorId: string
  title: string
  body: string
  files?: File[]
  links?: AnnouncementLink[]
}) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      class_id: input.classId,
      author_id: input.authorId,
      title: input.title.trim(),
      body: input.body.trim(),
      links: input.links ?? [],
    })
    .select('id')
    .single()
  if (error) throw error

  const announcementId = data.id as string
  for (const file of input.files ?? []) {
    await attachFile(input.classId, announcementId, file)
  }
  return announcementId
}

export async function attachFile(classId: string, announcementId: string, file: File) {
  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${classId}/announcements/${announcementId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { error } = await supabase.from('announcement_attachments').insert({
    announcement_id: announcementId,
    file_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function updateAnnouncement(
  id: string,
  patch: { title: string; body: string; links: AnnouncementLink[] },
) {
  const { error } = await supabase
    .from('announcements')
    .update({
      title: patch.title.trim(),
      body: patch.body.trim(),
      links: patch.links,
      edited_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteAnnouncement(announcement: Announcement) {
  const paths = announcement.attachments.map((a) => a.file_path)
  const { error } = await supabase.from('announcements').delete().eq('id', announcement.id)
  if (error) throw error
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}

/**
 * One pin per class is enforced by a partial unique index, so the old pin has to
 * come off before the new one goes on.
 */
export async function setPinned(classId: string, announcementId: string, pinned: boolean) {
  if (pinned) {
    const { error: clearErr } = await supabase
      .from('announcements')
      .update({ pinned: false })
      .eq('class_id', classId)
      .eq('pinned', true)
    if (clearErr) throw clearErr
  }
  const { error } = await supabase
    .from('announcements')
    .update({ pinned })
    .eq('id', announcementId)
  if (error) throw error
}

export async function attachmentUrl(attachment: AnnouncementAttachment) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(attachment.file_path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

export type NoticeDraft = { result: 'ok' | 'failed'; title?: string; body?: string; message?: string }

/**
 * A title and message drafted from one line. For a class (someone teaching
 * it) or the whole program (an admin). Fills the composer; posts nothing.
 */
export async function draftNotice(input: { intent: string; classId?: string }) {
  return invokeFunction<NoticeDraft>('draft-notice', {
    intent: input.intent.trim(),
    scope: input.classId ? 'class' : 'program',
    class_id: input.classId ?? null,
  })
}

/* ----------------------------------------------------------------- links */

export type LinkOptions = {
  classes: { id: string; label: string }[]
  projects: { id: string; label: string }[]
  tasks: { id: string; project_id: string; label: string; project: string }[]
}

/**
 * What a professor may link from an announcement in this class: the classes
 * they teach, this class's live projects, and the tasks they set on them (one
 * row per task, not per group copy). The database checks the same rules.
 */
export async function listLinkOptions(classId: string, professorId: string): Promise<LinkOptions> {
  const [classes, projectsRes] = await Promise.all([
    listProfessorClasses(professorId),
    supabase
      .from('projects')
      .select('id, title')
      .eq('class_id', classId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
  ])
  if (projectsRes.error) throw projectsRes.error
  const projects = (projectsRes.data ?? []) as { id: string; title: string }[]

  let tasks: LinkOptions['tasks'] = []
  if (projects.length > 0) {
    const { data, error } = await supabase
      .from('project_tasks')
      .select('origin_id, title, created_at, board:project_boards!inner(project_id)')
      .in(
        'board.project_id',
        projects.map((p) => p.id),
      )
      .not('origin_id', 'is', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    const titleOf = new Map(projects.map((p) => [p.id, p.title]))
    const seen = new Set<string>()
    for (const row of (data ?? []) as unknown as {
      origin_id: string
      title: string
      board: { project_id: string }
    }[]) {
      if (seen.has(row.origin_id)) continue
      seen.add(row.origin_id)
      tasks.push({
        id: row.origin_id,
        project_id: row.board.project_id,
        label: row.title,
        project: titleOf.get(row.board.project_id) ?? '',
      })
    }
    tasks = tasks.sort((a, b) => a.project.localeCompare(b.project) || a.label.localeCompare(b.label))
  }

  return {
    classes: classes
      .filter((c) => c.id === classId || !c.archived_at)
      .map((c) => ({ id: c.id, label: `${c.initial} · ${c.name}` })),
    projects: projects.map((p) => ({ id: p.id, label: p.title })),
    tasks,
  }
}

/**
 * Where a student lands from a task link: their own board's copy of it, which
 * the select policy narrows to. Null when they have none (no group yet, or a
 * group the task was not given to).
 */
export async function findMyTaskCopy(originId: string) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id')
    .eq('origin_id', originId)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.id as string | undefined) ?? null
}
