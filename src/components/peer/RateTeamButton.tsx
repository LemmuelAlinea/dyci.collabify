import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { peerForm } from '../../lib/api/peer'
import type { PeerForm } from '../../lib/types'
import { RateTeamModal } from './RateTeamModal'

const dateFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Shown in the class project header while a peer evaluation is open for the
 * student's group. It disappears when there is nothing to rate: no open round,
 * not in a group, or alone in one.
 */
export function RateTeamButton({ projectId }: { projectId: string }) {
  const [form, setForm] = useState<PeerForm | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setForm(await peerForm(projectId))
    } catch {
      setForm(null)
    }
  }, [projectId])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  if (!form || form.team.length < 2) return null

  const done = form.team.every((m) => form.ratings.some((r) => r.ratee_id === m.id))
  const closes = dateFmt.format(new Date(form.round.closes_at))

  return (
    <>
      <Button
        size="sm"
        variant={done ? 'outline' : 'accent'}
        onClick={() => setOpen(true)}
        title={`Closes ${closes}`}
      >
        {done ? 'Edit ratings' : 'Rate your team'}
      </Button>
      {open && (
        <RateTeamModal form={form} open={open} onClose={() => setOpen(false)} onSaved={load} />
      )}
    </>
  )
}
