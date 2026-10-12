import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
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
  const { show } = useToast()
  const [form, setForm] = useState<PeerForm | null>(null)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const load = useCallback(async () => {
    try {
      const next = await peerForm(projectId)
      setForm(next)
      if (!next) {
        // Closed (or the group changed) while the modal was open: say so, not silently vanish.
        if (openRef.current) show('This peer evaluation has closed, so your ratings were not saved.', 'error')
        setOpen(false)
      }
    } catch {
      // A failed reload keeps the form on screen, so a draft is never thrown away.
    }
  }, [projectId, show])

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
        variant={done ? 'onNavy' : 'create'}
        size="sm"
        className="!h-8 !rounded-lg !px-3"
        onClick={() => setOpen(true)}
        title={`Closes ${closes}`}
      >
        {done ? 'Edit ratings' : 'Rate your team'}
      </Button>
      {/* Stays mounted while the round lasts, so closing it keeps the draft. */}
      <RateTeamModal key={form.round.id} form={form} open={open} onClose={() => setOpen(false)} onSaved={load} />
    </>
  )
}
