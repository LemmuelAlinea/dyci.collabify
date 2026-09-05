import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { CreateSetWizard } from '../../../components/groups/CreateSetWizard'
import { GroupsBoard } from '../../../components/groups/GroupsBoard'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useGroupsData } from '../../../hooks/useGroupsData'
import { listProfessorClasses } from '../../../lib/api/classes'
import {
  deleteSet,
  projectsUsingSet,
  setClosed,
  ungroupedStudents,
} from '../../../lib/api/groups'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary, GroupSet } from '../../../lib/types'

export default function ProfessorGroups() {
  const { profile } = useAuth()
  const { show } = useToast()

  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [closing, setClosing] = useState<GroupSet | null>(null)
  const [deleting, setDeleting] = useState<GroupSet | null>(null)
  const [unplaced, setUnplaced] = useState<string[]>([])
  const [boundProjects, setBoundProjects] = useState(0)

  const { sets, groups, members, loading, error, reload } = useGroupsData(classes)
  const pending = loading || classes === null

  useEffect(() => {
    document.title = 'Groups · Collabify'
  }, [])

  useEffect(() => {
    if (!profile) return
    void listProfessorClasses(profile.id)
      .then(setClasses)
      .catch((err) => {
        setClassError(authErrorMessage(err, 'Could not load your classes.'))
        setClasses([])
      })
  }, [profile])

  const promptDelete = useCallback(async (set: GroupSet) => {
    try {
      setBoundProjects(await projectsUsingSet(set.id))
    } catch {
      setBoundProjects(0)
    }
    setDeleting(set)
  }, [])

  const promptClose = useCallback(async (set: GroupSet) => {
    try {
      const rows = await ungroupedStudents(set.id)
      setUnplaced(rows.map((r) => `${r.last_name}, ${r.first_name}`))
    } catch {
      setUnplaced([])
    }
    setClosing(set)
  }, [])

  return (
    <div className="w-full">
      <DirectoryHero
        title="Teams that make"
        accent="the work move."
        description="Arrange each class into focused working teams, then see membership and project momentum without losing the class context."
        action={
          <Button
            variant="accent"
            onClick={() => setWizardOpen(true)}
            disabled={!classes || classes.length === 0}
          >
            <Icon name="plus" size={17} />
            Create groups
          </Button>
        }
        stats={[
          { value: pending ? '—' : sets.length, label: 'Group sets' },
          { value: pending ? '—' : groups.length, label: 'Working teams' },
        ]}
      />

      <div className="mt-8 border-b border-line pb-4">
        <p className="text-[12px] font-medium text-faint">Group directory</p>
        <h2 className="mt-1">Teams by class</h2>
      </div>

      <div className="mt-5 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {classes && classes.length === 0 && (
          <Alert tone="info">
            Groups belong to a class, and you don't have one yet. Create a class first.
          </Alert>
        )}

        {loading || classes === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading groups…
          </div>
        ) : (
          <GroupsBoard
            classes={classes}
            sets={sets}
            groups={groups}
            members={members}
            linkBase="/professor/groups"
            emptyTitle="No groups yet"
            emptyBody="Create a set to split one of your classes into teams. You can place students by hand, shuffle them randomly, or publish empty groups for them to pick."
            emptyAction={
              classes.length > 0 ? (
                <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
                  Create groups
                </Button>
              ) : undefined
            }
            setActions={(set) => (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={async () => {
                    if (set.closed_at) {
                      await setClosed(set.id, false)
                      show(`${set.name} reopened`)
                      await reload()
                    } else {
                      await promptClose(set)
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
                    onClick={() => void promptDelete(set)}
                  >
                    <Icon name="trash" size={15} />
                    Delete all groups
                  </Button>
                )}
              </div>
            )}
          />
        )}
      </div>

      <CreateSetWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        classes={classes ?? []}
        onCreated={reload}
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

      <ConfirmDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (!closing) return
          await setClosed(closing.id, true)
          show(`${closing.name} is now final`)
          await reload()
        }}
        title={`Close ${closing?.name ?? ''}?`}
        tone="primary"
        confirmLabel="Close set"
        body={
          unplaced.length > 0 ? (
            <>
              <p>
                Students keep their groups but can no longer join, leave, switch, or rename.
                You can reopen the set later.
              </p>
              <p className="mt-3 font-medium text-ink">
                {unplaced.length} student{unplaced.length === 1 ? ' has' : 's have'} no group:
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {unplaced.map((n) => (
                  <li key={n} className="text-[13px]">
                    · {n}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            'Everyone in the class has a group. Students can no longer join, leave, switch, or rename after this — you can reopen the set later.'
          )
        }
      />
    </div>
  )
}
