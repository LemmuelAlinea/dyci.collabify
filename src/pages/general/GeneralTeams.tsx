import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Input } from '../../components/ui/Field'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Select, Textarea } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useLive } from '../../hooks/useLive'
import { isFaculty } from '../../lib/access'
import {
  addSpaceTeamMember,
  archiveSpaceTeam,
  createSpaceTeam,
  deleteSpaceTeam,
  listSpaceTeamMembers,
  listSpaceTeams,
  removeSpaceTeamMember,
  updateSpaceTeam,
} from '../../lib/api/general'
import { listSpaceMembers } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { levelLabel } from '../../lib/general/permissions'
import type { GeneralSpaceTeam, GeneralSpaceTeamMember, SpacePerson } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { fullName } from '../../lib/types'

export default function GeneralTeams() {
  const { spaceId: routeSpaceId } = useParams<{ spaceId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const location = useLocation()
  const { spaces, currentSpace, currentSpaceId, error: navigationError, reload } = useGeneralNavigation()
  const spaceId = routeSpaceId ?? currentSpaceId
  const space = routeSpaceId
    ? spaces?.find((s) => s.id === routeSpaceId && s.my_level) ?? null
    : currentSpace

  const [teams, setTeams] = useState<GeneralSpaceTeam[] | null>(null)
  const [teamMembers, setTeamMembers] = useState<GeneralSpaceTeamMember[]>([])
  const [spaceMembers, setSpaceMembers] = useState<SpacePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<GeneralSpaceTeam | null>(null)
  const [archiving, setArchiving] = useState<GeneralSpaceTeam | null>(null)
  const [deleting, setDeleting] = useState<GeneralSpaceTeam | null>(null)
  const [adding, setAdding] = useState<Record<string, string>>({})

  const archived = Boolean(space?.archived_at)
  const archivePage = location.pathname.endsWith('/archive')

  const load = useCallback(async () => {
    if (!spaceId) return
    try {
      const [nextTeams, nextTeamMembers, nextSpaceMembers] = await Promise.all([
        listSpaceTeams(spaceId, archivePage),
        listSpaceTeamMembers(spaceId),
        listSpaceMembers(spaceId),
      ])
      setTeams(nextTeams)
      setTeamMembers(nextTeamMembers)
      setSpaceMembers(nextSpaceMembers)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load teams.'))
      setTeams((prev) => prev ?? [])
    }
  }, [archivePage, spaceId])

  useEffect(() => {
    document.title = space
      ? `${archivePage ? 'Archived teams' : 'Teams'} · ${space.name} · Collabify`
      : 'General teams · Collabify'
  }, [archivePage, space])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_space_teams', 'general_space_team_members', 'general_space_members', 'general_teams'])

  const activeTeams = teams ?? []
  const memberById = useMemo(
    () => new Map(spaceMembers.map((member) => [member.user_id, member] as const)),
    [spaceMembers],
  )

  async function addMember(team: GeneralSpaceTeam) {
    const userId = adding[team.id]
    if (!userId) return
    try {
      await addSpaceTeamMember(team.id, userId)
      show('Member added')
      setAdding((prev) => ({ ...prev, [team.id]: '' }))
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not add that member.'), 'error')
    }
  }

  async function removeMember(team: GeneralSpaceTeam, member: GeneralSpaceTeamMember) {
    try {
      await removeSpaceTeamMember(team.id, member.user_id)
      show('Member removed')
      await load()
      await reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not remove that member.'), 'error')
    }
  }

  if (routeSpaceId && spaces !== null && !space) return <Navigate to="/general/spaces" replace />

  const pageError = navigationError ?? error

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Space"
        accent="teams."
        description="Reusable teams live inside the current Space. Use one when creating a project to bring the same people in together."
        stats={[]}
        statsVariant="compact-row"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{space?.name ?? 'Current Space'}</p>
          <h1 className="mt-1 font-display">{archivePage ? 'Archived teams' : 'Teams'}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {spaceId && (
            <Link
              to={`/general/spaces/${spaceId}`}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
            >
              <Icon name="board" size={15} />
              Back to space
            </Link>
          )}
          {spaceId && (
            <Link
              to={archivePage ? `/general/spaces/${spaceId}/teams` : `/general/spaces/${spaceId}/teams/archive`}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
            >
              <Icon name={archivePage ? 'users' : 'archive'} size={15} />
              {archivePage ? 'Active teams' : 'Archived teams'}
            </Link>
          )}
          {!archivePage && !archived && spaceId && isFaculty(profile) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={15} />
              Create team
            </Button>
          )}
        </div>
      </div>

      {pageError && <Alert tone="error">{pageError}</Alert>}
      {archived && <Alert tone="info">This Space is archived, so its teams are read-only.</Alert>}

      {!spaceId && spaces !== null ? (
        <EmptyState icon="users" title="Choose a Space" body="Teams appear after you choose a General Space." />
      ) : teams === null ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading teams…
        </div>
      ) : activeTeams.length === 0 ? (
        <EmptyState
          icon="users"
          title="No teams yet"
          body={
            isFaculty(profile)
              ? 'Create a team here, then reuse it when creating projects in this Space.'
              : 'Teams a faculty member makes in this Space show up here.'
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {activeTeams.map((team) => {
            const members = teamMembers.filter((member) => member.team_id === team.id)
            const memberIds = new Set(members.map((member) => member.user_id))
            const options = spaceMembers
              .filter((member) => !memberIds.has(member.user_id))
              .map((member) => ({ value: member.user_id, label: fullName(member) }))
            const canManage = !archived && (team.my_level === 'owner' || team.my_level === 'manager')
            return (
              <section key={team.id} className="overflow-hidden rounded-panel border border-line surface">
                <header className="border-b border-line px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[16px]">{team.name}</h2>
                      {team.description && (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted">{team.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                      {levelLabel(team.my_level)}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] text-faint">
                    {team.member_count} {team.member_count === 1 ? 'member' : 'members'} · {team.project_count}{' '}
                    {team.project_count === 1 ? 'project' : 'projects'}
                  </p>
                  {canManage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!archivePage && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing(team)}>
                            <Icon name="edit" size={14} />
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setArchiving(team)}>
                            <Icon name="archive" size={14} />
                            Archive
                          </Button>
                        </>
                      )}
                      {archivePage && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await archiveSpaceTeam(team.id, false)
                              show('Team restored')
                              await load()
                            } catch (err) {
                              show(authErrorMessage(err, 'Could not restore that team.'), 'error')
                            }
                          }}
                        >
                          Restore
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(team)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </header>

                <ul className="divide-y divide-line">
                  {members.map((member) => {
                    const person = memberById.get(member.user_id)
                    return (
                      <li key={member.user_id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                        <Avatar
                          profile={{
                            first_name: member.first_name,
                            last_name: member.last_name,
                            avatar_url: member.avatar_url,
                          }}
                          size={32}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] text-ink">{fullName(member)}</p>
                          <p className="text-[12px] text-faint">{levelLabel(member.level)}</p>
                        </div>
                        {!archivePage && canManage && person?.user_id !== profile?.id && (
                          <Button size="sm" variant="ghost" onClick={() => void removeMember(team, member)}>
                            Remove
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>

                {!archivePage && canManage && options.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:px-5">
                    <Select
                      value={adding[team.id] ?? ''}
                      onChange={(e) => setAdding((prev) => ({ ...prev, [team.id]: e.target.value }))}
                      placeholder="Add a Space member"
                      options={options}
                      className="!h-10 !text-[13px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!adding[team.id]}
                      onClick={() => void addMember(team)}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {spaceId && (
        <CreateTeamDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          spaceId={spaceId}
          members={spaceMembers}
          onDone={async () => {
            await load()
            await reload()
          }}
        />
      )}

      <EditTeamDialog
        team={editing}
        onClose={() => setEditing(null)}
        onDone={async () => {
          await load()
          await reload()
        }}
      />

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title="Archive team"
        body={
          <>
            <p>
              Archive <strong>{archiving?.name}</strong>? It will move to the archived teams page
              and will no longer appear when creating projects.
            </p>
          </>
        }
        confirmLabel="Archive team"
        onConfirm={async () => {
          if (!archiving) return
          await archiveSpaceTeam(archiving.id, true)
          show('Team archived')
          await load()
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete team"
        body={
          <>
            <p>
              Delete <strong>{deleting?.name}</strong>? This removes the reusable Space team.
              Existing projects keep their project teams, but they will no longer be linked to it.
            </p>
          </>
        }
        confirmLabel="Delete team"
        onConfirm={async () => {
          if (!deleting) return
          await deleteSpaceTeam(deleting.id)
          show('Team deleted')
          await load()
          await reload()
        }}
      />
    </div>
  )
}

function CreateTeamDialog({
  open,
  onClose,
  spaceId,
  members,
  onDone,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  members: SpacePerson[]
  onDone: () => Promise<void>
}) {
  const { profile } = useAuth()
  const { show } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(userId: string, checked: boolean) {
    setMemberIds((current) =>
      checked ? [...current, userId] : current.filter((id) => id !== userId),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Give the team a name.')
    setBusy(true)
    try {
      await createSpaceTeam({ spaceId, name, description, memberIds })
      show('Team created')
      setName('')
      setDescription('')
      setMemberIds([])
      onClose()
      await onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that team.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create team"
      description="This team can be reused only inside this Space."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-general-space-team" loading={busy}>
            Create team
          </Button>
        </>
      }
    >
      <form id="new-general-space-team" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={LIMIT.generalName}
              placeholder="Design team"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={500}
              placeholder="What this team usually handles."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink">Members</p>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {members
              .filter((member) => member.user_id !== profile?.id)
              .map((member) => (
                <label
                  key={member.user_id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-[var(--surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    checked={memberIds.includes(member.user_id)}
                    onChange={(e) => toggle(member.user_id, e.target.checked)}
                  />
                  <Avatar
                    profile={{
                      first_name: member.first_name,
                      last_name: member.last_name,
                      avatar_url: member.avatar_url,
                    }}
                    size={28}
                  />
                  <span className="min-w-0 flex-1 truncate">{fullName(member)}</span>
                </label>
              ))}
            {members.filter((member) => member.user_id !== profile?.id).length === 0 && (
              <p className="px-2 py-3 text-[13px] text-muted">
                Invite more people to this Space before adding them to a team.
              </p>
            )}
          </div>
          <p className="mt-1 text-[12px] text-faint">You are added as the team Owner.</p>
        </div>
      </form>
    </Modal>
  )
}

function EditTeamDialog({
  team,
  onClose,
  onDone,
}: {
  team: GeneralSpaceTeam | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!team) return
    setName(team.name)
    setDescription(team.description)
    setError(null)
  }, [team])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!team) return
    setError(null)
    if (!name.trim()) return setError('Give the team a name.')
    setBusy(true)
    try {
      await updateSpaceTeam(team.id, name, description)
      show('Team updated')
      onClose()
      await onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not update that team.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(team)}
      onClose={busy ? () => {} : onClose}
      title="Edit team"
      description="Update this reusable Space team."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="edit-general-space-team" loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-general-space-team" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={LIMIT.generalName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
