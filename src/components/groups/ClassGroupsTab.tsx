import { useCallback, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { CreateSetWizard } from './CreateSetWizard'
import { GroupsBoard } from './GroupsBoard'
import { useAuth } from '../../context/AuthContext'
import { useGroupsData } from '../../hooks/useGroupsData'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  deleteSet,
  placeStudent,
  projectsUsingSet,
  setClosed,
  ungroupedStudents,
} from '../../lib/api/groups'
import { authErrorMessage } from '../../lib/authError'
import { placeLeftovers } from '../../lib/grouping'
import { paths } from '../../lib/paths'
import type { ClassSummary, GroupSet } from '../../lib/types'

/**
 * The Groups tab inside a class — same board, scoped to one class. For the
 * professor it is also where the class's groups are run: the Active/Archived
 * shelves, and closing a set with the offer to place whoever has no group.
 */
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
  const { profile } = useAuth()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleting, setDeleting] = useState<GroupSet | null>(null)
  const [boundProjects, setBoundProjects] = useState(0)
  const [view, setView] = useState<'active' | 'archived'>('active')
  const [closing, setClosing] = useState<GroupSet | null>(null)
  const [unplaced, setUnplaced] = useState<{ id: string; name: string }[]>([])
  // Closing is the moment a professor finds out who is left over, so it is
  // also where they can be placed. On by default; they can say no.
  const [placeThem, setPlaceThem] = useState(true)
  // Keyed on the id, like the projects tab: the class page refetches its class
  // on every live refresh.
  const classId = cls.id
  const ids = useMemo(() => [{ id: classId }], [classId])
  const classes = useMemo(() => [cls], [cls])
  const professor = role === 'professor'
  const archived = professor && view === 'archived'
  const { sets, groups, members, loading, error, reload } = useGroupsData(ids, archived)

  const canManage = professor && !cls.archived_at

  const closePlan = useMemo(
    () =>
      placeLeftovers(
        groups
          .filter((g) => g.set_id === closing?.id)
          .map((g) => ({ id: g.id, name: g.name, count: g.member_count, limit: g.member_limit })),
        unplaced,
      ),
    [groups, closing, unplaced],
  )

  const promptClose = useCallback(async (set: GroupSet) => {
    try {
      const rows = await ungroupedStudents(set.id)
      setUnplaced(rows.map((r) => ({ id: r.student_id, name: `${r.last_name}, ${r.first_name}` })))
    } catch {
      setUnplaced([])
    }
    setPlaceThem(true)
    setClosing(set)
  }, [])

  // The same Active/Archived pair the Groups page had: archiving is only a
  // real alternative to deleting if there is somewhere to look for what was
  // put away. Each archived group restores from its own page.
  const shelves = professor ? (
    <div role="radiogroup" aria-label="Show" className="flex gap-1 rounded-lg surface-sunken p-1">
      {(['active', 'archived'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => setView(v)}
          className={`rounded-md px-4 py-1.5 text-[13px] transition-colors duration-150 ${
            view === v
              ? 'surface font-medium text-ink ring-1 ring-[var(--line)]'
              : 'text-muted hover:text-ink'
          }`}
        >
          {v === 'active' ? 'Active' : 'Archived'}
        </button>
      ))}
    </div>
  ) : null
  const canCreate = canManage && !archived && groups.length > 0

  return (
    <div className="space-y-4">
      {(shelves || canCreate) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {shelves ?? <span />}
          {canCreate && (
            <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
              <Icon name="plus" size={17} />
              Create groups
            </Button>
          )}
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
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
          linkBase={paths.groups}
          viewerId={viewerId}
          showFilters={groups.length > 6}
          showSetFilter={professor}
          emptyTitle={archived ? 'No archived groups' : 'No groups in this class yet'}
          emptyBody={
            archived
              ? 'Groups you archive in this class wait here, and each one restores from its own page.'
              : canManage
                ? 'Split this class into teams — place students yourself, shuffle them, or publish empty groups for them to pick.'
                : 'When your professor arranges groups for this class, they show up here.'
          }
          emptyAction={
            canManage && !archived ? (
              <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
                Create groups
              </Button>
            ) : undefined
          }
          setActions={
            // Sets are run from the live shelf: closing places leftovers into live groups.
            canManage && !archived
              ? (set) => (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="!rounded-lg"
                      onClick={async () => {
                        if (!set.closed_at) {
                          await promptClose(set)
                          return
                        }
                        try {
                          await setClosed(set.id, false)
                          show(`${set.name} reopened`)
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
                        className="!rounded-lg !text-danger-600 dark:!text-danger-400"
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
      )}

      <ConfirmDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (!closing || !profile) return
          const placing = placeThem ? closePlan.placed : []
          for (const p of placing) {
            await placeStudent({
              groupId: p.group.id,
              setId: closing.id,
              studentId: p.student.id,
              byProfessorId: profile.id,
            })
          }
          await setClosed(closing.id, true)
          show(
            placing.length > 0
              ? `${closing.name} is now final. ${placing.length} placed.`
              : `${closing.name} is now final`,
          )
          await reload()
        }}
        title={`Close ${closing?.name ?? ''}?`}
        tone="primary"
        confirmLabel={
          placeThem && closePlan.placed.length > 0
            ? `Place ${closePlan.placed.length} and close`
            : 'Close set'
        }
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
              {closePlan.placed.length > 0 && (
                <label className="mt-2 flex items-start gap-2.5 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={placeThem}
                    onChange={(e) => setPlaceThem(e.target.checked)}
                    className="mt-1"
                  />
                  <span>Place them in the groups with room, smallest first</span>
                </label>
              )}
              <ul className="mt-1.5 space-y-0.5">
                {unplaced.map((n) => {
                  const to = closePlan.placed.find((p) => p.student.id === n.id)?.group.name
                  return (
                    <li key={n.id} className="text-[13px]">
                      · {n.name}
                      {placeThem && (
                        <span className="text-faint">{to ? ` → ${to}` : ' · no room anywhere'}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            'Everyone in the class has a group. Students can no longer join, leave, switch, or rename after this — you can reopen the set later.'
          )
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
