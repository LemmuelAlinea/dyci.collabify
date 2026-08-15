import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../../components/app/Avatar'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert, Field, Input } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { CapacityPill } from '../../../components/groups/GroupCard'
import { useAuth } from '../../../context/AuthContext'
import { getClass, listMembers } from '../../../lib/api/classes'
import {
  deleteGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroupMembers,
  listGroups,
  placeStudent,
  removeFromGroup,
  renameGroup,
  setGroupLimit,
  setLimitForSet,
  JOIN_GROUP_MESSAGE,
} from '../../../lib/api/groups'
import { authErrorMessage } from '../../../lib/authError'
import { fullName, modeLabel } from '../../../lib/types'
import type { ClassMember, ClassSummary, GroupMember, GroupSummary } from '../../../lib/types'

export default function GroupDetail({ role }: { role: 'professor' | 'student' }) {
  const { groupId = '' } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const base = role === 'professor' ? '/professor/groups' : '/student/groups'

  const [group, setGroup] = useState<GroupSummary | null>(null)
  const [siblings, setSiblings] = useState<GroupSummary[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [setMembersAll, setSetMembersAll] = useState<GroupMember[]>([])
  const [cls, setCls] = useState<ClassSummary | null>(null)
  const [roster, setRoster] = useState<ClassMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [limitOpen, setLimitOpen] = useState(false)
  const [draftLimit, setDraftLimit] = useState(5)
  const [applyAll, setApplyAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deletePrompt, setDeletePrompt] = useState(false)

  const canManage = role === 'professor' && !group?.set_closed_at
  const isMember = members.some((m) => m.student_id === profile?.id)
  const canRename = Boolean(group && !group.set_closed_at && (role === 'professor' || isMember))
  const studentFormedOpen =
    group?.set_mode === 'student_formed' && !group.set_closed_at && role === 'student'

  const load = useCallback(async () => {
    if (!groupId) return
    try {
      const g = await getGroup(groupId)
      if (!g) {
        setError('That group no longer exists, or you do not have access to it.')
        return
      }
      const [sibs, mine, classRow] = await Promise.all([
        listGroups([g.set_id]),
        listGroupMembers([g.id]),
        getClass(g.class_id),
      ])
      const everyone = await listGroupMembers(sibs.map((s) => s.id))
      setGroup(g)
      setSiblings(sibs)
      setMembers(mine)
      setSetMembersAll(everyone)
      setCls(classRow)
      setDraftName(g.name)
      setDraftLimit(g.member_limit)
      setError(null)

      if (role === 'professor') {
        setRoster(await listMembers(g.class_id))
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that group.'))
    } finally {
      setLoading(false)
    }
  }, [groupId, role])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (group) document.title = `${group.name} · Collabify`
  }, [group])

  /** Class members with no group anywhere in this set. */
  const unplaced = useMemo(() => {
    const taken = new Set(setMembersAll.map((m) => m.student_id))
    return roster.filter((r) => !taken.has(r.student_id))
  }, [roster, setMembersAll])

  async function saveName() {
    if (!group || !draftName.trim()) return
    setBusy(true)
    try {
      await renameGroup(group.id, draftName)
      setRenaming(false)
      show('Group renamed')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not rename the group.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveLimit() {
    if (!group) return
    setBusy(true)
    try {
      if (applyAll) {
        await setLimitForSet(group.set_id, draftLimit)
        show(`Every group in ${group.set_name} now holds ${draftLimit}`)
      } else {
        await setGroupLimit(group.id, draftLimit)
        show(`${group.name} now holds ${draftLimit}`)
      }
      setLimitOpen(false)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the limit.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
        <Spinner size={16} />
        Loading group…
      </div>
    )
  }

  if (!group) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error">{error ?? 'That group could not be loaded.'}</Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <Link
        to={base}
        className="inline-flex items-center gap-1.5 text-[13.5px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All groups
      </Link>

      <header className="surface mt-4 rounded-panel border border-line p-6 shadow-card md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {renaming ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="!h-11 max-w-[280px]"
                  aria-label="Group name"
                />
                <Button size="sm" loading={busy} onClick={saveName} className="!rounded-lg">
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenaming(false)
                    setDraftName(group.name)
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-[clamp(1.5rem,3vw,2rem)] leading-tight">{group.name}</h1>
                {canRename && (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    aria-label="Rename group"
                    className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="edit" size={15} />
                  </button>
                )}
              </div>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13.5px] text-muted">
              <span>{cls ? `${cls.initial} · ${cls.name}` : ''}</span>
              <span>·</span>
              <span>{group.set_name}</span>
              <span>·</span>
              <span>{modeLabel(group.set_mode)}</span>
              {group.set_closed_at && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-300">
                    <Icon name="lock" size={12} />
                    Final
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <CapacityPill count={group.member_count} limit={group.member_limit} />
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={() => setLimitOpen(true)}
                >
                  Limit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletePrompt(true)}
                  aria-label="Delete group"
                >
                  <Icon name="trash" size={15} />
                </Button>
              </>
            )}
          </div>
        </div>

        {studentFormedOpen && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
            {isMember ? (
              <Button
                variant="outline"
                size="sm"
                className="!rounded-lg"
                onClick={async () => {
                  const { result } = await leaveGroup(group.id)
                  if (result === 'left') {
                    show(`You left ${group.name}`)
                    await load()
                  } else {
                    show('You can no longer leave this group.', 'error')
                  }
                }}
              >
                Leave group
              </Button>
            ) : (
              <Button
                size="sm"
                className="!rounded-lg"
                disabled={group.member_count >= group.member_limit}
                onClick={async () => {
                  const { result } = await joinGroup(group.id)
                  if (result === 'joined' || result === 'already_here') {
                    show(`You joined ${group.name}`)
                    await load()
                  } else {
                    show(JOIN_GROUP_MESSAGE[result], 'error')
                  }
                }}
              >
                {group.member_count >= group.member_limit ? 'Group is full' : 'Join this group'}
              </Button>
            )}
          </div>
        )}
      </header>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[18px]">Members</h2>
          {canManage && unplaced.length > 0 && (
            <div className="w-full sm:w-[260px]">
              <Select
                aria-label="Add a student to this group"
                value=""
                disabled={group.member_count >= group.member_limit}
                onChange={async (e) => {
                  if (!e.target.value || !profile) return
                  try {
                    await placeStudent({
                      groupId: group.id,
                      setId: group.set_id,
                      studentId: e.target.value,
                      byProfessorId: profile.id,
                    })
                    show('Student added')
                    await load()
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not add that student.'), 'error')
                  }
                }}
                placeholder={
                  group.member_count >= group.member_limit
                    ? 'Group is full'
                    : `Add from ${unplaced.length} unplaced…`
                }
                options={unplaced.map((r) => ({
                  value: r.student_id,
                  label: `${r.profile.last_name}, ${r.profile.first_name}`,
                }))}
                className="!h-10 text-[13.5px]"
              />
            </div>
          )}
        </div>

        {members.length === 0 ? (
          <EmptyState
            icon="users"
            title="Nobody in this group yet"
            body={
              canManage
                ? 'Add students from the class roster above, or let them claim a slot if this is a student-formed set.'
                : 'This group has no members yet.'
            }
          />
        ) : (
          <ol className="surface divide-y divide-[var(--line)] rounded-card border border-line shadow-card">
            {members.map((m, i) => (
              <li key={m.student_id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-faint tabular-nums">
                  {i + 1}
                </span>
                <Avatar profile={m.profile} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">
                    {m.profile.last_name}, {m.profile.first_name}
                    {m.profile.middle_name ? ` ${m.profile.middle_name[0]}.` : ''}
                  </p>
                  {m.student_id === profile?.id && (
                    <p className="text-[12px] text-faint">You</p>
                  )}
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    {siblings.length > 1 && (
                      <Select
                        aria-label={`Move ${fullName(m.profile)} to another group`}
                        value=""
                        onChange={async (e) => {
                          if (!e.target.value || !profile) return
                          try {
                            await placeStudent({
                              groupId: e.target.value,
                              setId: group.set_id,
                              studentId: m.student_id,
                              byProfessorId: profile.id,
                            })
                            show(`${m.profile.first_name} moved`)
                            await load()
                          } catch (err) {
                            show(authErrorMessage(err, 'Could not move that student.'), 'error')
                          }
                        }}
                        placeholder="Move to…"
                        options={siblings
                          .filter((s) => s.id !== group.id)
                          .map((s) => ({
                            value: s.id,
                            label: `${s.name} (${s.member_count}/${s.member_limit})`,
                          }))}
                        className="!h-9 !w-[150px] text-[12.5px]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await removeFromGroup(group.id, m.student_id)
                          show(`${m.profile.first_name} removed from the group`)
                          await load()
                        } catch (err) {
                          show(authErrorMessage(err, 'Could not remove them.'), 'error')
                        }
                      }}
                      aria-label={`Remove ${fullName(m.profile)}`}
                      className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Modal
        open={limitOpen}
        onClose={() => setLimitOpen(false)}
        title="Members per group"
        description={`${group.set_name} · currently ${group.member_limit}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLimitOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveLimit} loading={busy} className="!rounded-xl">
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Limit">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={50}
                value={draftLimit}
                onChange={(e) => setDraftLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            )}
          </Field>
          <label className="flex items-start gap-2.5 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="mt-1 h-4 w-4 accent-navy-600"
            />
            <span>
              Apply to every group in {group.set_name}
              <span className="block text-[12.5px] text-muted">
                Leave this off to change only {group.name}.
              </span>
            </span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={deletePrompt}
        onClose={() => setDeletePrompt(false)}
        onConfirm={async () => {
          await deleteGroup(group.id)
          show(`${group.name} deleted`)
          navigate(base)
        }}
        title={`Delete ${group.name}?`}
        body="The group is removed and its members go back to being unplaced. Everything else in the set is untouched."
        confirmLabel="Delete group"
      />
    </div>
  )
}
