/**
 * The Archive page's reads and writes. Listing, and moving a class, group,
 * project, task, space or team to Trash, are supabase/archive-page.sql.
 * Restoring goes through each kind's own archive call, the same one its home
 * page uses, so the rules and side effects are exactly theirs.
 */
import { supabase } from '../supabase'
import type { ArchiveItem } from '../archive'
import { setArchived } from './classes'
import { archiveDraftPath, archiveGeneralProject, archiveSpaceTeam, archiveTask, archiveTaskFile } from './general'
import { archiveGroup } from './groups'
import { setProjectArchived } from './projects'
import { archiveResource, trashResource } from './resources'
import { archiveSpace } from './spaces'
import { archiveClassTask } from './tasks'
import { trashTaskFile } from './trash'

export async function listMyArchive() {
  const { data, error } = await supabase.rpc('list_my_archive')
  if (error) throw error
  return (data ?? []) as ArchiveItem[]
}

export async function restoreArchiveItem(item: ArchiveItem) {
  switch (item.kind) {
    case 'class':
      return setArchived(item.id, false)
    case 'group':
      return archiveGroup(item.id, false)
    case 'class_project':
      return setProjectArchived(item.id, false)
    case 'class_task':
      return archiveClassTask(item.id, false)
    case 'syllabus':
    case 'curriculum':
      return archiveResource(item.id, false)
    case 'space':
      await archiveSpace(item.id, false)
      return
    case 'team':
      await archiveSpaceTeam(item.id, false)
      return
    case 'project':
      return archiveGeneralProject(item.id, false)
    case 'work_task':
      return archiveTask(item.id, false)
    case 'class_file':
    case 'work_file':
      if (item.file_source === 'draft') return archiveDraftPath(item.repo_id!, item.path!, false)
      await archiveTaskFile(item.id, false)
      return
  }
}

export async function trashArchiveItem(item: ArchiveItem) {
  switch (item.kind) {
    case 'syllabus':
    case 'curriculum':
      return trashResource(item.id)
    case 'class_file':
    case 'work_file':
      if (item.file_source === 'draft') {
        const { error } = await supabase.rpc('trash_archived_draft_path', { p_repo: item.repo_id, p_path: item.path })
        if (error) throw error
        return
      }
      return trashTaskFile(item.id)
    default: {
      const { error } = await supabase.rpc('trash_archived_item', { p_kind: item.kind, p_id: item.id })
      if (error) throw error
    }
  }
}
