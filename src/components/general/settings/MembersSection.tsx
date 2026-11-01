// src/components/general/settings/MembersSection.tsx
import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { MemberList } from '../MembersTab'
import { InvitePanel } from '../InvitePanel'
import { RequestsPanel } from '../RequestsPanel'
import { RoleGuide } from '../RoleGuide'
import { StructurePanel } from '../StructurePanel'
import type { GeneralProjectState } from '../useGeneralProject'

export function MembersSection({ state }: { state: GeneralProjectState }) {
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const canSeeRequests = (state.canGrant && !state.archived) || state.myRole === 'member'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        {canSeeRequests && (
          <Button type="button" variant="outline" onClick={() => setRequestsOpen(true)}>
            Access requests
          </Button>
        )}
        <Button type="button" onClick={() => setInviteOpen(true)}>
          Invite people
        </Button>
      </div>
      <MemberList state={state} />
      <RoleGuide />
      <StructurePanel state={state} />
      <Modal open={requestsOpen} onClose={() => setRequestsOpen(false)} title={state.canGrant && !state.archived ? 'Access requests' : 'Your access'} size="md">
        <RequestsPanel state={state} />
      </Modal>
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Bring people in" size="md" focusField>
        <InvitePanel state={state} />
      </Modal>
    </div>
  )
}
