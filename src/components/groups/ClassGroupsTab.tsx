import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { CreateSetWizard } from './CreateSetWizard'
import { GroupsBoard } from './GroupsBoard'
import { useGroupsData } from '../../hooks/useGroupsData'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { deleteSet, projectsUsingSet, setClosed } from '../../lib/api/groups'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, GroupSet } from '../../lib/types'

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
  const [deleting, setDeleting] = useState<GroupSet | null>(null)
  const [boundProjects, setBoundProjects] = useState(0)
  const classes = useMemo(() => [cls], [cls])
  const { sets, groups, members, loading, error, reload } = useGroupsData(classes)

  const canManage = role === 'professor' && !cls.archived_at

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
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
                <div className="flex items-center gap-2">
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

                  {/* Only while the set is open — a closed set is a final record. */}
                  {!set.closed_at && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="!rounded-lg !text-red-600 dark:!text-red-400"
                      onClick={async () => {
                        try {
                          setBoundProjects(await projectsUsingSet(set.id))
                        } catch {
                          setBoundProjects(0)
                        }
                        setDeleting(set)
                      }}
                    >
                      <Icon name="trash" size={15} />
                      Delete all groups
                    </Button>
                  )}
                </div>
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteSet(deleting.id)
          show(`${deleting.name} deleted`)
          await reload()
        }}
        title={`Delete ${deleting?.name ?? ''}?`}
        confirmLabel="Delete all groups"
        blocked={boundProjects > 0}
        body={
          boundProjects > 0 ? (
            <>
              <p>
                {boundProjects} project{boundProjects === 1 ? ' is' : 's are'} assigned to these
                groups, so deleting them would leave that work with nobody to hand it in.
              </p>
              <p className="mt-3">
                Reassign or delete{' '}
                {boundProjects === 1 ? 'that project' : 'those projects'} first, then this set
                can go.
              </p>
            </>
          ) : (
            <>
              <p>
                Every group in this set is deleted along with its members and its group chats.
                The students stay in the class.
              </p>
              <p className="mt-3">This cannot be undone.</p>
            </>
          )
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
