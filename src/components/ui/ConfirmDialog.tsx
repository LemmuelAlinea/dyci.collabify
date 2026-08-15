import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Alert } from './Field'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  body: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone = 'danger',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={run} loading={busy} className="!rounded-xl">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="text-[14.5px] leading-relaxed text-muted">{body}</div>
      </div>
    </Modal>
  )
}
