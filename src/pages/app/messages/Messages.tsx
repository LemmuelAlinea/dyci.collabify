import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ScopeFilter } from '../../../components/ui/ScopeFilter'
import { ConversationList } from '../../../components/messages/ConversationList'
import { MessageThread } from '../../../components/messages/MessageThread'
import { InboxInvitations } from '../../../components/messages/InboxInvitations'
import { NewDirectDialog } from '../../../components/messages/NewDirectDialog'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { useConversations } from '../../../hooks/useConversations'
import { canTeach, membershipOf, showsClassScope } from '../../../lib/access'
import { paths } from '../../../lib/paths'
import { conversationScope, readScope, writeScope } from '../../../lib/scope'

export default function Messages() {
  const { conversationId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  // Without classes and work both there is nothing to split, so show every
  // conversation — a direct chat somebody else started included.
  const { spaces, myProjects } = useGeneralNavigation()
  const classScope = showsClassScope(profile, membershipOf(spaces, myProjects))
  const scope = classScope ? readScope(params) : 'all'
  const { conversations, error, reload } = useConversations(profile?.id, 'all')
  const [newOpen, setNewOpen] = useState(false)

  const canModerateHere = profile?.role === 'faculty' || profile?.role === 'admin'
  // Starting a direct thread is a teaching act — an admin who does not teach
  // has no student to message here, even though they can still moderate a
  // class or group chat below.
  const canStartMessages = canTeach(profile)

  useEffect(() => {
    document.title = 'Inbox · Collabify'
  }, [])

  const classesCount = conversations?.filter((c) => conversationScope(c.kind) === 'classes').length ?? 0
  const workCount = conversations?.filter((c) => conversationScope(c.kind) === 'work').length ?? 0
  const visible = useMemo(() => {
    if (!conversations) return conversations
    if (scope === 'classes' || scope === 'work') {
      return conversations.filter((c) => conversationScope(c.kind) === scope)
    }
    return conversations
  }, [conversations, scope])

  const active = conversations?.find((c) => c.id === conversationId)
  const canModerate = canModerateHere && (active?.kind === 'class' || active?.kind === 'group')

  if (!profile) return null

  return (
    <div className="w-full space-y-5">
      {/* An open conversation takes the whole page; the banner comes back when it closes. */}
      {!conversationId && (
        <>
      <DirectoryHero
        title="Your"
        accent="inbox."
        description="Invitations waiting for your answer, and every class, group, project and direct chat, in one place."
        action={
          canStartMessages ? (
            <Button variant="create" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={17} />
              New message
            </Button>
          ) : undefined
        }
      />

      <InboxInvitations onAnswered={() => void reload()} />
        </>
      )}

      {classScope && !conversationId && (
        <div className="flex justify-end">
          <ScopeFilter
            value={scope}
            onChange={(next) => setParams(writeScope(params, next), { replace: true })}
            counts={
              conversations ? { all: conversations.length, classes: classesCount, work: workCount } : undefined
            }
          />
        </div>
      )}

      <div
        className={`surface flex min-h-0 overflow-hidden rounded-panel border border-line ${
          conversationId ? 'h-[max(420px,calc(100dvh-8.5rem))]' : 'h-[clamp(480px,calc(100dvh-458px),760px)]'
        }`}
      >
        <aside
          className={`w-full shrink-0 border-line md:block md:w-[320px] md:border-r xl:w-[360px] ${
            conversationId ? 'hidden' : 'block'
          }`}
        >
          {visible === null ? (
            <div className="flex items-center gap-3 px-4 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Loading…
            </div>
          ) : (
            <ConversationList
              conversations={visible}
              activeId={conversationId}
              linkBase={paths.inbox}
              search={location.search}
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
                {/* Decorative, like the empty-state art: the heading says it. */}
                <img
                  src="/illustrations/inbox.webp"
                  alt=""
                  width={176}
                  height={176}
                  className="mx-auto h-32 w-32 sm:h-44 sm:w-44"
                />
                <h2 className="mt-3">Choose a conversation</h2>
                <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
                  Every class, group and project you're in has its own chat, created for you
                  automatically.
                </p>
              </div>
            </div>
          ) : conversations && !active ? (
            <div className="p-6">
              <Alert tone="error">
                That conversation is not available. You may have been removed from the class,
                group or project it belongs to.
              </Alert>
            </div>
          ) : active ? (
            <MessageThread
              conversation={active}
              viewerId={profile.id}
              canModerate={canModerate}
              backTo={paths.inbox}
              search={location.search}
            />
          ) : (
            <div className="flex items-center gap-3 p-6 text-[14px] text-muted">
              <Spinner size={16} />
              Loading…
            </div>
          )}
        </section>
      </div>

      {canStartMessages && (
        <NewDirectDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          professorId={profile.id}
          onStarted={async (id) => {
            await reload()
            navigate(`${paths.conversation(id)}${location.search}`)
          }}
        />
      )}
    </div>
  )
}
