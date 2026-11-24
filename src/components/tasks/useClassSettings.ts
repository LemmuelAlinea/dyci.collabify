import { useEffect, useState } from 'react'
import { getClassTaskSettings } from '../../lib/api/projects'
import type { ClassTaskSettings } from '../../lib/api/projects'

/** A class project's task settings, loaded with the board: its cards need the task types. */
export function useClassSettings(projectId: string): ClassTaskSettings | null {
  const [settings, setSettings] = useState<ClassTaskSettings | null>(null)
  useEffect(() => {
    let live = true
    getClassTaskSettings(projectId).then((value) => live && setSettings(value)).catch(() => live && setSettings(null))
    return () => { live = false }
  }, [projectId])
  return settings
}
