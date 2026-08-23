import { supabase } from '../supabase'
import type { Announcement, AnnouncementAttachment } from '../types'

const BUCKET = 'class-files'

const SELECT = `
  id, class_id, author_id, title, body, pinned, edited_at, created_at, updated_at,
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
}) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      class_id: input.classId,
      author_id: input.authorId,
      title: input.title.trim(),
      body: input.body.trim(),
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

export async function updateAnnouncement(id: string, patch: { title: string; body: string }) {
  const { error } = await supabase
    .from('announcements')
    .update({
      title: patch.title.trim(),
      body: patch.body.trim(),
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
