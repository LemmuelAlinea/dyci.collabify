import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { JoinSpaceDialog, NewSpaceDialog } from '../../components/general/SpaceDialogs'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { rememberSpace } from '../../hooks/useSpaces'
import { respondToSpaceInvitation } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { levelLabel } from '../../lib/general/permissions'
import type { GeneralSpaceSummary, MySpaceInvitation } from '../../lib/general/types'

/**
 * Every space you are in.
 *
 * A space holds projects, and everyone in a space can see every project in it.
 * That is the whole reason this page exists rather than one long list: work for
 * one group stays with that group.
 */
export default function SpacePicker() {
  const { show } = useToast()
  const { spaces, invitations, error, reload } = useGeneralNavigation()
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [answering, setAnswering] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Spaces · Collabify'
  }, [])

  async function answer(inv: MySpaceInvitation, accept: boolean) {
    setAnswering(inv.invitation_id)
    try {
      await respondToSpaceInvitation(inv.invitation_id, accept)
      show(accept ? `You joined ${inv.space_name}` : 'Invitation declined')
      await reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  const mine = (spaces ?? []).filter((s) => s.my_level)
  const live = mine.filter((s) => !s.archived_at)

  return (
    <div className="w-full">
      <DirectoryHero
        title="Your spaces"
        accent="and the work inside them."
        description="A space holds projects. Everyone in a space can see every project in it, so keep separate work in separate spaces."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={17} />
              Create space
            </Button>
            <Button variant="onNavy" onClick={() => setJoinOpen(true)}>
              Join with a code
            </Button>
          </div>
        }
        stats={[
          { value: spaces === null ? '—' : live.length, label: 'Spaces' },
          { value: invitations.length, label: 'Invitations' },
        ]}
      />

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {invitations.length > 0 && (
          <section className="overflow-hidden rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
            <header className="flex items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
              <div>
                <h2>Invitations</h2>
                <p className="mt-0.5 text-[12px] text-muted">Spaces waiting for your answer.</p>
              </div>
              <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
                {invitations.length}
              </span>
            </header>
            <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
              {invitations.map((inv) => (
                <li
                  key={inv.invitation_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5"
                >
                  {inv.inviter_id && (
                    <Avatar
                      profile={{
                        first_name: inv.inviter_first_name ?? '',
                        last_name: inv.inviter_last_name ?? '',
                        avatar_url: inv.inviter_avatar_url,
                      }}
                      size={34}
                    />
                  )}
                  <div className="min-w-[14rem] flex-1">
                    <p className="font-medium">{inv.space_name}</p>
                    <p className="text-[12px] text-muted">
                      {inv.inviter_first_name
                        ? `${inv.inviter_first_name} ${inv.inviter_last_name ?? ''} invited you`
                        : 'You were invited'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      loading={answering === inv.invitation_id}
                      onClick={() => void answer(inv, true)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={answering === inv.invitation_id}
                      onClick={() => void answer(inv, false)}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {spaces === null ? (
          <div className="grid place-items-center py-16">
            <Spinner size={26} />
          </div>
        ) : mine.length === 0 ? (
          <EmptyState
            icon="folder"
            title="No spaces yet"
            body="Create one to hold your projects, or join a space somebody else has opened with a code."
            action={
              <Button variant="accent" onClick={() => setNewOpen(true)}>
                Create space
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mine.map((s) => (
              <SpaceCard key={s.id} space={s} />
            ))}
          </div>
        )}
      </div>

      <NewSpaceDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={reload} />
      <JoinSpaceDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={reload} />
    </div>
  )
}
function SpaceCard({ space: s }: { space: GeneralSpaceSummary }) {
  return (
    <Link
      to={`/general/spaces/${s.id}`}
      onClick={() => rememberSpace(s.id)}
      className="group flex flex-col rounded-card border border-line bg-[var(--surface)] p-4 transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 leading-snug group-hover:underline">{s.name}</h3>
        {s.archived_at && (
          <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
            Archived
          </span>
        )}
      </div>
      {s.description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{s.description}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="kanban" size={14} />
          {s.project_count} {s.project_count === 1 ? 'project' : 'projects'}
        </span>
        <span className="text-faint">·</span>
        <span className="flex items-center gap-1.5">
          <Icon name="users" size={14} />
          {s.member_count}
        </span>
        <span className="text-faint">·</span>
        <span>You are {levelLabel(s.my_level)}</span>
      </div>
    </Link>
  )
}
