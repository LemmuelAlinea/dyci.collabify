import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ConversationList } from '../../../components/messages/ConversationList'
import { MessageThread } from '../../../components/messages/MessageThread'
import { NewDirectDialog } from '../../../components/messages/NewDirectDialog'
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

  if (!profile) return null

  return (
    <div className="w-full">
      {/* The shell already pads the page; messaging wants the full height. */}
      <div className="surface -mx-4 -my-7 flex h-[calc(100dvh-70px)] overflow-hidden border-y border-line md:-mx-7 md:-my-9 md:h-[calc(100dvh-70px)] lg:mx-0 lg:my-0 lg:h-[calc(100dvh-134px)] lg:rounded-panel lg:border">
        <aside
          className={`w-full shrink-0 border-line lg:block lg:w-[320px] lg:border-r ${
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
              action={
                role === 'professor' ? (
                  <Button
                    size="sm"
                    onClick={() => setNewOpen(true)}
                    aria-label="New message"
                    className="!h-10 !w-10 !rounded-xl !px-0"
                  >
                    <Icon name="plus" size={17} />
                  </Button>
                ) : undefined
              }
            />
          )}
        </aside>

        <main className={`min-w-0 flex-1 ${conversationId ? 'block' : 'hidden lg:block'}`}>
          {error ? (
            <div className="p-6">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : !conversationId ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl surface-sunken text-faint">
                  <Icon name="message" size={24} />
                </span>
                <p className="mt-5 text-[15.5px] font-medium text-ink">Pick a conversation</p>
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
        </main>
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
