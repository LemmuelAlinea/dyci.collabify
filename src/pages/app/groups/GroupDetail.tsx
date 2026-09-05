import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../../components/app/Avatar'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Field, Input } from '../../../components/ui/Field'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useToast } from '../../../components/ui/Toast'
import { GroupWork } from '../../../components/groups/GroupWork'
import { groupMemberLoad } from '../../../lib/api/groupWork'
import type { GroupMemberLoad } from '../../../lib/api/groupWork'
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

/** Finished over held, across every project this group has. */
function MemberLoadBar({ load }: { load?: GroupMemberLoad }) {
  if (!load || load.task_count === 0) {
    return <p className="mt-1 text-[12px] text-faint">No tasks claimed yet</p>
  }
  const pct = load.personal_pct ?? 0
  return (
    <div className="mt-1.5 flex items-center gap-3">
      <span className="h-1.5 max-w-[220px] flex-1 overflow-hidden rounded-full surface-sunken">
        <span
          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="shrink-0 font-mono text-[12px] text-muted">
        {load.done_count}/{load.task_count}
      </span>
      <span className="shrink-0 font-mono text-[12px] text-ink">{pct}%</span>
    </div>
  )
}

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
  const [load_, setLoad] = useState(new Map<string, GroupMemberLoad>())
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

  useLive(load, ['groups', 'group_members', 'project_boards', 'project_tasks', 'task_assignees'])

  // How far each member has got across every project this group has.
  useEffect(() => {
    if (!groupId) return
    void groupMemberLoad(groupId)
      .then(setLoad)
      .catch(() => setLoad(new Map()))
  }, [groupId])

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
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
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
    <div className="mx-auto w-full max-w-[1280px]">
      <Link
        to={base}
        className="inline-flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All groups
      </Link>

      <header className="relative mt-4 overflow-hidden rounded-panel border border-amber-50/10 bg-navy-950 px-5 py-6 text-amber-50 sm:px-7 sm:py-8 lg:px-9">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 -right-40 h-[420px] w-[420px] rounded-full bg-amber-400/10 blur-[115px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
            backgroundSize: '54px 54px',
            maskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
          }}
        />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-50/8 px-2.5 py-1 text-[11px] font-medium text-amber-50/65 ring-1 ring-amber-50/10">
                {group.set_name}
              </span>
              {group.set_closed_at ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-amber-50/70">
                  <Icon name="lock" size={11} />
                  Final
                </span>
              ) : (
                <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                  Open
                </span>
              )}
            </div>

            {canManage && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="onNavy"
                  size="sm"
                  className="!h-8 !rounded-lg !px-3"
                  onClick={() => setLimitOpen(true)}
                >
                  Member limit
                </Button>
                <button
                  type="button"
                  onClick={() => setDeletePrompt(true)}
                  aria-label="Delete group"
                  className="grid h-8 w-8 place-items-center rounded-lg text-amber-50/55 transition-colors hover:bg-red-500/15 hover:text-red-200"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.65fr)] lg:items-end">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-amber-50/8 text-amber-300 ring-1 ring-amber-50/12 sm:h-16 sm:w-16">
                <Icon name="users" size={23} />
              </span>

              <div className="min-w-0 flex-1">
                {renaming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="!h-10 max-w-[280px]"
                      aria-label="Group name"
                    />
                    <Button size="sm" loading={busy} onClick={saveName} className="!h-10 !rounded-lg">
                      Save
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(false)
                        setDraftName(group.name)
                      }}
                      className="h-10 rounded-lg px-3 text-[13px] text-amber-50/60 transition-colors hover:bg-white/8 hover:text-amber-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="text-balance text-amber-50">{group.name}</h1>
                    {canRename && (
                      <button
                        type="button"
                        onClick={() => setRenaming(true)}
                        aria-label="Rename group"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-amber-50/45 transition-colors hover:bg-white/8 hover:text-amber-200"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </div>
                )}

                <p className="mt-2 text-[13px] text-amber-50/55">
                  {cls ? `${cls.initial} · ${cls.name}` : ''}
                </p>
                <p className="mt-3 max-w-[58ch] text-[13px] leading-relaxed text-amber-50/55">
                  Keep the group roster, assigned projects and individual task progress together.
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-amber-50/12 bg-amber-50/12">
              <div className="bg-navy-950/85 px-4 py-3.5">
                <dt className="text-[11px] text-amber-50/45">Members</dt>
                <dd className="mt-1.5 font-mono text-[18px] font-bold text-amber-50">
                  {group.member_count} / {group.member_limit}
                </dd>
              </div>
              <div className="bg-navy-950/85 px-4 py-3.5">
                <dt className="text-[11px] text-amber-50/45">Formation</dt>
                <dd className="mt-1.5 truncate text-[13px] font-medium text-amber-50">
                  {modeLabel(group.set_mode)}
                </dd>
              </div>
            </dl>
          </div>

          {studentFormedOpen && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-amber-50/10 pt-4">
              <p className="text-[12px] text-amber-50/50">
                {isMember ? 'You currently belong to this group.' : 'This group is accepting members.'}
              </p>
              {isMember ? (
                <Button
                  variant="onNavy"
                  size="sm"
                  className="!h-8 !rounded-lg"
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
                  variant="accent"
                  size="sm"
                  className="!h-8 !rounded-lg"
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
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,0.75fr)] xl:items-start">
        <section className="overflow-hidden rounded-panel border border-line surface shadow-card">
          <div className="border-b border-line surface-sunken px-5 py-4">
            <h2>Projects and tasks</h2>
            <p className="mt-1 text-[12px] text-faint">Everything assigned to this group.</p>
          </div>
          <div className="p-4 sm:p-5">
            <GroupWork groupId={group.id} role={role} viewerId={profile?.id} />
          </div>
        </section>

        <section className="overflow-hidden rounded-panel border border-line surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line surface-sunken px-5 py-4">
            <div>
              <h2>Members</h2>
              <p className="mt-1 text-[12px] text-faint">
                {members.length} of {group.member_limit} places filled
              </p>
            </div>
            {canManage && unplaced.length > 0 && (
              <div className="w-full sm:w-[240px] xl:w-full 2xl:w-[240px]">
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
                  className="!h-9 text-[12px]"
                />
              </div>
            )}
          </div>

          {members.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon="users"
                title="Nobody in this group yet"
                body={
                  canManage
                    ? 'Add students from the class roster, or let them claim a slot if this is a student-formed set.'
                    : 'This group has no members yet.'
                }
              />
            </div>
          ) : (
            <ol className="divide-y divide-[var(--line)]">
              {members.map((m, i) => (
                <li key={m.student_id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Avatar profile={m.profile} size={38} />
                  <div className="min-w-[160px] flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">
                      {m.profile.last_name}, {m.profile.first_name}
                      {m.profile.middle_name ? ` ${m.profile.middle_name[0]}.` : ''}
                      {m.student_id === profile?.id && (
                        <span className="ml-1.5 text-[12px] text-faint">you</span>
                      )}
                    </p>
                    <MemberLoadBar load={load_.get(m.student_id)} />
                  </div>

                  {canManage && (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
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
                          className="!h-9 !w-[132px] text-[12px]"
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
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
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
      </div>

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
          <label className="flex items-start gap-3 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="mt-1 h-4 w-4 accent-navy-600"
            />
            <span>
              Apply to every group in {group.set_name}
              <span className="block text-[12px] text-muted">
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
