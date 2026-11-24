import { useState } from 'react'
import { saveTaskTypes, taskTypeCounts } from '../../lib/api/taskTypes'
import { presetByKey } from '../../lib/taskTypes/presets'
import type { TaskTypeDraft, TaskTypeEntry, TypeFamily } from '../../lib/taskTypes/typeSet'
import { useToast } from '../ui/Toast'
import { PresetDialog } from './PresetDialog'
import { TaskTypesEditor } from './TaskTypesEditor'

/** Settings → Task types for one project, work or class: the editor, its presets and their saves. */
export function TaskTypesCard({
  family,
  projectId,
  set,
  shown,
  preset,
  editable,
  unreadable = false,
  reload,
}: {
  family: TypeFamily
  projectId: string
  set: TaskTypeEntry[]
  shown: string
  preset: string | null
  editable: boolean
  /** The stored list couldn't be read: show it read-only so a save can't replace it with the default. */
  unreadable?: boolean
  reload: () => Promise<void>
}) {
  const { show } = useToast()
  const [browsing, setBrowsing] = useState(false)

  async function save(types: TaskTypeDraft[], fingerprint: string, presetKey: string | null = null) {
    await saveTaskTypes(family, projectId, types, fingerprint, presetKey)
    await reload()
  }

  return (
    <>
      <TaskTypesEditor
        family={family}
        set={set}
        shown={shown}
        preset={preset}
        editable={editable && !unreadable}
        readOnlyNote={unreadable
          ? "This project's task types couldn't be read. Reload the page to try again."
          : family === 'work' ? 'Only the project manager changes task types.' : 'Only a professor changes task types.'}
        save={save}
        loadCounts={() => taskTypeCounts(family, projectId)}
        reload={reload}
        onBrowsePresets={() => setBrowsing(true)}
      />
      {editable && !unreadable && (
        <PresetDialog
          open={browsing}
          family={family}
          current={set}
          currentPreset={preset}
          loadCounts={() => taskTypeCounts(family, projectId)}
          onApply={async (next, key) => {
            await save(next, shown, key)
            show(`Applied the ${presetByKey(key)?.name ?? ''} preset.`)
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
