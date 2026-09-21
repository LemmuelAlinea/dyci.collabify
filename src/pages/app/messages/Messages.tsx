import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../../components/app/Avatar'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ConversationList } from '../../../components/messages/ConversationList'
import { MessageThread } from '../../../components/messages/MessageThread'
import { NewDirectDialog } from '../../../components/messages/NewDirectDialog'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useConversations } from '../../../hooks/useConversations'
import { useLive } from '../../../hooks/useLive'
import { listMyInvitations, respondToInvitation } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import type { MyInvitation } from '../../../lib/general/types'
import { fullName } from '../../../lib/types'
import { useToast } from '../../../components/ui/Toast'

export default function Messages({ role }: { role: 'professor' | 'student' | 'general' }) {
  const { conversationId } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()
  const base =
    role === 'professor'
      ? '/professor/messages'
      : role === 'general'
        ? '/general/messages'
        : '/student/messages'

  const { conversations, error, reload } = useConversations(
    profile?.id,
    role === 'general' ? 'general' : 'education',
  )
  const [newOpen, setNewOpen] = useState(false)
  const [invitations, setInvitations] = useState<MyInvitation[]>([])
  const [invitationError, setInvitationError] = useState<string | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Messages · Collabify'
  }, [])

  const loadInvitations = useCallback(async () => {
    if (!profile || role !== 'general') {
      setInvitations([])
      setInvitationError(null)
      return
    }
    try {
      setInvitations(await listMyInvitations(profile.id))
      setInvitationError(null)
    } catch (err) {
      setInvitationError(authErrorMessage(err, 'Could not load your invitations.'))
    }
  }, [profile, role])

  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])

  useLive(loadInvitations, ['general_invitations'], { enabled: role === 'general' })

  async function answer(inv: MyInvitation, accept: boolean) {
    setAnswering(inv.id)
    try {
      await respondToInvitation(inv.id, accept)
      show(accept ? `You joined ${inv.project?.name ?? 'the project'}` : 'Invitation declined')
      await loadInvitations()
      await reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  const active = conversations?.find((c) => c.id === conversationId)
  const unread =
    conversations?.reduce((total, conversation) => total + conversation.unread_count, 0) ?? 0
  const channels =
    conversations?.filter((conversation) => conversation.kind !== 'direct').length ?? 0
  const direct =
    conversations?.filter((conversation) => conversation.kind === 'direct').length ?? 0

  if (!profile) return null

  return (
    <div className="w-full space-y-5">
      <DirectoryHero
        title="Every conversation,"
        accent="within reach."
        description={
          role === 'general'
            ? 'Keep project chats and direct messages together without losing the work around them.'
            : 'Keep class updates, group decisions and direct messages together without losing the work around them.'
        }
        stats={role === 'general' ? [] : [
          { value: conversations?.length ?? '—', label: 'Conversations' },
          { value: unread, label: 'Unread' },
          { value: channels, label: 'Class & group chats' },
          { value: direct, label: 'Direct chats' },
        ]}
        statsVariant="compact-row"
        action={
          role === 'professor' ? (
            <Button
              variant="onNavy"
              onClick={() => setNewOpen(true)}
              className="!border-amber-50/20 !bg-amber-50/10 !text-amber-50 hover:!bg-amber-50/16"
            >
              <Icon name="plus" size={17} />
              New message
            </Button>
          ) : undefined
        }
      />

      {role === 'general' && invitationError && <Alert tone="error">{invitationError}</Alert>}

      {role === 'general' && invitations.length > 0 && (
        <section className="overflow-hidden rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
          <header className="flex items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
            <div>
              <h2>Project invitations</h2>
              <p className="mt-0.5 text-[12px] text-muted">General projects waiting for your answer.</p>
            </div>
            <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
              {invitations.length}
            </span>
          </header>
          <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                {inv.inviter && <Avatar profile={inv.inviter} size={34} />}
                <div className="min-w-[14rem] flex-1">
                  <p className="text-[14px] font-medium text-ink">{inv.project?.name ?? 'A project'}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {inv.inviter ? `${fullName(inv.inviter)} invited you` : 'You were invited'}
                    {inv.project?.description ? ` · ${inv.project.description.slice(0, 90)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={answering === inv.id}
                    onClick={() => void answer(inv, false)}
                  >
                    Decline
                  </Button>
                  <Button size="sm" loading={answering === inv.id} onClick={() => void answer(inv, true)}>
                    <Icon name="check" size={14} />
                    Join
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="surface flex h-[clamp(480px,calc(100dvh-458px),760px)] min-h-0 overflow-hidden rounded-panel border border-line">
        <aside
          className={`w-full shrink-0 border-line md:block md:w-[320px] md:border-r xl:w-[360px] ${
            conversationId ? 'hidden' : 'block'
          }`}
        >
          {conversations === null ? (
            <div className="flex items-center gap-3 px-4 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Loading…
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              activeId={conversationId}
              linkBase={base}
            />
          )}
        </aside>

        <section className={`min-w-0 flex-1 ${conversationId ? 'block' : 'hidden md:block'}`}>
          {error ? (
            <div className="p-6">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : !conversationId ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-navy-600 dark:bg-navy-500/20 dark:text-navy-200">
                  <Icon name="message" size={24} />
                </span>
                <h2 className="mt-5">Choose a conversation</h2>
                <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
                  {role === 'general'
                    ? "Every project you're on has its own chat, created for you automatically."
                    : "Every class and group you're in has its own chat, created for you automatically."}
                </p>
              </div>
            </div>
          ) : conversations && !active ? (
            <div className="p-6">
              <Alert tone="error">
                {role === 'general'
                  ? 'That conversation is not available. The project it belongs to may have been archived, or you may have been removed from it.'
                  : 'That conversation is not available. You may have been removed from the class or group it belongs to.'}
              </Alert>
            </div>
          ) : active ? (
            <MessageThread
              conversation={active}
              viewerId={profile.id}
              canModerate={role === 'professor'}
              backTo={base}
            />
          ) : (
            <div className="flex items-center gap-3 p-6 text-[14px] text-muted">
              <Spinner size={16} />
              Loading…
            </div>
          )}
        </section>
      </div>

      {role === 'professor' && (
        <NewDirectDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          professorId={profile.id}
          onStarted={async (id) => {
            await reload()
            navigate(`${base}/${id}`)
          }}
        />
      )}
    </div>
  )
}
