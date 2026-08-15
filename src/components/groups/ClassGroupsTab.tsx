import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { CreateSetWizard } from './CreateSetWizard'
import { GroupsBoard } from './GroupsBoard'
import { useGroupsData } from '../../hooks/useGroupsData'
import { setClosed } from '../../lib/api/groups'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary } from '../../lib/types'

/** The Groups tab inside a class — same board, scoped to one class. */
export function ClassGroupsTab({
  cls,
  role,
  viewerId,
}: {
  cls: ClassSummary
  role: 'professor' | 'student'
  viewerId?: string
}) {
  const { show } = useToast()
  const [wizardOpen, setWizardOpen] = useState(false)
  const classes = useMemo(() => [cls], [cls])
  const { sets, groups, members, loading, error, reload } = useGroupsData(classes)

  const canManage = role === 'professor' && !cls.archived_at

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading groups…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {canManage && groups.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
            <Icon name="plus" size={17} />
            Create groups
          </Button>
        </div>
      )}

      <GroupsBoard
        classes={classes}
        sets={sets}
        groups={groups}
        members={members}
        linkBase={role === 'professor' ? '/professor/groups' : '/student/groups'}
        viewerId={viewerId}
        showFilters={groups.length > 6}
        showSetFilter={role === 'professor'}
        emptyTitle="No groups in this class yet"
        emptyBody={
          canManage
            ? 'Split this class into teams — place students yourself, shuffle them, or publish empty groups for them to pick.'
            : 'When your professor arranges groups for this class, they show up here.'
        }
        emptyAction={
          canManage ? (
            <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
              Create groups
            </Button>
          ) : undefined
        }
        setActions={
          canManage
            ? (set) => (
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={async () => {
                    try {
                      await setClosed(set.id, !set.closed_at)
                      show(set.closed_at ? `${set.name} reopened` : `${set.name} is now final`)
                      await reload()
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not change that.'), 'error')
                    }
                  }}
                >
                  <Icon name={set.closed_at ? 'refresh' : 'lock'} size={15} />
                  {set.closed_at ? 'Reopen' : 'Close set'}
                </Button>
              )
            : undefined
        }
      />

      <CreateSetWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        classes={classes}
        fixedClassId={cls.id}
        onCreated={reload}
      />
    </div>
  )
}
