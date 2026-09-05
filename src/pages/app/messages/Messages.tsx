import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ConversationList } from '../../../components/messages/ConversationList'
import { MessageThread } from '../../../components/messages/MessageThread'
import { NewDirectDialog } from '../../../components/messages/NewDirectDialog'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useConversations } from '../../../hooks/useConversations'

export default function Messages({ role }: { role: 'professor' | 'student' }) {
  const { conversationId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const base = role === 'professor' ? '/professor/messages' : '/student/messages'

  const { conversations, error, reload } = useConversations(profile?.id)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    document.title = 'Messages · Collabify'
  }, [])

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
        description="Keep class updates, group decisions and direct messages together without losing the work around them."
        stats={[
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
                  Every class and group you're in has its own chat, created for you
                  automatically.
                </p>
              </div>
            </div>
          ) : conversations && !active ? (
            <div className="p-6">
              <Alert tone="error">
                That conversation is not available. You may have been removed from the class or
                group it belongs to.
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
