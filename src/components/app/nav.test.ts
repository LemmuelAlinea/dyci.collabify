import { describe, expect, it } from 'vitest'
import { navFor } from './nav'
import type { NavGroup } from './nav'
import type { AccountStatus, Role } from '../../lib/types'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))
const titles = (groups: NavGroup[]) => groups.map((g) => g.title)
const tos = (groups: NavGroup[]) =>
  groups.flatMap((g) => [...g.items.map((i) => i.to), ...(g.more ? [g.more.to] : [])])
const places = (groups: NavGroup[]) => groups.find((g) => g.picker)
const spaces = (groups: NavGroup[]) => groups.find((g) => g.picker?.includes('spaces'))
const section = (groups: NavGroup[], title: string) =>
  groups.find((g) => g.title === title)?.items.map((i) => i.label)

const account = (
  role: Role | null,
  status: AccountStatus = 'active',
  can_teach = false,
  can_manage_projects = false,
) => ({
  role,
  status,
  can_teach,
  can_manage_projects,
})
const student = account('student')
const teacher = account('member', 'active', true)
const nonTeacher = account('member')
const admin = account('admin')

describe('navFor', () => {
  it('puts Archive between Settings and Trash for everyone admitted, the program archive for admins', () => {
    const account = (groups: NavGroup[]) => section(groups, 'Account')
    expect(account(navFor(student, true, { inClass: true, hasWork: false }))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(teacher, true))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(nonTeacher, true))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(admin, true, { inClass: false, hasWork: true }))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(admin, true))).toEqual(['Settings', 'Archive', 'Trash'])
    const adminArchive = navFor(admin, true).find((g) => g.title === 'Account')!.items[1]
    expect(adminArchive.to).toBe('/admin/archive')
    expect(account(navFor(student, false))).toEqual(['Settings', 'Trash'])
  })

  it('gives a student nobody has let in only Home, Settings and Trash', () => {
    expect(labels(navFor(student, false))).toEqual(['Home', 'Settings', 'Trash'])
  })

  it('opens a student with only classes on a Classes card, Your record under Resources', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Classes', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
    expect(places(groups)?.picker).toEqual(['classes'])
    expect(section(groups, 'Resources')).toEqual(['Your record'])
    expect(titles(navFor(student, true))).toEqual(['Classes', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
  })

  it('adds Spaces after Classes on the card once a student is invited to some work', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: true })
    expect(titles(groups)).toEqual(['Classes & spaces', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
    expect(places(groups)?.picker).toEqual(['classes', 'spaces'])
    expect(spaces(groups)?.hideWhenEmpty).toBe(true)
  })

  describe('the teaching rail', () => {
    const manager = account('member', 'active', true, true)
    const gone = ['Groups', 'Submissions', 'Reassignments', 'Analytics', 'Reports']

    it('opens on the classes card, then Main, Resources and Account', () => {
      const groups = navFor(teacher, true)
      expect(titles(groups)).toEqual(['Classes', 'Main', 'Resources', 'Account'])
      expect(section(groups, 'Resources')).toEqual(['Syllabi', 'Curriculum'])
      expect(labels(groups)).not.toContain('Your record')
      expect(titles(navFor(teacher, true, { inClass: true, hasWork: false }))).toEqual([
        'Classes',
        'Main',
        'Resources',
        'Account',
      ])
    })

    it('puts Waiting on you, with its count, between Home and Inbox', () => {
      const groups = navFor(teacher, true)
      expect(section(groups, 'Main')).toEqual(['Home', 'Waiting on you', 'Inbox', 'Calendar', 'Meetings'])
      const waiting = groups.find((g) => g.title === 'Main')!.items[1]
      expect(waiting.badge).toBe('waiting')
      expect(waiting.to).toBe('/waiting')
    })

    it('puts the classes in the card at the top, as a student has it, with no projects under them', () => {
      const classes = navFor(teacher, true)[0]
      expect(classes.title).toBe('Classes')
      expect(classes.picker).toEqual(['classes'])
      expect(classes.items).toEqual([])
      // Spaces stay in Work's own card, so the top card never lists them twice.
      expect(navFor(manager, true)[0].picker).toEqual(['classes'])
    })

    it('adds Work between Main and Resources for work or the Project manager switch', () => {
      for (const groups of [
        navFor(teacher, true, { inClass: true, hasWork: true }),
        navFor(manager, true),
        navFor(manager, true, { inClass: false, hasWork: false }),
      ]) {
        expect(titles(groups)).toEqual(['Classes', 'Main', 'Work', 'Resources', 'Account'])
        const work = groups.find((g) => g.title === 'Work')!
        expect(work.picker).toEqual(['spaces'])
        expect(work.items.map((i) => i.label)).toEqual(['Projects', 'My tasks'])
      }
    })

    it('drops the old teaching pages, Groups and Quick access', () => {
      for (const groups of [navFor(teacher, true), navFor(manager, true, { inClass: true, hasWork: true })]) {
        for (const label of gone) expect(labels(groups)).not.toContain(label)
        expect(titles(groups)).not.toContain('Quick access')
        expect(titles(groups)).not.toContain('Teaching')
      }
    })
  })

  it('opens faculty who do not teach on Spaces, with no Classes, Teaching or Groups', () => {
    const groups = navFor(nonTeacher, true)
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Account'])
    expect(section(groups, 'Main')).toEqual(['My tasks', 'Projects', 'Meetings'])
  })

  it('never narrows faculty on the admission flag', () => {
    expect(navFor(teacher, false)[0].picker).toEqual(['classes'])
  })

  it('gives an admin in nothing Organization, Academic program, Compliance and Account', () => {
    const none = { inClass: false, hasWork: false }
    const want = ['Organization', 'Academic program', 'Compliance', 'Account']
    expect(titles(navFor(admin, true, none))).toEqual(want)
    expect(titles(navFor(admin, true))).toEqual(want)
    expect(navFor(admin, true, none)[0].items[0].label).toBe('Home')
    expect(labels(navFor(admin, true, none))).toContain('Accounts')
    expect(labels(navFor(admin, true, none))).not.toContain('Faculty approvals')
  })

  it('puts Work projects in the admin rail, right after Accounts', () => {
    const rail = section(navFor(admin, true), 'Organization') ?? []
    expect(rail).toContain('Work projects')
    expect(rail.indexOf('Work projects')).toBe(rail.indexOf('Accounts') + 1)
  })

  it('puts Offices right after Home in Organization and opens /admin/offices', () => {
    const org = navFor(admin, true).find((g) => g.title === 'Organization')!
    expect(org.items.map((i) => i.label).slice(0, 2)).toEqual(['Home', 'Offices'])
    expect(org.items[1].to).toBe('/admin/offices')
    expect(org.items[1].icon).toBe('briefcase')
  })

  it('makes Academic program collapsible', () => {
    const prog = navFor(admin, true).find((g) => g.title === 'Academic program')!
    expect(prog.collapsible).toBe(true)
    expect(prog.items.map((i) => i.label)).toEqual([
      'Sections', 'Syllabi', 'Curriculum', 'Classes', 'Faculty', 'Cohort',
    ])
  })

  it('keeps Audit log and Privacy requests under Compliance', () => {
    expect(section(navFor(admin, true), 'Compliance')).toEqual(['Audit log', 'Privacy requests'])
  })

  it('gives an admin in nothing but invited Home and Inbox, so they can answer', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: false, invited: true })
    expect(titles(groups)).toEqual(['Main', 'Organization', 'Academic program', 'Compliance', 'Account'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['Home', 'Inbox'])
  })

  it('shows an invited admin Home once', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: false, invited: true })
    expect(labels(groups).filter((l) => l === 'Home')).toHaveLength(1)
  })

  it('shows an admin in a space Home once', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: true })
    expect(labels(groups).filter((l) => l === 'Home')).toHaveLength(1)
  })

  it('splits the spine into Overview and Main', () => {
    const groups = navFor(student, true)
    expect(section(groups, 'Overview')).toEqual(['Home', 'Inbox', 'Calendar'])
    expect(section(groups, 'Main')).toEqual(['My tasks', 'Projects', 'Groups', 'Meetings'])
  })

  it('calls the conversations page Inbox for everyone', () => {
    for (const who of [student, teacher, nonTeacher, admin]) {
      const items = navFor(who, true, { inClass: true, hasWork: true }).flatMap((g) => g.items)
      expect(items.find((i) => i.to === '/inbox')?.label).toBe('Inbox')
    }
  })

  it('gives an admin in work the non-teaching faculty rail with Organization, and never Classes', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: true })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Organization', 'Academic program', 'Compliance', 'Account'])
  })

  it('lists an admin\'s classes under Spaces once one invites them', () => {
    const groups = navFor(admin, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Organization', 'Academic program', 'Compliance', 'Account'])
    expect(spaces(groups)?.withClasses).toBe(true)
  })

  it('lists classes under Spaces for faculty who do not teach, not for those who do', () => {
    expect(spaces(navFor(nonTeacher, true))?.withClasses).toBe(true)
    expect(spaces(navFor(teacher, true, { inClass: true, hasWork: true }))?.withClasses).toBe(false)
    expect(spaces(navFor(student, true, { inClass: true, hasWork: true }))?.withClasses).toBe(false)
  })

  it('hides an empty Spaces only for accounts that cannot open a class', () => {
    expect(spaces(navFor(nonTeacher, true))?.hideWhenEmpty).toBe(true)
    expect(spaces(navFor(account('member', 'active', true, true), true))?.hideWhenEmpty).toBe(false)
    expect(spaces(navFor(teacher, true, { inClass: true, hasWork: true }))?.hideWhenEmpty).toBe(true)
    expect(spaces(navFor(admin, true, { inClass: false, hasWork: true }))?.hideWhenEmpty).toBe(true)
  })

  it('fills Quick access with recent projects and hides it while there are none', () => {
    for (const who of [student, nonTeacher]) {
      const quick = navFor(who, true, { inClass: true, hasWork: true }).find((g) => g.title === 'Quick access')
      expect(quick?.live).toBe('recent')
      expect(quick?.hideWhenEmpty).toBe(true)
    }
  })

  it('gives an account with no role, or one not active, only Settings and Trash', () => {
    expect(labels(navFor(account(null, 'pending'), true))).toEqual(['Settings', 'Trash'])
    expect(labels(navFor(account('member', 'pending', true), true))).toEqual(['Settings', 'Trash'])
    expect(labels(navFor(null, true))).toEqual(['Settings', 'Trash'])
  })

  it('routes every item through one of the allowed prefixes', () => {
    const allowed = [
      '/home',
      '/tasks',
      '/calendar',
      '/meetings',
      '/inbox',
      '/waiting',
      '/settings',
      '/trash',
      '/archive',
      '/spaces',
      '/projects',
      '/classes',
      '/groups',
      '/record',
      '/teaching/',
      '/admin/',
    ]
    for (const who of [student, teacher, nonTeacher, admin]) {
      for (const to of tos(navFor(who, true, { inClass: true, hasWork: true }))) {
        expect(allowed.some((prefix) => to?.startsWith(prefix))).toBe(true)
      }
    }
  })

  it('gives a member with no switches, in nothing, only Home, Inbox and Account', () => {
    const groups = navFor(nonTeacher, true, { inClass: false, hasWork: false })
    expect(titles(groups)).toEqual(['Main', 'Account'])
    expect(section(groups, 'Main')).toEqual(['Home', 'Inbox'])
    // The plain Account group: Settings and Trash, no Archive.
    expect(section(groups, 'Account')).toEqual(section(navFor(null, true), 'Account'))
    expect(labels(groups)).not.toContain('Spaces')
  })

  it('keeps Spaces on the rail of a project manager who is in nothing', () => {
    const manager = account('member', 'active', false, true)
    const groups = navFor(manager, true, { inClass: false, hasWork: false })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Account'])
    expect(spaces(groups)?.hideWhenEmpty).toBe(false)
    expect(spaces(navFor(manager, true))?.hideWhenEmpty).toBe(false)
  })

  it('gives a member with no switches but work the normal spaces rail', () => {
    const groups = navFor(nonTeacher, true, { inClass: false, hasWork: true })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Account'])
    expect(spaces(groups)?.hideWhenEmpty).toBe(true)
  })

  describe('the stakeholder rail', () => {
    const slim = { inClass: false, hasWork: true, allStakeholder: true }

    it('gives a member who is only a stakeholder Home, Projects, Inbox and Calendar above Account', () => {
      const groups = navFor(nonTeacher, true, slim)
      expect(labels(groups)).toEqual(['Home', 'Projects', 'Inbox', 'Calendar', 'Settings', 'Trash'])
      expect(tos(groups)).toEqual(['/home', '/projects', '/inbox', '/calendar', '/settings', '/trash'])
      expect(places(groups)).toBeUndefined()
    })

    it('keeps the normal rails for teaching faculty, project managers, students and the admin', () => {
      expect(labels(navFor(teacher, true, slim))).toContain('Waiting on you')
      const manager = account('member', 'active', false, true)
      expect(labels(navFor(manager, true, slim))).toContain('My tasks')
      expect(labels(navFor(student, true, slim))).toContain('Your record')
      expect(labels(navFor(admin, true, slim))).toContain('Accounts')
    })

    it('keeps the normal rail for a stakeholder who also sits in a class, or is not only one', () => {
      expect(labels(navFor(nonTeacher, true, { ...slim, inClass: true }))).toContain('My tasks')
      expect(labels(navFor(nonTeacher, true, { inClass: false, hasWork: true }))).toContain('My tasks')
    })
  })

  describe('My office', () => {
    // Every member rail, with the title of its first main group.
    const rails = [
      { name: 'teaching', who: teacher, membership: undefined, main: 'Main' },
      { name: 'stakeholder-only', who: nonTeacher, membership: { inClass: false, hasWork: true, allStakeholder: true }, main: 'Main' },
      { name: 'in nothing', who: nonTeacher, membership: { inClass: false, hasWork: false }, main: 'Main' },
      { name: 'regular', who: nonTeacher, membership: { inClass: false, hasWork: true }, main: 'Overview' },
      { name: 'regular, still loading', who: nonTeacher, membership: undefined, main: 'Overview' },
    ]
    const office = (groups: NavGroup[]) =>
      groups.flatMap((g) => g.items.map((i) => ({ group: g.title, ...i }))).filter((i) => i.label === 'My office')

    it('adds My office to each member rail only when headsOffice', () => {
      for (const { who, membership, main } of rails) {
        const entries = office(navFor(who, true, membership, true))
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ group: main, icon: 'briefcase', to: '/office' })
        expect(office(navFor(who, true, membership, false))).toHaveLength(0)
      }
      // Admins and students never get it, whatever the flag says.
      for (const membership of [undefined, { inClass: false, hasWork: false }, { inClass: true, hasWork: true }]) {
        expect(office(navFor(admin, true, membership, true))).toHaveLength(0)
        expect(office(navFor(student, true, membership, true))).toHaveLength(0)
      }
      expect(office(navFor(account('member', 'pending'), true, undefined, true))).toHaveLength(0)
    })

    it('headsOffice never changes which rail a member gets', () => {
      for (const { who, membership } of rails) {
        const without = navFor(who, true, membership, false)
        const withIt = navFor(who, true, membership, true)
        expect(titles(withIt)).toEqual(titles(without))
        expect(labels(withIt).filter((l) => l !== 'My office')).toEqual(labels(without))
      }
      // The shared groups are copied, never changed in place.
      navFor(nonTeacher, true, { inClass: false, hasWork: true }, true)
      expect(section(navFor(nonTeacher, true, { inClass: false, hasWork: true }), 'Overview')).toEqual([
        'Home',
        'Inbox',
        'Calendar',
      ])
    })

    it('no My office while the flag is undefined', () => {
      for (const { who, membership } of rails) {
        expect(office(navFor(who, true, membership))).toHaveLength(0)
        expect(office(navFor(who, true, membership, undefined))).toHaveLength(0)
      }
    })
  })
})
