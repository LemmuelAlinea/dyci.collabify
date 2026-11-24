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
  reload,
}: {
  family: TypeFamily
  projectId: string
  set: TaskTypeEntry[]
  shown: string
  preset: string | null
  editable: boolean
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
        editable={editable}
        readOnlyNote={family === 'work' ? 'Only the project manager changes task types.' : 'Only a professor changes task types.'}
        save={save}
        loadCounts={() => taskTypeCounts(family, projectId)}
        reload={reload}
        onBrowsePresets={() => setBrowsing(true)}
      />
      {editable && (
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
