import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { savePeerRatings } from '../../lib/api/peer'
import { authErrorMessage } from '../../lib/authError'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import type { PeerDimension } from '../../lib/peerDimensions'
import type { PeerForm, PeerRatingInput } from '../../lib/types'

type Draft = Record<string, Partial<Record<PeerDimension, number>> & { comment: string }>

const SCORES = [1, 2, 3, 4, 5] as const

const dateFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function startDraft(form: PeerForm): Draft {
  const saved = new Map(form.ratings.map((r) => [r.ratee_id, r]))
  return Object.fromEntries(
    form.team.map((m) => {
      const r = saved.get(m.id)
      return [
        m.id,
        r
          ? { contributes: r.contributes, interacts: r.interacts, on_track: r.on_track,
              quality: r.quality, skills: r.skills, comment: r.comment }
          : { comment: '' },
      ]
    }),
  )
}

/**
 * Every teammate, yourself first, on the five behaviours. Save waits until every
 * box is answered, because the database refuses a partial form and a half-saved
 * one would read as "rated low" to the professor.
 */
export function RateTeamModal({
  form,
  open,
  onClose,
  onSaved,
}: {
  form: PeerForm
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { show } = useToast()
  const [draft, setDraft] = useState<Draft>(() => startDraft(form))
  const [saving, setSaving] = useState(false)

  const complete = form.team.every((m) => PEER_DIMENSIONS.every((d) => draft[m.id]?.[d.key]))

  const closes = dateFmt.format(new Date(form.round.closes_at))
  const left = form.team.reduce(
    (n, m) => n + PEER_DIMENSIONS.filter((d) => !draft[m.id]?.[d.key]).length,
    0,
  )

  const set = (member: string, key: PeerDimension | 'comment', value: number | string) =>
    setDraft((d) => ({ ...d, [member]: { ...d[member], comment: d[member]?.comment ?? '', [key]: value } }))

  const save = async () => {
    setSaving(true)
    try {
      const rows: PeerRatingInput[] = form.team.map((m) => {
        const r = draft[m.id]
        return {
          ratee_id: m.id,
          contributes: r?.contributes as number,
          interacts: r?.interacts as number,
          on_track: r?.on_track as number,
          quality: r?.quality as number,
          skills: r?.skills as number,
          comment: (r?.comment ?? '').trim(),
        }
      })
      await savePeerRatings(form.round.id, rows)
      show('Ratings saved. You can change them until the round closes.')
      onSaved()
      onClose()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save your ratings. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Rate your team"
      description={`Rate everyone in your group, yourself included, by ${closes}. Your teammates never see what you write or who gave which rating.`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-[13px] text-muted" aria-live="polite">
            {left > 0 ? `${left} ${left === 1 ? 'answer' : 'answers'} left` : 'All answered'}
          </span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!complete || saving}>Save ratings</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {form.team.map((m) => (
          <section key={m.id} className="space-y-4 rounded-card border border-line p-4">
            <h3 className="text-ink">{m.is_me ? `You (${m.name})` : m.name}</h3>
            {PEER_DIMENSIONS.map((d) => (
              <fieldset
                key={d.key}
                className="space-y-2"
                aria-describedby={`${m.id}-${d.key}-anchors`}
              >
                <legend className="text-[14px] font-medium text-ink">
                  {d.label}
                  <span className="sr-only"> — {m.is_me ? 'you' : m.name}</span>
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {SCORES.map((s) => {
                    const checked = draft[m.id]?.[d.key] === s
                    return (
                      <label
                        key={s}
                        className={`relative grid h-9 w-11 cursor-pointer place-items-center rounded-lg border font-mono text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-600 dark:has-[:focus-visible]:outline-navy-300 ${
                          checked
                            ? 'border-navy-600 bg-navy-600 text-[var(--surface)] dark:border-navy-300 dark:bg-navy-300'
                            : 'border-line text-muted hover:border-line-strong'
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${m.id}-${d.key}`}
                          value={s}
                          checked={checked}
                          onChange={() => set(m.id, d.key, s)}
                        />
                        {s}
                      </label>
                    )
                  })}
                </div>
                <p
                  id={`${m.id}-${d.key}-anchors`}
                  className="grid gap-1 text-[12px] text-faint sm:grid-cols-3"
                >
                  <span>1 · {d.low}</span>
                  <span>3 · {d.mid}</span>
                  <span>5 · {d.high}</span>
                </p>
              </fieldset>
            ))}
            <label className="block space-y-1.5">
              <span className="text-[13px] text-muted">
                Comment <span className="text-faint">(optional, only your professor sees this)</span>
              </span>
              <textarea
                value={draft[m.id]?.comment ?? ''}
                onChange={(e) => set(m.id, 'comment', e.target.value)}
                maxLength={1000}
                rows={2}
                className="w-full rounded-lg border border-line surface px-3 py-2 text-[14px] text-ink"
              />
            </label>
          </section>
        ))}
      </div>
    </Modal>
  )
}
