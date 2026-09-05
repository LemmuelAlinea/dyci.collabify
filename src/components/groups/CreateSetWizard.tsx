import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { ManualBuilder } from './ManualBuilder'
import type { Draft } from './ManualBuilder'
import { RandomPreview } from './RandomPreview'
import { listMembers } from '../../lib/api/classes'
import { createSet, saveArrangement, shuffleIntoGroups } from '../../lib/api/groups'
import type { PickableStudent } from '../../lib/api/groups'
import { authErrorMessage } from '../../lib/authError'
import { GROUPING_MODES } from '../../lib/types'
import type { ClassSummary, GroupingMode } from '../../lib/types'

type Step = 'setup' | 'arrange'

export function CreateSetWizard({
  open,
  onClose,
  classes,
  fixedClassId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  classes: ClassSummary[]
  /** Set when opened from inside a class, so the picker is skipped. */
  fixedClassId?: string
  onCreated: () => Promise<void> | void
}) {
  const { show } = useToast()

  const [step, setStep] = useState<Step>('setup')
  const [classId, setClassId] = useState(fixedClassId ?? '')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<GroupingMode>('manual')
  const [limit, setLimit] = useState(5)
  const [groupCount, setGroupCount] = useState(4)

  const [students, setStudents] = useState<PickableStudent[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep('setup')
    setClassId(fixedClassId ?? '')
    setName('')
    setMode('manual')
    setLimit(5)
    setGroupCount(4)
    setDrafts([])
    setError(null)
  }, [open, fixedClassId])

  // Keyed on open as well as the class. Opened from inside a class the id never
  // changes, so keying on it alone meant the roster was never fetched again
  // after the reset above cleared it — every count read zero.
  useEffect(() => {
    if (!open || !classId) {
      setStudents([])
      return
    }
    let live = true
    void listMembers(classId)
      .then((members) => live && setStudents(members.map((m) => m.profile)))
      .catch(() => live && setStudents([]))
    return () => {
      live = false
    }
  }, [open, classId])

  const suggestedCount = useMemo(
    () => Math.max(1, Math.ceil(students.length / Math.max(1, limit))),
    [students.length, limit],
  )

  function goToArrange() {
    setError(null)
    if (!classId) return setError('Pick which class these groups belong to.')
    if (!name.trim()) return setError('Give this set a name, like "Capstone groups".')

    const count = mode === 'manual' ? Math.max(1, suggestedCount) : suggestedCount
    setGroupCount(count)
    setDrafts(
      mode === 'manual'
        ? Array.from({ length: count }, (_, i) => ({
            name: `Group ${i + 1}`,
            member_limit: limit,
            students: [],
          }))
        : [],
    )
    setStep('arrange')
  }

  function shuffle() {
    const buckets = shuffleIntoGroups(students, groupCount)
    setDrafts(
      buckets.map((bucket, i) => ({
        name: `Group ${i + 1}`,
        member_limit: limit,
        students: bucket.map((s) => s.id),
      })),
    )
  }

  async function create() {
    setError(null)
    setBusy(true)
    try {
      const set = await createSet({ classId, name, mode, defaultLimit: limit })

      const payload: Draft[] =
        mode === 'student_formed'
          ? Array.from({ length: groupCount }, (_, i) => ({
              name: `Group ${i + 1}`,
              member_limit: limit,
              students: [],
            }))
          : drafts

      const result = await saveArrangement(set.id, payload)
      if (result.result !== 'saved') {
        throw new Error('The groups could not be saved. Try again.')
      }

      show(`${name.trim()} created with ${payload.length} groups`)
      onClose()
      await onCreated()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that set.'))
    } finally {
      setBusy(false)
    }
  }

  const canCreate =
    step === 'arrange' &&
    (mode === 'student_formed' || (drafts.length > 0 && drafts.some((d) => d.students.length > 0)))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'setup' ? 'New group set' : `Arrange ${name || 'groups'}`}
      description={
        step === 'setup'
          ? 'A set holds one arrangement of a class into groups.'
          : GROUPING_MODES.find((m) => m.value === mode)?.blurb
      }
      size="lg"
      footer={
        step === 'setup' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={goToArrange} className="!rounded-xl">
              Next
              <Icon name="arrowRight" size={16} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('setup')} disabled={busy}>
              Back
            </Button>
            <Button onClick={create} loading={busy} disabled={!canCreate} className="!rounded-xl">
              Create groups
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {step === 'setup' ? (
        <div className="space-y-4">
          {!fixedClassId && (
            <Field label="Class">
              {(id) => (
                <Select
                  id={id}
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  placeholder="Pick a class"
                  options={classes.map((c) => ({
                    value: c.id,
                    label: `${c.initial} · ${c.name} (${c.section})`,
                  }))}
                />
              )}
            </Field>
          )}

          <Field label="Set name">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Capstone groups"
              />
            )}
          </Field>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink">How to group</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {GROUPING_MODES.map((m) => {
                const active = mode === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(m.value)}
                    className={`rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
                      active
                        ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                        : 'surface border-[var(--line)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    <span
                      className={`flex items-center gap-2 text-[14px] font-semibold ${
                        active ? 'text-navy-700 dark:text-navy-100' : 'text-ink'
                      }`}
                    >
                      <Icon name={m.icon} size={16} />
                      {m.label}
                    </span>
                    <span className="mt-1.5 block text-[12px] leading-snug text-muted">
                      {m.blurb}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Field label="Members per group" hint={<span className="text-[12px] text-faint">Editable later</span>}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            )}
          </Field>

          {classId && (
            <p className="text-[13px] text-muted">
              {students.length} student{students.length === 1 ? '' : 's'} in this class.
            </p>
          )}
        </div>
      ) : mode === 'manual' ? (
        <ManualBuilder students={students} drafts={drafts} onChange={setDrafts} />
      ) : mode === 'random' ? (
        <RandomPreview
          students={students}
          groupCount={groupCount}
          limit={limit}
          drafts={drafts}
          onCountChange={setGroupCount}
          onLimitChange={setLimit}
          onShuffle={shuffle}
        />
      ) : (
        <div className="space-y-4">
          <Field label="How many groups to publish">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={groupCount}
                onChange={(e) => setGroupCount(Math.max(1, Number(e.target.value) || 1))}
              />
            )}
          </Field>
          <p className="text-[13px] leading-relaxed text-muted">
            {groupCount} empty groups of {limit} will be published as Group 1 to Group{' '}
            {groupCount}. Students pick their own, and can move while the set stays open. Close
            the set when you're happy with the arrangement.
          </p>
          {groupCount * limit < students.length && (
            <Alert tone="error">
              {groupCount} groups of {limit} holds {groupCount * limit}, but the class has{' '}
              {students.length} students. Some will have nowhere to go.
            </Alert>
          )}
        </div>
      )}
    </Modal>
  )
}
