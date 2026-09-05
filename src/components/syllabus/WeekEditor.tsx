import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { EmptyState } from '../ui/EmptyState'
import { addWeek, deleteWeek, updateWeek } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import type { SyllabusWeek } from '../../lib/types'

/** Autosaves on blur — a professor correcting 18 weeks should never hunt for Save. */
function WeekRow({
  week,
  onChanged,
  onDelete,
}: {
  week: SyllabusWeek
  onChanged: () => Promise<void> | void
  onDelete: (week: SyllabusWeek) => void
}) {
  const { show } = useToast()
  const [draft, setDraft] = useState(week)
  const [saving, setSaving] = useState(false)

  async function commit(patch: Partial<SyllabusWeek>) {
    const changed = Object.entries(patch).some(
      ([k, v]) => week[k as keyof SyllabusWeek] !== v,
    )
    if (!changed) return
    setSaving(true)
    try {
      await updateWeek(week.id, patch)
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save that week.'), 'error')
      setDraft(week)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="surface rounded-card border border-line p-4 shadow-card md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-600 font-mono text-[12px] font-bold text-amber-400 dark:bg-navy-500">
          {week.week_no}
        </span>

        <div className="min-w-0 flex-1 space-y-2.5">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onBlur={() => commit({ title: draft.title })}
            placeholder="What this week covers"
            aria-label={`Week ${week.week_no} title`}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold text-ink hover:border-[var(--line)] focus:border-navy-400"
          />
          <Textarea
            rows={2}
            value={draft.topics}
            onChange={(e) => setDraft({ ...draft, topics: e.target.value })}
            onBlur={() => commit({ topics: draft.topics })}
            placeholder="Topics"
            aria-label={`Week ${week.week_no} topics`}
            className="text-[13px]"
          />
          <Textarea
            rows={2}
            value={draft.outcomes}
            onChange={(e) => setDraft({ ...draft, outcomes: e.target.value })}
            onBlur={() => commit({ outcomes: draft.outcomes })}
            placeholder="Learning outcomes"
            aria-label={`Week ${week.week_no} outcomes`}
            className="text-[13px]"
          />
          <Textarea
            rows={2}
            value={draft.assessments}
            onChange={(e) => setDraft({ ...draft, assessments: e.target.value })}
            onBlur={() => commit({ assessments: draft.assessments })}
            placeholder="Assessments — what this week expects handed in"
            aria-label={`Week ${week.week_no} assessments`}
            className="text-[13px]"
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {saving && <Icon name="refresh" size={13} className="animate-spin text-faint" />}
          <button
            type="button"
            onClick={() => onDelete(week)}
            aria-label={`Delete week ${week.week_no}`}
            className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </li>
  )
}

export function WeekEditor({
  resourceId,
  weeks,
  onChanged,
}: {
  resourceId: string
  weeks: SyllabusWeek[]
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [pendingDelete, setPendingDelete] = useState<SyllabusWeek | null>(null)
  const [adding, setAdding] = useState(false)

  const nextNo = weeks.length ? Math.max(...weeks.map((w) => w.week_no)) + 1 : 1

  if (weeks.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title="No weeks yet"
        body="Read the file with AI to draft the weeks, or add them by hand. Either way you can edit everything afterwards."
        action={
          <Button
            className="!rounded-xl"
            loading={adding}
            onClick={async () => {
              setAdding(true)
              try {
                await addWeek(resourceId, 1)
                await onChanged()
              } finally {
                setAdding(false)
              }
            }}
          >
            <Icon name="plus" size={16} />
            Add week 1
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {weeks.map((w) => (
          <WeekRow key={w.id} week={w} onChanged={onChanged} onDelete={setPendingDelete} />
        ))}
      </ul>

      <Button
        variant="outline"
        full
        className="!rounded-xl"
        loading={adding}
        onClick={async () => {
          setAdding(true)
          try {
            await addWeek(resourceId, nextNo)
            await onChanged()
          } catch (err) {
            show(authErrorMessage(err, 'Could not add a week.'), 'error')
          } finally {
            setAdding(false)
          }
        }}
      >
        <Icon name="plus" size={16} />
        Add week {nextNo}
      </Button>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteWeek(pendingDelete.id)
          show(`Week ${pendingDelete.week_no} deleted`)
          await onChanged()
        }}
        title={`Delete week ${pendingDelete?.week_no ?? ''}?`}
        body="The week and its topics are removed from this syllabus. Any class using it loses that week from its map."
        confirmLabel="Delete week"
      />
    </div>
  )
}
