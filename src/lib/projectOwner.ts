import type { ProjectRow } from './types'

/**
 * A class project's own row changes only for the teacher who set it:
 * `projects_write` checks `created_by = auth.uid()` on every write, so a
 * co-teacher (a space Owner or Manager who teaches) can open the project but
 * any edit, publish, deadline, close or archive is refused. Returns the line
 * that says so, or null when the viewer set the project.
 */
export function projectOwnerLock(
  project: Pick<ProjectRow, 'created_by'>,
  viewerId: string | null | undefined,
  setterName?: string | null,
): string | null {
  if (!viewerId || project.created_by === viewerId) return null
  return `${setterName?.trim() || 'Another teacher'} set this project, so only they can edit, publish, close or archive it.`
}
