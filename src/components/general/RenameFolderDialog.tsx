import { useEffect, useState } from 'react'
import { renameDraftFolder } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { fileName, folderNameProblem, folderOf, joinPath } from '../../lib/general/files'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'

export function RenameFolderDialog({
  repoId,
  path,
  siblings,
  onClose,
  onRenamed,
}: {
  repoId: string
  path: string | null
  siblings: string[]
  onClose: () => void
  onRenamed: (newPath: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(path ? fileName(path) : '')
    setError(null)
  }, [path])

  async function save() {
    if (!path || busy) return
    const current = fileName(path)
    const problem = folderNameProblem(name, siblings.filter((s) => s !== current))
    if (problem) return setError(problem)
    if (name.trim() === current) return onClose()
    setBusy(true)
    setError(null)
    try {
      const next = joinPath(folderOf(path), name.trim())
      await renameDraftFolder(repoId, path, next)
      onRenamed(next)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not rename the folder. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={path !== null}
      onClose={onClose}
      title="Rename folder"
      description="The new name goes into your draft. Submit it for review to change Main."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>Rename</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save() }} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Folder name">
          {(id) => <Input id={id} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  )
}
