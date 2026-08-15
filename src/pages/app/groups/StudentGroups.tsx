import { useEffect, useMemo, useState } from 'react'
import { Alert } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import { GroupsBoard } from '../../../components/groups/GroupsBoard'
import { useAuth } from '../../../context/AuthContext'
import { membersOf, useGroupsData } from '../../../hooks/useGroupsData'
import { listStudentClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary } from '../../../lib/types'

type TabId = 'mine' | 'open'

export default function StudentGroups() {
  const { profile } = useAuth()

  const [tab, setTab] = useState<TabId>('mine')
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)

  // Joining happens on the group's own page, so this list is read-only.
  const { sets, groups, members, loading, error } = useGroupsData(classes)

  useEffect(() => {
    document.title = 'Groups · Collabify'
  }, [])

  useEffect(() => {
    if (!profile) return
    void listStudentClasses(profile.id)
      .then(setClasses)
      .catch((err) => {
        setClassError(authErrorMessage(err, 'Could not load your classes.'))
        setClasses([])
      })
  }, [profile])

  const mine = useMemo(
    () => groups.filter((g) => membersOf(members, g.id).some((m) => m.student_id === profile?.id)),
    [groups, members, profile],
  )

  /** Groups a student could still claim: open student-formed sets they are not in. */
  const joinable = useMemo(() => {
    const setById = new Map(sets.map((s) => [s.id, s]))
    const mySetIds = new Set(mine.map((g) => g.set_id))
    return groups.filter((g) => {
      const set = setById.get(g.set_id)
      if (!set || set.mode !== 'student_formed' || set.closed_at) return false
      return !mySetIds.has(g.set_id)
    })
  }, [groups, sets, mine])

  const shown = tab === 'mine' ? mine : joinable

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header>
        <p className="eyebrow text-amber-500 dark:text-amber-300">Workspace</p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Groups</h1>
        <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
          The teams you belong to. When a professor lets the class form its own groups, you
          can claim a slot here.
        </p>
      </header>

      <div className="mt-7">
        <Tabs<TabId>
          tabs={[
            { id: 'mine', label: 'My groups', icon: 'users', count: mine.length },
            { id: 'open', label: 'Open to join', icon: 'plus', count: joinable.length },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div className="mt-6 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading || classes === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading groups…
          </div>
        ) : (
          <>
            {tab === 'open' && joinable.length > 0 && (
              <p className="text-[13.5px] text-muted">
                Open a group to see who's in it and claim a slot. You can switch while the set
                stays open.
              </p>
            )}
            <GroupsBoard
              classes={classes}
              sets={sets}
              groups={shown}
              members={members}
              linkBase="/student/groups"
              viewerId={profile?.id}
              showSetFilter={false}
              emptyTitle={tab === 'mine' ? "You're not in a group yet" : 'Nothing to join'}
              emptyBody={
                tab === 'mine'
                  ? 'When your professor arranges groups, or opens a set for the class to form its own, your group shows up here.'
                  : 'No professor has opened a student-formed set that you still need a group in.'
              }
            />
          </>
        )}
      </div>
    </div>
  )
}
