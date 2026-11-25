import { TaskDialog } from './TaskDialog'
import { useGeneralProject } from './useGeneralProject'

/**
 * A work task opened over another page, with its project's state loaded behind it.
 * Closing it leaves the reader where they were instead of on the project page.
 */
export function WorkTaskOverlay({
  projectId,
  taskId,
  viewerId,
  onClose,
}: {
  projectId: string
  taskId: string
  viewerId: string | undefined
  onClose: () => void
}) {
  const state = useGeneralProject(projectId, viewerId)
  return <TaskDialog state={state} taskId={taskId} onClose={onClose} />
}
