# General Workplace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Collabify into an Education workplace (everything that exists today) and a new General workplace where anyone at the school runs editable projects with teams, custom positions, access levels, requestable permissions, invitations and tasks.

**Architecture:** General gets its own tables, row-level security and RPCs in three new SQL files, sharing only `profiles`, `notifications`, `conversations` and storage with Education. The client adds a workplace concept to accounts and routing, a General section under `/general/*`, and pure logic in `src/lib/general/` that mirrors the database rules so the interface never offers a button the database will refuse.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Supabase (Postgres, Auth, Storage, Realtime, pg_cron), Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-17-general-workplace-foundation-design.md`

## Global Constraints

- Colors come only from tokens in `src/styles/index.css` (`surface`, `surface-raised`, `surface-sunken`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `border-line-strong`, `navy-*`, `amber-*`). No raw hex in components.
- Copy is sentence case and active voice, with no exclamation marks, no "please" and no "successfully". Errors say what happened and what to do next.
- Every SQL file is idempotent and re-runnable. A new enum value is added in its own transaction before anything uses it.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend code or any committed file.
- `role` and `status` stay changeable only by an admin, except the one-time `enter_education` path this plan adds.
- Every new SQL file is appended to `ORDER` in `scripts/schema-drift.mjs` and to the rebuild command in `docs/07-backup.md`, in the same order.
- Vitest runs in the `node` environment over `src/**/*.test.ts`. Only pure logic is unit-tested. There are no component tests.
- Motion goes through `components/motion/Reveal.tsx` or Motion's `useReducedMotion`. `scripts/motion-lint.mjs` rejects ungated `hover:translate-*`.
- Icon-only buttons need an `aria-label` (`scripts/a11y-names.mjs`).
- Design desktop first, then tablet, then phone. Wide content scrolls inside its own container, and the page never scrolls sideways.
- `npm run check` must pass. Lint holds at **23 warnings, 0 errors**, excluding the untracked `docs/redesign/serve-dashboard-preview.mjs`, which is not part of this work. Run lint as `npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs` while that file exists.
- Education behavior does not change, apart from the account changes in Tasks 4 and 9.
- `rejected` means **deactivated** (`supabase/accounts.sql:103-134` uses it for offboarding). A rejected account is blocked from both workplaces. A `pending` professor can still use General.

### Running SQL

`db.<ref>.supabase.co` is IPv6-only on this machine. Every `node scripts/db.mjs` command in this plan runs in a shell prepared like this:

```bash
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
```

SQL test files print `PASS` lines through `raise notice` and end in `rollback`, so they change nothing. A failure raises `FAIL …` and stops the run.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/general/permissions.ts` | Access levels, permissions, labels, and whether a person can do something |
| `src/lib/general/fields.ts` | Added-field types, value validation, option validation and display formatting |
| `src/lib/general/progress.ts` | Project progress with points on and off, and a task's share |
| `src/lib/general/dates.ts` | Project date ranges, due dates, overdue, and datetime input conversion |
| `src/lib/general/history.ts` | A task history event as a sentence |
| `src/lib/workplace.ts` | `Workplace` type, which workplace a path belongs to, and where a profile lands |
| `src/lib/general/types.ts` | Row types for every General table and view |
| `src/lib/api/general.ts` | Every Supabase call the General workplace makes |
| `supabase/workplaces.sql` | `home_workplace`, nullable `role`, signup trigger, profile insert guard, `enter_education` |
| `supabase/general.sql` | Projects, members, teams, positions, grants, requests, invitations, fields, helpers, RPCs |
| `supabase/general-tasks.sql` | Tasks, assignees, comments, files, time logs, history, storage, project overview view |
| `supabase/general-notify.sql` | Notification types and triggers, deadline reminders, project conversations, admin counts |
| `supabase/tests/workplaces.test.sql` | Signup, `enter_education`, and the privilege guards |
| `supabase/tests/general.test.sql` | Membership, permissions, requests, invitations, join codes, fields |
| `supabase/tests/general-tasks.test.sql` | Task permissions, claiming, files, time, history, progress, archiving |
| `supabase/tests/general-notify.test.sql` | Notifications, project conversations, deadline reminders, admin counts |
| `src/components/auth/WorkplaceChoice.tsx` | The two workplace cards on registration and onboarding |
| `src/pages/auth/EnterEducation.tsx` | The one-time student or professor choice for an account with no role |
| `src/components/app/WorkplaceSwitcher.tsx` | The Education and General toggle in the top bar |
| `src/pages/general/GeneralHome.tsx` | Invitations, my projects, join by code, new project |
| `src/pages/general/GeneralProject.tsx` | Project header and the Overview, Tasks and Members tabs |
| `src/components/general/useGeneralProject.ts` | Loads and live-refreshes one project and everything about the viewer in it |
| `src/components/general/NewProjectDialog.tsx` | Create a project |
| `src/components/general/RequestAccessButton.tsx` | "Request access" wherever a permission is missing |
| `src/components/general/OverviewTab.tsx` | Core fields editor and the added fields panel |
| `src/components/general/FieldInput.tsx` | A typed input for one added field |
| `src/components/general/FieldDialog.tsx` | Add or edit an added field's name, type and options |
| `src/components/general/MembersTab.tsx` | Members, levels, extra permissions, removal and leaving |
| `src/components/general/InvitePanel.tsx` | Search people, invite, pending invitations, join code |
| `src/components/general/RequestsPanel.tsx` | Open access requests for Owners, and the viewer's own requests |
| `src/components/general/StructurePanel.tsx` | Teams and positions |
| `src/components/general/TasksTab.tsx` | Task filters, board and list, new task |
| `src/components/general/TaskDialog.tsx` | One task: edit, assignees, comments, files, time log, history |

Deleted: `src/lib/roleHome.ts`, replaced by `src/lib/workplace.ts`.

Modified: `src/lib/types.ts`, `src/context/AuthContext.tsx`, `src/routes/ProtectedRoute.tsx`, `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`, `src/pages/auth/Pending.tsx`, `src/pages/auth/AuthCallback.tsx`, `src/components/app/nav.ts`, `src/components/app/TopNav.tsx`, `src/components/app/AppShell.tsx`, `src/components/app/NotificationBell.tsx`, `src/pages/app/admin/Accounts.tsx`, `src/lib/api/messages.ts`, `src/components/messages/ConversationList.tsx`, `src/components/messages/MessageThread.tsx`, `src/pages/app/messages/Messages.tsx`, `src/pages/app/AdminHome.tsx`, `src/lib/limits.ts`, `src/App.tsx`, `supabase/rate-limit.sql`, `supabase/classes.sql`, `supabase/admin-rename.sql`, `supabase/approvals.sql`, `scripts/schema-drift.mjs`, `docs/07-backup.md`.

---

### Task 1: Access levels and permissions logic

**Files:**
- Create: `src/lib/general/permissions.ts`
- Test: `src/lib/general/permissions.test.ts`

**Interfaces:**
- Produces:
  - `type GeneralLevel = 'owner' | 'manager' | 'member'`
  - `type GeneralPermission = 'edit_project' | 'manage_members' | 'manage_structure' | 'manage_tasks' | 'edit_files'`
  - `PERMISSIONS: { value: GeneralPermission; label: string; note: string }[]`
  - `LEVELS: { value: GeneralLevel; label: string; note: string }[]`
  - `levelPermissions(level: GeneralLevel): GeneralPermission[]`
  - `can(level: GeneralLevel | null, grants: readonly GeneralPermission[], permission: GeneralPermission, archived?: boolean): boolean`
  - `requestable(level: GeneralLevel | null, grants: readonly GeneralPermission[], open: readonly GeneralPermission[]): GeneralPermission[]`
  - `canStepDown(level: GeneralLevel, ownerCount: number): boolean`
  - `permissionLabel(p: GeneralPermission): string`
  - `levelLabel(l: GeneralLevel): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/general/permissions.test.ts
import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  PERMISSIONS,
  can,
  canStepDown,
  levelLabel,
  levelPermissions,
  permissionLabel,
  requestable,
} from './permissions'

/**
 * These mirror `general_can()` in supabase/general.sql. When the two disagree a
 * member is shown a button the database refuses, so every rule here has a
 * matching assertion in supabase/tests/general.test.sql.
 */

describe('levelPermissions', () => {
  it('gives Owners and Managers every permission', () => {
    const all = PERMISSIONS.map((p) => p.value)
    expect(levelPermissions('owner')).toEqual(all)
    expect(levelPermissions('manager')).toEqual(all)
  })

  it('gives a Member none of them', () => {
    expect(levelPermissions('member')).toEqual([])
  })
})

describe('can', () => {
  it('lets a Manager manage tasks', () => {
    expect(can('manager', [], 'manage_tasks')).toBe(true)
  })

  it('refuses a Member without a grant', () => {
    expect(can('member', [], 'edit_files')).toBe(false)
  })

  it('lets a Member with a grant do exactly that', () => {
    expect(can('member', ['edit_files'], 'edit_files')).toBe(true)
    expect(can('member', ['edit_files'], 'manage_tasks')).toBe(false)
  })

  it('refuses somebody who is not a member at all', () => {
    expect(can(null, ['edit_files'], 'edit_files')).toBe(false)
  })

  it('refuses everybody on an archived project', () => {
    expect(can('owner', [], 'edit_project', true)).toBe(false)
  })
})

describe('requestable', () => {
  it('offers a Member everything not granted and not already asked for', () => {
    expect(requestable('member', ['edit_files'], ['manage_tasks'])).toEqual([
      'edit_project',
      'manage_members',
      'manage_structure',
    ])
  })

  it('offers an Owner or Manager nothing, because they hold it all', () => {
    expect(requestable('owner', [], [])).toEqual([])
    expect(requestable('manager', [], [])).toEqual([])
  })

  it('offers a non-member nothing', () => {
    expect(requestable(null, [], [])).toEqual([])
  })
})

describe('canStepDown', () => {
  it('stops the last Owner leaving', () => {
    expect(canStepDown('owner', 1)).toBe(false)
    expect(canStepDown('owner', 2)).toBe(true)
  })

  it('never stops a Manager or Member', () => {
    expect(canStepDown('manager', 1)).toBe(true)
    expect(canStepDown('member', 1)).toBe(true)
  })
})

describe('labels', () => {
  it('names every level and permission', () => {
    for (const l of LEVELS) expect(levelLabel(l.value)).toBe(l.label)
    for (const p of PERMISSIONS) expect(permissionLabel(p.value)).toBe(p.label)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/general/permissions.test.ts`
Expected: FAIL with `Failed to resolve import "./permissions"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/general/permissions.ts
/**
 * Who may do what inside a General workplace project.
 *
 * Two layers. A member's **level** (Owner, Manager, Member) gives a fixed set of
 * permissions, and an Owner can **grant** one member a single permission on top
 * of their level. Levels are the easy part to understand; grants are how a
 * Treasurer gets file editing without becoming a Manager.
 *
 * This file mirrors `general_can()` in supabase/general.sql, which is the
 * enforcement. Keep the two in step.
 */

export type GeneralLevel = 'owner' | 'manager' | 'member'

export type GeneralPermission =
  | 'edit_project'
  | 'manage_members'
  | 'manage_structure'
  | 'manage_tasks'
  | 'edit_files'

export const PERMISSIONS: { value: GeneralPermission; label: string; note: string }[] = [
  {
    value: 'edit_project',
    label: 'Edit project details',
    note: 'Change the name, dates, status, the points setting and every added field.',
  },
  {
    value: 'manage_members',
    label: 'Invite and remove members',
    note: 'Send and withdraw invitations, and remove Members from the project.',
  },
  {
    value: 'manage_structure',
    label: 'Manage teams and positions',
    note: 'Create, rename and remove teams and positions, and choose who is in them.',
  },
  {
    value: 'manage_tasks',
    label: 'Manage all tasks',
    note: "Edit, assign, reassign and remove anyone's tasks.",
  },
  {
    value: 'edit_files',
    label: 'Edit files on any task',
    note: 'Add and remove files on every task, not only the tasks you hold.',
  },
]

export const LEVELS: { value: GeneralLevel; label: string; note: string }[] = [
  {
    value: 'owner',
    label: 'Owner',
    note: 'Everything, plus access levels, access requests, archiving and ownership.',
  },
  { value: 'manager', label: 'Manager', note: 'Every permission, but not access or ownership.' },
  {
    value: 'member',
    label: 'Member',
    note: 'Sees the project, comments, and works on tasks. Can request more.',
  },
]

const ALL: GeneralPermission[] = PERMISSIONS.map((p) => p.value)

export function levelPermissions(level: GeneralLevel): GeneralPermission[] {
  return level === 'member' ? [] : [...ALL]
}

/** An archived project is read-only for everybody until an Owner restores it. */
export function can(
  level: GeneralLevel | null,
  grants: readonly GeneralPermission[],
  permission: GeneralPermission,
  archived = false,
): boolean {
  if (!level || archived) return false
  return levelPermissions(level).includes(permission) || grants.includes(permission)
}

/** What a member could still ask an Owner for. */
export function requestable(
  level: GeneralLevel | null,
  grants: readonly GeneralPermission[],
  open: readonly GeneralPermission[],
): GeneralPermission[] {
  if (level !== 'member') return []
  return ALL.filter((p) => !grants.includes(p) && !open.includes(p))
}

/** A project always keeps at least one Owner. */
export function canStepDown(level: GeneralLevel, ownerCount: number): boolean {
  return level !== 'owner' || ownerCount > 1
}

export function permissionLabel(p: GeneralPermission): string {
  return PERMISSIONS.find((x) => x.value === p)?.label ?? p
}

export function levelLabel(l: GeneralLevel): string {
  return LEVELS.find((x) => x.value === l)?.label ?? l
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/general/permissions.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/permissions.ts src/lib/general/permissions.test.ts
git commit -m "Add General workplace access levels and permissions logic"
```

---

### Task 2: Added field types and value validation

**Files:**
- Create: `src/lib/general/fields.ts`
- Test: `src/lib/general/fields.test.ts`

**Interfaces:**
- Produces:
  - `type FieldType = 'short_text' | 'long_text' | 'number' | 'money' | 'date' | 'single_choice' | 'multi_choice' | 'yes_no' | 'member' | 'link'`
  - `type FieldValue = string | number | boolean | string[]`
  - `FIELD_TYPES: { value: FieldType; label: string; hint: string }[]`
  - `FIELD_LIMIT: { name: 80; shortText: 200; longText: 10000; link: 2000; option: 80; options: 50; number: 1e12 }`
  - `isChoice(type: FieldType): boolean`
  - `isEmptyValue(raw: unknown): boolean`
  - `checkFieldValue(type: FieldType, raw: unknown, ctx: { options: string[]; memberIds: string[] }): { ok: true; value: FieldValue } | { ok: false; error: string }`
  - `checkOptions(type: FieldType, options: string[]): string | null`
  - `formatFieldValue(type: FieldType, value: FieldValue, nameOf: (id: string) => string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/general/fields.test.ts
import { describe, expect, it } from 'vitest'
import {
  FIELD_TYPES,
  checkFieldValue,
  checkOptions,
  formatFieldValue,
  isChoice,
  isEmptyValue,
} from './fields'

/**
 * Mirrors `guard_general_field_value()` in supabase/general.sql. The form checks
 * first so somebody sees the reason before the database refuses the save.
 */

const ctx = { options: ['Gym', 'Covered court'], memberIds: ['u1', 'u2'] }
const ok = (type: Parameters<typeof checkFieldValue>[0], raw: unknown) =>
  checkFieldValue(type, raw, ctx)

describe('FIELD_TYPES', () => {
  it('lists the ten types the spec names', () => {
    expect(FIELD_TYPES.map((t) => t.value)).toEqual([
      'short_text',
      'long_text',
      'number',
      'money',
      'date',
      'single_choice',
      'multi_choice',
      'yes_no',
      'member',
      'link',
    ])
  })

  it('knows which types carry options', () => {
    expect(isChoice('single_choice')).toBe(true)
    expect(isChoice('multi_choice')).toBe(true)
    expect(isChoice('short_text')).toBe(false)
  })
})

describe('isEmptyValue', () => {
  it('treats blank input as no value', () => {
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue([])).toBe(true)
  })

  it('keeps false and zero, which are answers', () => {
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
  })
})

describe('checkFieldValue', () => {
  it('trims text and caps its length', () => {
    expect(ok('short_text', '  Venue  ')).toEqual({ ok: true, value: 'Venue' })
    expect(ok('short_text', 'x'.repeat(201)).ok).toBe(false)
    expect(ok('long_text', 'x'.repeat(10000)).ok).toBe(true)
    expect(ok('long_text', 'x'.repeat(10001)).ok).toBe(false)
  })

  it('reads a number from a form string', () => {
    expect(ok('number', '42')).toEqual({ ok: true, value: 42 })
    expect(ok('number', 'forty').ok).toBe(false)
  })

  it('keeps money at or above zero with two decimals at most', () => {
    expect(ok('money', '1500.50')).toEqual({ ok: true, value: 1500.5 })
    expect(ok('money', '0.07')).toEqual({ ok: true, value: 0.07 })
    expect(ok('money', '-1').ok).toBe(false)
    expect(ok('money', '10.505').ok).toBe(false)
  })

  it('accepts a real calendar date only', () => {
    expect(ok('date', '2026-10-12')).toEqual({ ok: true, value: '2026-10-12' })
    expect(ok('date', '2026-02-30').ok).toBe(false)
    expect(ok('date', '12/10/2026').ok).toBe(false)
  })

  it('holds a choice to the options', () => {
    expect(ok('single_choice', 'Gym')).toEqual({ ok: true, value: 'Gym' })
    expect(ok('single_choice', 'Field').ok).toBe(false)
    expect(ok('multi_choice', ['Gym', 'Covered court'])).toEqual({
      ok: true,
      value: ['Gym', 'Covered court'],
    })
    expect(ok('multi_choice', ['Gym', 'Gym']).ok).toBe(false)
    expect(ok('multi_choice', ['Field']).ok).toBe(false)
  })

  it('takes yes or no as a boolean', () => {
    expect(ok('yes_no', false)).toEqual({ ok: true, value: false })
    expect(ok('yes_no', 'yes').ok).toBe(false)
  })

  it('holds a member field to the project', () => {
    expect(ok('member', 'u1')).toEqual({ ok: true, value: 'u1' })
    expect(ok('member', 'stranger').ok).toBe(false)
  })

  it('takes web links only', () => {
    expect(ok('link', 'https://dyci.edu.ph')).toEqual({ ok: true, value: 'https://dyci.edu.ph' })
    expect(ok('link', 'javascript:alert(1)').ok).toBe(false)
    expect(ok('link', 'dyci.edu.ph').ok).toBe(false)
  })
})

describe('checkOptions', () => {
  it('needs at least one distinct option for a choice', () => {
    expect(checkOptions('single_choice', [])).not.toBeNull()
    expect(checkOptions('single_choice', ['Gym', 'gym'])).not.toBeNull()
    expect(checkOptions('single_choice', ['Gym', ' '])).not.toBeNull()
    expect(checkOptions('multi_choice', ['Gym', 'Court'])).toBeNull()
  })

  it('refuses options on a type that has none', () => {
    expect(checkOptions('short_text', ['Gym'])).not.toBeNull()
    expect(checkOptions('short_text', [])).toBeNull()
  })
})

describe('formatFieldValue', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'Ana Reyes' : 'Somebody')

  it('shows pesos, yes or no, names and lists', () => {
    expect(formatFieldValue('money', 1500.5, nameOf)).toBe('₱1,500.50')
    expect(formatFieldValue('yes_no', true, nameOf)).toBe('Yes')
    expect(formatFieldValue('member', 'u1', nameOf)).toBe('Ana Reyes')
    expect(formatFieldValue('multi_choice', ['Gym', 'Court'], nameOf)).toBe('Gym, Court')
  })

  it('shows a date without shifting it a day', () => {
    expect(formatFieldValue('date', '2026-10-12', nameOf)).toBe('Oct 12, 2026')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/general/fields.test.ts`
Expected: FAIL with `Failed to resolve import "./fields"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/general/fields.ts
/**
 * The fields a project creator adds on top of the core ones.
 *
 * A value is stored as JSON, so the database cannot lean on column types to
 * keep it honest. `guard_general_field_value()` in supabase/general.sql checks
 * every rule below; this file runs the same checks first so the form can say
 * what is wrong before a save is refused. Keep the two in step.
 */

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'money'
  | 'date'
  | 'single_choice'
  | 'multi_choice'
  | 'yes_no'
  | 'member'
  | 'link'

export type FieldValue = string | number | boolean | string[]

export const FIELD_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: 'short_text', label: 'Short text', hint: 'A name, a venue, a code' },
  { value: 'long_text', label: 'Long text', hint: 'Notes, objectives, a rationale' },
  { value: 'number', label: 'Number', hint: 'A count or a measurement' },
  { value: 'money', label: 'Money', hint: 'An amount in pesos' },
  { value: 'date', label: 'Date', hint: 'A single day' },
  { value: 'single_choice', label: 'Single choice', hint: 'One option from a list you write' },
  { value: 'multi_choice', label: 'Multiple choice', hint: 'Any options from a list you write' },
  { value: 'yes_no', label: 'Yes or no', hint: 'A simple answer' },
  { value: 'member', label: 'Project member', hint: 'One person on this project' },
  { value: 'link', label: 'Link', hint: 'A web address' },
]

export const FIELD_LIMIT = {
  name: 80,
  shortText: 200,
  longText: 10000,
  link: 2000,
  option: 80,
  options: 50,
  number: 1e12,
} as const

type Check = { ok: true; value: FieldValue } | { ok: false; error: string }

const fail = (error: string): Check => ({ ok: false, error })

export function isChoice(type: FieldType) {
  return type === 'single_choice' || type === 'multi_choice'
}

export function isEmptyValue(raw: unknown) {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string') return raw.trim() === ''
  if (Array.isArray(raw)) return raw.length === 0
  return false
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function realDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function checkFieldValue(
  type: FieldType,
  raw: unknown,
  ctx: { options: string[]; memberIds: string[] },
): Check {
  switch (type) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') return fail('Write some text.')
      const text = raw.trim()
      const max = type === 'short_text' ? FIELD_LIMIT.shortText : FIELD_LIMIT.longText
      if (!text) return fail('Write some text.')
      if (text.length > max) return fail(`Keep this under ${max.toLocaleString()} characters.`)
      return { ok: true, value: text }
    }
    case 'number': {
      const n = toNumber(raw)
      if (n === null) return fail('Enter a number.')
      if (Math.abs(n) > FIELD_LIMIT.number) return fail('That number is too large.')
      return { ok: true, value: n }
    }
    case 'money': {
      const n = toNumber(raw)
      if (n === null) return fail('Enter an amount.')
      if (n < 0) return fail('An amount cannot be negative.')
      if (n > FIELD_LIMIT.number) return fail('That amount is too large.')
      // A tolerance, not strict equality: 0.07 * 100 is 7.000000000000001.
      if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return fail('Use at most two decimal places.')
      return { ok: true, value: n }
    }
    case 'date': {
      if (typeof raw !== 'string' || !realDate(raw)) return fail('Pick a date.')
      return { ok: true, value: raw }
    }
    case 'single_choice': {
      if (typeof raw !== 'string' || !ctx.options.includes(raw)) return fail('Pick one of the options.')
      return { ok: true, value: raw }
    }
    case 'multi_choice': {
      if (!Array.isArray(raw) || raw.length === 0) return fail('Pick at least one option.')
      if (!raw.every((o) => typeof o === 'string' && ctx.options.includes(o)))
        return fail('Pick from the options.')
      if (new Set(raw).size !== raw.length) return fail('Each option can be picked once.')
      return { ok: true, value: raw as string[] }
    }
    case 'yes_no': {
      if (typeof raw !== 'boolean') return fail('Choose yes or no.')
      return { ok: true, value: raw }
    }
    case 'member': {
      if (typeof raw !== 'string' || !ctx.memberIds.includes(raw))
        return fail('Pick somebody on this project.')
      return { ok: true, value: raw }
    }
    case 'link': {
      if (typeof raw !== 'string') return fail('Paste a web address.')
      const text = raw.trim()
      if (text.length > FIELD_LIMIT.link) return fail('That address is too long.')
      if (!/^https?:\/\/\S+$/i.test(text)) return fail('Start the address with http:// or https://.')
      try {
        new URL(text)
      } catch {
        return fail('That is not a web address.')
      }
      return { ok: true, value: text }
    }
  }
}

/** Null when the options suit the type, otherwise the reason they do not. */
export function checkOptions(type: FieldType, options: string[]): string | null {
  if (!isChoice(type)) return options.length === 0 ? null : 'Only choice fields have options.'
  if (options.length === 0) return 'Add at least one option.'
  if (options.length > FIELD_LIMIT.options) return `Keep it to ${FIELD_LIMIT.options} options.`
  const seen = new Set<string>()
  for (const option of options) {
    const text = option.trim()
    if (!text) return 'An option cannot be blank.'
    if (text.length > FIELD_LIMIT.option) return `Keep each option under ${FIELD_LIMIT.option} characters.`
    const key = text.toLowerCase()
    if (seen.has(key)) return `"${text}" is listed twice.`
    seen.add(key)
  }
  return null
}

const PESOS = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export function formatFieldValue(
  type: FieldType,
  value: FieldValue,
  nameOf: (id: string) => string,
): string {
  switch (type) {
    case 'money':
      return PESOS.format(Number(value))
    case 'date': {
      const [y, m, d] = String(value).split('-').map(Number)
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }
    case 'yes_no':
      return value ? 'Yes' : 'No'
    case 'multi_choice':
      return (value as string[]).join(', ')
    case 'member':
      return nameOf(String(value))
    case 'number':
      return Number(value).toLocaleString('en-US')
    default:
      return String(value)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/general/fields.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/fields.ts src/lib/general/fields.test.ts
git commit -m "Add General workplace field types and value validation"
```

---

### Task 3: Project progress with points on and off

**Files:**
- Create: `src/lib/general/progress.ts`
- Test: `src/lib/general/progress.test.ts`

**Interfaces:**
- Produces:
  - `type GeneralTaskStatus = 'todo' | 'in_progress' | 'done'`
  - `type ProgressTask = { status: GeneralTaskStatus; weight: number }`
  - `projectProgress(tasks: readonly ProgressTask[], pointsEnabled: boolean): { pct: number; done: number; total: number }`
  - `taskShare(weight: number, tasks: readonly ProgressTask[]): number`
  - `TASK_STATUSES: { value: GeneralTaskStatus; label: string }[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/general/progress.test.ts
import { describe, expect, it } from 'vitest'
import { TASK_STATUSES, projectProgress, taskShare } from './progress'

/** Mirrors `progress_pct` in `general_project_overview`, supabase/general-tasks.sql. */

const tasks = [
  { status: 'done' as const, weight: 3 },
  { status: 'in_progress' as const, weight: 1 },
  { status: 'todo' as const, weight: 4 },
]

describe('projectProgress', () => {
  it('counts finished tasks when points are off', () => {
    expect(projectProgress(tasks, false)).toEqual({ pct: 33.3, done: 1, total: 3 })
  })

  it('weighs finished tasks when points are on', () => {
    expect(projectProgress(tasks, true)).toEqual({ pct: 37.5, done: 1, total: 3 })
  })

  it('reads an empty project as zero, not as a division by zero', () => {
    expect(projectProgress([], true)).toEqual({ pct: 0, done: 0, total: 0 })
    expect(projectProgress([], false)).toEqual({ pct: 0, done: 0, total: 0 })
  })
})

describe('taskShare', () => {
  it('is the task weight as a share of 100', () => {
    expect(taskShare(3, tasks)).toBe(37.5)
  })

  it('is zero on an empty project', () => {
    expect(taskShare(1, [])).toBe(0)
  })
})

describe('TASK_STATUSES', () => {
  it('lists the three stages in order', () => {
    expect(TASK_STATUSES.map((s) => s.label)).toEqual(['To do', 'In progress', 'Done'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/general/progress.test.ts`
Expected: FAIL with `Failed to resolve import "./progress"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/general/progress.ts
/**
 * How far a General project has got.
 *
 * Points are a project setting. On, the project is worth 100 and each task's
 * weight is its slice, exactly as an Education board works. Off, every task
 * counts the same, which is what a school event committee usually wants.
 */

export type GeneralTaskStatus = 'todo' | 'in_progress' | 'done'

export type ProgressTask = { status: GeneralTaskStatus; weight: number }

export const TASK_STATUSES: { value: GeneralTaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const round1 = (n: number) => Math.round(n * 10) / 10

export function projectProgress(tasks: readonly ProgressTask[], pointsEnabled: boolean) {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  if (total === 0) return { pct: 0, done: 0, total: 0 }
  if (!pointsEnabled) return { pct: round1((done / total) * 100), done, total }
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  const finished = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + Number(t.weight), 0)
  return { pct: all === 0 ? 0 : round1((finished / all) * 100), done, total }
}

export function taskShare(weight: number, tasks: readonly ProgressTask[]) {
  const all = tasks.reduce((n, t) => n + Number(t.weight), 0)
  return all === 0 ? 0 : round1((weight / all) * 100)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/general/progress.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/progress.ts src/lib/general/progress.test.ts
git commit -m "Add General workplace progress logic"
```

---

### Task 4: Two workplaces in the database

**Files:**
- Create: `supabase/workplaces.sql`
- Create: `supabase/tests/workplaces.test.sql`
- Modify: `supabase/rate-limit.sql` (`join_class`, the last definition), `supabase/classes.sql:257` (the earlier copy)
- Modify: `supabase/admin-rename.sql:84` (`decide_professor`, the last definition), `supabase/approvals.sql:50` (the earlier copy)
- Modify: `scripts/schema-drift.mjs` (`ORDER`), `docs/07-backup.md` (rebuild command)

**Interfaces:**
- Produces:
  - `public.workplace` enum `('education', 'general')`
  - `profiles.home_workplace public.workplace not null default 'education'`
  - `profiles.role` nullable, with no default. Null means the account has not entered Education.
  - Signup metadata key `workplace`. `'general'` creates a profile with `role = null`, `status = 'active'` and `home_workplace = 'general'`.
  - `public.enter_education(p_role public.user_role) returns public.profiles`
  - `public.guard_profile_insert()` trigger `profiles_guard_insert`. A signed-in non-admin inserting their own profile gets `status` derived from `role`, and cannot insert `role = 'admin'`.

**Why the extra fixes:** making `role` nullable breaks two checks written as `role <> 'x'`, because `null <> 'student'` is null and an `if` on null does not fire.
- `join_class` would let an account with no role join a class as if it were a student.
- `decide_professor` would let an admin "approve" an account that is not a professor.

Both become `is distinct from`. Separately, `profiles_insert_own` (`supabase/schema.sql:146`) checks only `id = auth.uid()`. A Google account with no profile yet can therefore insert itself as an active admin today. This task closes that with an insert guard, because this task is already redefining how a profile comes into being.

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/workplaces.test.sql
-- Two workplaces — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/workplaces.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.

begin;

-- ------------------------------------------------------------------ helpers

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_gen uuid := gen_random_uuid();   -- registered for General
  v_gen2 uuid := gen_random_uuid();  -- registered for General, never enters Education
  v_prof uuid := gen_random_uuid();  -- registered for Education as a professor
  v_bare uuid := gen_random_uuid();  -- a Google account with no profile yet
  v_bare2 uuid := gen_random_uuid(); -- another one, for the control
  v_admin uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values
    (v_gen, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-gen@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'General', 'workplace', 'general'),
     now(), now()),
    (v_gen2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-gen2@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'Generaltwo', 'workplace', 'general'),
     now(), now()),
    (v_prof, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-prof@example.test', '',
     jsonb_build_object('first_name', 'Zz', 'last_name', 'Prof', 'role', 'professor'),
     now(), now()),
    (v_bare, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-bare@example.test', '', '{}'::jsonb, now(), now()),
    (v_bare2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-ws-bare2@example.test', '', '{}'::jsonb, now(), now());

  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values ('gen', v_gen), ('gen2', v_gen2), ('prof', v_prof),
                        ('bare', v_bare), ('bare2', v_bare2), ('admin', v_admin);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ signup

do $$
declare
  v_gen uuid := (select v from fx where k = 'gen');
  v_prof uuid := (select v from fx where k = 'prof');
  v_bare uuid := (select v from fx where k = 'bare');
begin
  perform pg_temp.must_be('a General signup gets no role',
    (select role is null from public.profiles where id = v_gen));
  perform pg_temp.must_be('a General signup is active straight away',
    (select status = 'active' from public.profiles where id = v_gen));
  perform pg_temp.must_be('a General signup lands in General',
    (select home_workplace = 'general' from public.profiles where id = v_gen));

  perform pg_temp.must_be('an Education professor signup is still pending',
    (select role = 'professor' and status = 'pending' and home_workplace = 'education'
       from public.profiles where id = v_prof));

  perform pg_temp.must_be('a Google account still gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ inserting your own profile

do $$
declare
  v_bare uuid := (select v from fx where k = 'bare');
  v_bare2 uuid := (select v from fx where k = 'bare2');
begin
  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_refuse('onboarding cannot make you an admin', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-ws-bare@example.test', 'Zz', 'Bare', 'admin', 'active')$q$, v_bare));

  perform pg_temp.act_as(v_bare2);
  perform pg_temp.must_allow('onboarding as a professor is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-ws-bare2@example.test', 'Zz', 'Baretwo', 'professor', 'active')$q$, v_bare2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...but claiming active does not skip approval',
    (select status = 'pending' from public.profiles where id = v_bare2));

  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_allow('onboarding into General with no role is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status, home_workplace)
       values (%L, 'zz-ws-bare@example.test', 'Zz', 'Bare', null, 'pending', 'general')$q$, v_bare));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and it is active, whatever status was sent',
    (select status = 'active' and role is null from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ Education needs a role

do $$
declare
  v_gen uuid := (select v from fx where k = 'gen');
  v_gen2 uuid := (select v from fx where k = 'gen2');
  v_admin uuid := (select v from fx where k = 'admin');
  v_prof uuid := (select v from fx where k = 'prof');
  v_code text := (select code from public.classes where archived_at is null order by created_at limit 1);
  v_student uuid := (select id from public.profiles where role = 'student' and status = 'active'
                      order by created_at limit 1);
  v_result text;
begin
  perform pg_temp.act_as(v_gen);
  select public.join_class(v_code) ->> 'result' into v_result;
  perform pg_temp.must_be('an account with no role cannot join a class', v_result = 'not_student');

  perform pg_temp.act_as(v_student);
  select public.join_class(v_code) ->> 'result' into v_result;
  perform pg_temp.must_be('...while a student gets past the role check', v_result <> 'not_student');

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse('an admin cannot approve an account with no role as a professor',
    format('select public.decide_professor(%L, true)', v_gen2));
  perform pg_temp.must_allow('...but still approves a real professor',
    format('select public.decide_professor(%L, true)', v_prof));

  perform pg_temp.act_as(v_gen);
  update public.profiles set role = 'professor', status = 'active' where id = v_gen;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('writing your own role directly is pinned back',
    (select role is null and status = 'active' from public.profiles where id = v_gen));

  perform pg_temp.act_as(v_gen);
  perform pg_temp.must_refuse('enter_education refuses admin', $q$select public.enter_education('admin')$q$);
  perform pg_temp.must_allow('enter_education accepts professor', $q$select public.enter_education('professor')$q$);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the new professor waits for approval',
    (select role = 'professor' and status = 'pending' and home_workplace = 'general'
       from public.profiles where id = v_gen));

  perform pg_temp.act_as(v_gen);
  perform pg_temp.must_refuse('enter_education only works once', $q$select public.enter_education('student')$q$);

  -- enter_education raised a transaction-local flag above. If it forgot to lower
  -- it, this write would slip through, because it is the same transaction.
  perform pg_temp.act_as(v_gen2);
  update public.profiles set role = 'student', status = 'active' where id = v_gen2;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the bypass flag does not leak into a later statement',
    (select role is null from public.profiles where id = v_gen2));
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run (in the prepared shell): `node scripts/db.mjs supabase/tests/workplaces.test.sql`
Expected: FAIL. The first assertion stops the run, because `home_workplace` does not exist yet: `column "home_workplace" does not exist`.

- [ ] **Step 3: Fix the two null-unsafe role checks in place**

In `supabase/rate-limit.sql`, inside `join_class`, and in the earlier copy at `supabase/classes.sql:257`:

```sql
  if caller.role is distinct from 'student' then
    return jsonb_build_object('result', 'not_student');
  end if;
```

In `supabase/admin-rename.sql`, inside `decide_professor`, and in the earlier copy at `supabase/approvals.sql:50`:

```sql
  if target.role is distinct from 'professor' then
    raise exception 'Only professor accounts go through approval'
      using errcode = 'check_violation';
  end if;
```

- [ ] **Step 4: Write `supabase/workplaces.sql`**

```sql
-- Collabify — two workplaces.
--
--   node scripts/db.mjs supabase/workplaces.sql
--
-- Everything that existed before this file is the Education workplace. The
-- General workplace is for projects anybody at the school runs, and needs no
-- student or professor role. One account uses both; `home_workplace` is only
-- where sign-in lands.
--
-- `role` becomes nullable: null means the account has not entered Education.
-- Entering it later goes through `enter_education`, once, and a professor still
-- waits for approval exactly as at registration.
--
-- Runs after consent.sql, whose `handle_new_user` this redefines as a superset,
-- and after admin-rename.sql, whose `guard_privileged_columns` it redefines.

begin;

do $$ begin
  create type public.workplace as enum ('education', 'general');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists home_workplace public.workplace not null default 'education';

alter table public.profiles alter column role drop not null;
alter table public.profiles alter column role drop default;

-- ---------------------------------------------------------------- privilege guard

/**
 * Role and status are the admin's to set, with one exception: an account that
 * has no role may take student or professor once, through `enter_education`.
 * That function raises a transaction-local flag; the flag is not reachable
 * through the REST interface, and even with it the guard still insists the
 * status matches the role, so a professor can never arrive active.
 */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    if old.role is null
       and old.status = 'active'
       and current_setting('collabify.enter_education', true) = 'on'
       and new.role in ('student', 'professor')
       and new.status = case when new.role = 'professor' then 'pending' else 'active' end
                        ::public.account_status then
      return new;
    end if;
    -- Pinned back rather than raised: a client that tries this is not owed an
    -- error message describing the rule it just failed to break.
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

/**
 * Onboarding writes the profile row itself, and `profiles_insert_own` checks
 * nothing but the id. Without this a Google account could insert itself as an
 * active admin, or as a professor who skipped approval.
 */
create or replace function public.guard_profile_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'You can only create your own profile'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is not null and new.role not in ('student', 'professor') then
    raise exception 'Choose student or professor'
      using errcode = 'check_violation';
  end if;
  new.status := case when new.role = 'professor' then 'pending' else 'active' end
                ::public.account_status;
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert before insert on public.profiles
  for each row execute function public.guard_profile_insert();

-- ---------------------------------------------------------------- signup

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  meta_workplace text := nullif(new.raw_user_meta_data ->> 'workplace', '');
  resolved_role public.user_role;
  doc text;
  ver text;
begin
  /**
   * Consent first, and outside the role check.
   *
   * A Google account arrives with no role and returns early below, but it can
   * still carry consent versions if it ever comes through a path that collects
   * them. Putting this after the early return would make that silently do
   * nothing.
   */
  foreach doc in array array['privacy', 'terms'] loop
    ver := nullif(new.raw_user_meta_data ->> ('consent_' || doc), '');
    if ver is not null then
      if not exists (
        select 1 from public.legal_versions
         where document = doc and version = ver
      ) then
        raise exception
          'Consent to unpublished % version %. Add it to legal_versions in supabase/consent.sql.',
          doc, ver
          using errcode = 'foreign_key_violation';
      end if;

      insert into public.consent_records (user_id, document, version, surface)
      values (new.id, doc, ver, 'register')
      on conflict (user_id, document, version) do nothing;
    end if;
  end loop;

  -- General needs no role, and nobody approves it.
  if meta_workplace = 'general' then
    insert into public.profiles
      (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
    values (
      new.id,
      coalesce(new.email, ''),
      coalesce(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'middle_name', ''),
      coalesce(new.raw_user_meta_data ->> 'last_name', ''),
      null,
      'active',
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      'general'
    )
    on conflict (id) do nothing;

    insert into public.notification_prefs (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
  end if;

  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles
    (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'education'
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- entering Education

create or replace function public.enter_education(p_role public.user_role)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('student', 'professor') then
    raise exception 'Choose student or professor' using errcode = 'check_violation';
  end if;

  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then
    raise exception 'Finish setting up your account first';
  end if;
  if me.status = 'rejected' then
    raise exception 'This account is deactivated. Contact the program admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if me.role is not null then
    raise exception 'You already have a role in Education. The program admin can change it.'
      using errcode = 'check_violation';
  end if;

  perform set_config('collabify.enter_education', 'on', true);
  update public.profiles
     set role = p_role,
         status = case when p_role = 'professor' then 'pending' else 'active' end
                  ::public.account_status
   where id = auth.uid()
  returning * into me;
  perform set_config('collabify.enter_education', 'off', true);

  return me;
end;
$$;

grant execute on function public.enter_education(public.user_role) to authenticated;

commit;
```

- [ ] **Step 5: Add the file to the rebuild order**

In `scripts/schema-drift.mjs`, change the last line of `ORDER`:

```js
consent privacy-requests term-shifts hardening workplaces`.split(/\s+/)
```

In `docs/07-backup.md`, append ` supabase/workplaces.sql` to the end of the rebuild command, after `supabase/hardening.sql`.

- [ ] **Step 6: Apply and run the tests**

Run, in the prepared shell:

```bash
node scripts/db.mjs supabase/rate-limit.sql supabase/admin-rename.sql supabase/workplaces.sql
node scripts/db.mjs supabase/tests/workplaces.test.sql
```

Expected: every line prints `PASS`, 20 of them, ending with `the bypass flag does not leak into a later statement`.

Then confirm nothing else regressed:

```bash
node scripts/db.mjs supabase/tests/accounts.test.sql supabase/tests/approvals.test.sql supabase/tests/rate-limit.test.sql
node scripts/schema-drift.mjs
```

Expected: every test file passes. The drift report lists `function handle_new_user schema -> consent -> workplaces`, `function guard_privileged_columns schema -> admin-rename -> workplaces`, and `function join_class classes -> rate-limit`.

- [ ] **Step 7: Commit**

```bash
git add supabase/workplaces.sql supabase/tests/workplaces.test.sql supabase/rate-limit.sql supabase/classes.sql supabase/admin-rename.sql supabase/approvals.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add the General workplace to accounts and close the profile insert gap"
```

---

### Task 5: General projects, membership and permissions in the database

**Files:**
- Create: `supabase/general.sql`
- Create: `supabase/tests/general.test.sql`
- Modify: `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Consumes: `public.touch_updated_at()` (`supabase/schema.sql`), `public.rate_limit(text, integer, interval, text)` (`supabase/rate-limit.sql`), and `public.is_admin()`.
- Produces, as tables:
  - `general_projects(id, name, description, starts_on, ends_on, status, points_enabled, created_by, archived_at, created_at, updated_at)`
  - `general_join_codes(project_id, code, open, updated_at)`, readable only by people who can invite
  - `general_members(project_id, user_id, level, joined_at)`
  - `general_teams(id, project_id, name, created_at)` and `general_team_members(team_id, project_id, user_id)`
  - `general_positions(id, project_id, team_id, name, sort, created_at)` and `general_position_holders(position_id, project_id, user_id)`
  - `general_grants(project_id, user_id, permission, granted_by, granted_at)`
  - `general_access_requests(id, project_id, user_id, permission, reason, status, answered_by, answered_at, note, created_at)`
  - `general_invitations(id, project_id, invitee, invited_by, status, created_at, answered_at)`
  - `general_fields(id, project_id, name, type, options, sort, created_at)` and `general_field_values(field_id, value, updated_by, updated_at)`
- Produces, as helpers: `is_general_member(uuid)`, `is_general_owner(uuid)`, `general_is_archived(uuid)`, `general_has(uuid, general_permission)` (ignores archiving, used for reading), `general_can(uuid, general_permission)` (false on an archived project, used for writing), `shares_general_project_with(uuid)`, `general_permission_label(general_permission)`.
- Produces, as RPCs:
  - `create_general_project(p_name text, p_description text, p_starts_on date, p_ends_on date) returns general_projects`
  - `search_general_people(p_query text) returns table(person_id uuid, first_name text, last_name text, avatar_url text, email text)`
  - `invite_to_general_project(p_project uuid, p_user uuid) returns general_invitations`
  - `withdraw_general_invitation(p_invitation uuid) returns void`
  - `respond_general_invitation(p_invitation uuid, p_accept boolean) returns general_invitations`
  - `set_general_join_code(p_project uuid, p_open boolean, p_regenerate boolean) returns text`
  - `join_general_project(p_code text) returns uuid`
  - `set_general_member_level(p_project uuid, p_user uuid, p_level general_level) returns void`
  - `remove_general_member(p_project uuid, p_user uuid) returns void`
  - `leave_general_project(p_project uuid) returns void`
  - `grant_general_permission(p_project uuid, p_user uuid, p_permission general_permission) returns void`
  - `revoke_general_permission(p_project uuid, p_user uuid, p_permission general_permission) returns void`
  - `request_general_access(p_project uuid, p_permission general_permission, p_reason text) returns general_access_requests`
  - `answer_general_access_request(p_request uuid, p_approve boolean, p_note text) returns general_access_requests`
  - `withdraw_general_access_request(p_request uuid) returns void`
  - `archive_general_project(p_project uuid, p_archived boolean) returns general_projects`

**Rules this file enforces** (each has a test):
- Only members read a project and everything in it. Somebody holding a pending invitation also reads the project row, so they can see what they are invited to.
- Owners and Managers hold every permission. A Member holds only what was granted. `general_can` is false for everyone on an archived project.
- Members, levels, grants, requests, invitations, join codes and archiving change only through the RPCs above. Those tables have no insert, update or delete policy.
- Teams, positions and the people in them change directly under `general_can(project, 'manage_structure')`. Fields and their values change under `general_can(project, 'edit_project')`.
- A project always keeps at least one Owner.
- A field's type cannot change once it holds a value, and an option that is still chosen cannot be removed.
- Every added-field value is validated by type, mirroring `src/lib/general/fields.ts`.

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/general.test.sql
-- General projects — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/general.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- An RLS-filtered UPDATE changes zero rows without an error, so those checks
-- read the row back instead of expecting a refusal.

begin;

-- ------------------------------------------------------------------ helpers

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

-- Five fresh General accounts, so nothing depends on who happens to be in the
-- database. Requires supabase/workplaces.sql.
do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  i int;
  v_project uuid;
begin
  for i in 1..5 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-gen-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzgen', 'last_name', v_names[i],
                               'workplace', 'general'),
            now(), now());
  end loop;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values ('a', v_ids[1]), ('b', v_ids[2]), ('c', v_ids[3]),
                        ('d', v_ids[4]), ('e', v_ids[5]);

  perform pg_temp.act_as(v_ids[1]);
  select (public.create_general_project('Zz Intramurals', 'Sports week', '2026-10-01', '2026-10-05')).id
    into v_project;
  perform pg_temp.act_as_service();
  insert into fx values ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ creating and reading

do $$
declare
  a uuid := (select v from fx where k = 'a');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.must_be('the creator is the Owner',
    exists (select 1 from public.general_members where project_id = p and user_id = a and level = 'owner'));

  perform pg_temp.act_as(c);
  perform pg_temp.must_be('a non-member cannot read the project',
    not exists (select 1 from public.general_projects where id = p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('...while a member can',
    exists (select 1 from public.general_projects where id = p));

  perform pg_temp.must_refuse('a project cannot end before it starts',
    $q$select public.create_general_project('Zz Backwards', '', '2026-10-05', '2026-10-01')$q$);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ invitations

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  inv uuid;
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('a non-member cannot invite',
    format('select public.invite_to_general_project(%L, %L)', p, d));

  perform pg_temp.act_as(a);
  select id into inv from public.invite_to_general_project(p, b);
  perform pg_temp.must_be('an Owner can invite', inv is not null);

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('the invited person can see the project they are invited to',
    exists (select 1 from public.general_projects where id = p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('somebody else cannot answer the invitation',
    format('select public.respond_general_invitation(%L, true)', inv));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('the invited person accepts',
    format('select public.respond_general_invitation(%L, true)', inv));
  perform pg_temp.must_be('...and becomes a Member',
    exists (select 1 from public.general_members where project_id = p and user_id = b and level = 'member'));

  perform pg_temp.must_refuse('a Member cannot invite',
    format('select public.invite_to_general_project(%L, %L)', p, c));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner makes them a Manager',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'manager'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('a Manager can invite',
    format('select public.invite_to_general_project(%L, %L)', p, c));
  perform pg_temp.must_refuse('a Manager cannot change access levels',
    format('select public.set_general_member_level(%L, %L, %L)', p, a, 'member'));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner sets them back to Member',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'member'));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ editing and extra permissions

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as(b);
  update public.general_projects set name = 'Zz Renamed by a Member' where id = p;
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('a Member cannot rename the project',
    (select name = 'Zz Intramurals' from public.general_projects where id = p));
  update public.general_projects set name = 'Zz Intramurals 2026' where id = p;
  perform pg_temp.must_be('...while an Owner can',
    (select name = 'Zz Intramurals 2026' from public.general_projects where id = p));

  perform pg_temp.must_refuse('a join code cannot be written directly',
    format($q$insert into public.general_join_codes (project_id, code, open) values (%L, 'ABCDEFGH', true)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a Member without the permission cannot add a team',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Logistics')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner grants manage_structure',
    format('select public.grant_general_permission(%L, %L, %L)', p, b, 'manage_structure'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('...and now the Member can add a team',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Logistics')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner revokes it',
    format('select public.revoke_general_permission(%L, %L, %L)', p, b, 'manage_structure'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('...and the Member cannot add a team again',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Sports')$q$, p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ access requests

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  req uuid;
begin
  perform pg_temp.act_as(b);
  select id into req from public.request_general_access(p, 'edit_files', 'I keep the receipts');
  perform pg_temp.must_be('a Member can request a permission', req is not null);
  perform pg_temp.must_refuse('a second request for the same permission is refused while the first is open',
    format('select public.request_general_access(%L, %L, %L)', p, 'edit_files', 'again'));

  perform pg_temp.act_as(c);
  perform pg_temp.must_be('a non-member cannot read the request',
    not exists (select 1 from public.general_access_requests where id = req));
  perform pg_temp.must_refuse('a non-member cannot answer it',
    format('select public.answer_general_access_request(%L, true, %L)', req, ''));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('the requester cannot approve their own request',
    format('select public.answer_general_access_request(%L, true, %L)', req, ''));

  perform pg_temp.act_as(a);
  perform pg_temp.must_be('the Owner reads the request',
    exists (select 1 from public.general_access_requests where id = req));
  perform pg_temp.must_allow('the Owner approves it',
    format('select public.answer_general_access_request(%L, true, %L)', req, 'Go ahead'));
  perform pg_temp.must_be('...which grants the permission',
    exists (select 1 from public.general_grants where project_id = p and user_id = b and permission = 'edit_files'));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('asking for a permission you already hold is refused',
    format('select public.request_general_access(%L, %L, %L)', p, 'edit_files', ''));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ join codes

do $$
declare
  a uuid := (select v from fx where k = 'a');
  d uuid := (select v from fx where k = 'd');
  e uuid := (select v from fx where k = 'e');
  p uuid := (select v from fx where k = 'project');
  code text;
begin
  perform pg_temp.act_as(a);
  code := public.set_general_join_code(p, true, false);
  perform pg_temp.must_be('an Owner opens an eight-character join code', char_length(code) = 8);
  perform pg_temp.act_as((select v from fx where k = 'b'));
  perform pg_temp.must_be('a Member without manage_members cannot read the code',
    not exists (select 1 from public.general_join_codes where project_id = p));

  perform pg_temp.act_as(d);
  perform pg_temp.must_refuse('a Member-to-be cannot change the join code',
    format('select public.set_general_join_code(%L, false, false)', p));
  perform pg_temp.must_allow('a join code works while it is on',
    format('select public.join_general_project(%L)', lower(code)));
  perform pg_temp.must_be('...and joins them as a Member',
    exists (select 1 from public.general_members where project_id = p and user_id = d and level = 'member'));

  perform pg_temp.act_as(a);
  perform public.set_general_join_code(p, false, false);
  perform pg_temp.act_as(e);
  perform pg_temp.must_refuse('a join code fails once it is off',
    format('select public.join_general_project(%L)', code));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ fields

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  f_budget uuid;
  f_venue uuid;
begin
  perform pg_temp.act_as(a);
  insert into public.general_fields (project_id, name, type) values (p, 'Budget', 'short_text')
  returning id into f_budget;
  perform pg_temp.must_allow('an empty field can change type',
    format($q$update public.general_fields set type = 'money' where id = %L$q$, f_budget));

  perform pg_temp.must_refuse('a negative amount is refused',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '-5')$q$, f_budget));
  perform pg_temp.must_allow('a valid amount is saved',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '15000.50')$q$, f_budget));
  perform pg_temp.must_refuse('a field type cannot change once it holds values',
    format($q$update public.general_fields set type = 'number' where id = %L$q$, f_budget));

  perform pg_temp.must_refuse('a choice field needs options',
    format($q$insert into public.general_fields (project_id, name, type) values (%L, 'Venue', 'single_choice')$q$, p));
  insert into public.general_fields (project_id, name, type, options)
  values (p, 'Venue', 'single_choice', '["Gym", "Covered court"]') returning id into f_venue;
  perform pg_temp.must_refuse('a choice outside the options is refused',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '"Field"')$q$, f_venue));
  perform pg_temp.must_allow('a listed choice is saved',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '"Gym"')$q$, f_venue));
  perform pg_temp.must_refuse('an option still chosen cannot be removed',
    format($q$update public.general_fields set options = '["Covered court"]' where id = %L$q$, f_venue));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a Member without edit_project cannot add a field',
    format($q$insert into public.general_fields (project_id, name, type) values (%L, 'Theme', 'short_text')$q$, p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ people search

do $$
declare
  a uuid := (select v from fx where k = 'a');
  n int;
  shown_email text;
begin
  perform pg_temp.act_as(a);
  select count(*) into n from public.search_general_people('zz');
  perform pg_temp.must_be('a search shorter than three characters returns nothing', n = 0);
  select count(*) into n from public.search_general_people('Zzgen');
  perform pg_temp.must_be('a name search finds the other accounts, not yourself', n = 4);
  perform pg_temp.must_be('...without showing their email addresses',
    not exists (select 1 from public.search_general_people('Zzgen') s where s.email is not null));
  select s.email into shown_email from public.search_general_people('zz-gen-echo@example.test') s;
  perform pg_temp.must_be('an exact email search shows the email that was typed',
    shown_email = 'zz-gen-echo@example.test');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ owners and archiving

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('the last Owner cannot leave',
    format('select public.leave_general_project(%L)', p));
  perform pg_temp.must_refuse('the last Owner cannot step down',
    format('select public.set_general_member_level(%L, %L, %L)', p, a, 'manager'));

  perform pg_temp.must_allow('an Owner archives the project',
    format('select public.archive_general_project(%L, true)', p));
  perform pg_temp.must_refuse('an archived project cannot be renamed',
    format($q$update public.general_projects set name = 'Zz Too late' where id = %L$q$, p));
  perform pg_temp.must_allow('an Owner restores it',
    format('select public.archive_general_project(%L, false)', p));

  perform pg_temp.must_allow('the Owner makes somebody else an Owner',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'owner'));
  perform pg_temp.must_allow('...and can then leave',
    format('select public.leave_general_project(%L)', p));
  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/general.test.sql`
Expected: FAIL in the fixture with `function public.create_general_project(unknown, unknown, unknown, unknown) does not exist`.

- [ ] **Step 3: Write `supabase/general.sql`**

```sql
-- Collabify — the General workplace: projects anybody at the school runs.
--
--   node scripts/db.mjs supabase/general.sql
--
-- Separate tables from Education on purpose. A class project is fenced by
-- professor, class membership, syllabus weeks and approval; a General project
-- is fenced by who was invited and what their Owner let them do. Sharing tables
-- would mean every Education guard growing a second branch, so the two share
-- only accounts, notifications, conversations and storage.
--
-- Permissions, in one sentence: Owners and Managers can do everything in
-- `general_permission`; a Member can do only what an Owner granted them; and on
-- an archived project nobody can change anything until an Owner restores it.
-- `src/lib/general/permissions.ts` mirrors this. Keep them in step.
--
-- Requires supabase/workplaces.sql.

begin;

-- ---------------------------------------------------------------- types

do $$ begin
  create type public.general_level as enum ('owner', 'manager', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_permission as enum
    ('edit_project', 'manage_members', 'manage_structure', 'manage_tasks', 'edit_files');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_status as enum
    ('planning', 'in_progress', 'on_hold', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_field_type as enum
    ('short_text', 'long_text', 'number', 'money', 'date',
     'single_choice', 'multi_choice', 'yes_no', 'member', 'link');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_request_status as enum ('open', 'approved', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.general_invite_status as enum ('pending', 'accepted', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text not null default '',
  starts_on      date,
  ends_on        date,
  status         public.general_status not null default 'planning',
  points_enabled boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint general_projects_name_len check (char_length(btrim(name)) between 1 and 200),
  constraint general_projects_description_len check (char_length(description) <= 20000),
  constraint general_projects_dates check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

/**
 * The join code lives apart from the project row on purpose. Every member reads
 * the project; only someone who can invite should read the code, or any Member
 * could let anybody in by passing it on.
 */
create table if not exists public.general_join_codes (
  project_id uuid primary key references public.general_projects (id) on delete cascade,
  code       text not null unique,
  open       boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists general_projects_touch on public.general_projects;
create trigger general_projects_touch before update on public.general_projects
  for each row execute function public.touch_updated_at();

create table if not exists public.general_members (
  project_id uuid not null references public.general_projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  level      public.general_level not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists general_members_user_idx on public.general_members (user_id);

create table if not exists public.general_teams (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint general_teams_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_teams_id_project unique (id, project_id)
);

create unique index if not exists general_teams_name_key
  on public.general_teams (project_id, lower(btrim(name)));

-- project_id is carried on every child row so a composite key can prove the
-- team and the person belong to the same project, without a trigger.
create table if not exists public.general_team_members (
  team_id    uuid not null,
  project_id uuid not null,
  user_id    uuid not null,
  primary key (team_id, user_id),
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_positions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  -- Null covers the whole project, like "Adviser". Set, it belongs to one team.
  team_id    uuid,
  name       text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint general_positions_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_positions_id_project unique (id, project_id),
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete cascade
);

create table if not exists public.general_position_holders (
  position_id uuid not null,
  project_id  uuid not null,
  user_id     uuid not null,
  primary key (position_id, user_id),
  foreign key (position_id, project_id)
    references public.general_positions (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_grants (
  project_id uuid not null,
  user_id    uuid not null,
  permission public.general_permission not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id, permission),
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create table if not exists public.general_access_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  user_id     uuid not null,
  permission  public.general_permission not null,
  reason      text not null default '',
  status      public.general_request_status not null default 'open',
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  constraint general_access_requests_reason_len check (char_length(reason) <= 1000),
  constraint general_access_requests_note_len check (char_length(note) <= 1000),
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create unique index if not exists general_access_requests_one_open
  on public.general_access_requests (project_id, user_id, permission) where status = 'open';

create table if not exists public.general_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  invitee     uuid not null references public.profiles (id) on delete cascade,
  invited_by  uuid references public.profiles (id) on delete set null,
  status      public.general_invite_status not null default 'pending',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create unique index if not exists general_invitations_one_pending
  on public.general_invitations (project_id, invitee) where status = 'pending';
create index if not exists general_invitations_invitee_idx
  on public.general_invitations (invitee, status);

create table if not exists public.general_fields (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  name       text not null,
  type       public.general_field_type not null,
  options    jsonb not null default '[]'::jsonb,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint general_fields_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_fields_options_array check (jsonb_typeof(options) = 'array')
);

create index if not exists general_fields_project_idx on public.general_fields (project_id, sort);

create table if not exists public.general_field_values (
  field_id   uuid primary key references public.general_fields (id) on delete cascade,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

/** A deactivated account is a member of nothing, whatever rows still exist. */
create or replace function public.is_general_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;

create or replace function public.is_general_owner(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = auth.uid() and m.level = 'owner'
  );
$$;

create or replace function public.general_is_archived(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.general_projects where id = p_project),
    false
  );
$$;

/** Holds the permission, archived or not. For deciding what somebody may read. */
create or replace function public.general_has(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and (
    exists (
      select 1 from public.general_members m
       where m.project_id = p_project and m.user_id = auth.uid()
         and m.level in ('owner', 'manager')
    )
    or exists (
      select 1 from public.general_grants g
       where g.project_id = p_project and g.user_id = auth.uid()
         and g.permission = p_permission
    )
  );
$$;

/** May use the permission now. False for everybody on an archived project. */
create or replace function public.general_can(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select not public.general_is_archived(p_project)
     and public.general_has(p_project, p_permission);
$$;

/** Whether the viewer may see this person's profile because of a General project. */
create or replace function public.shares_general_project_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_members mine
      join public.general_members theirs on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid() and theirs.user_id = p_user
  )
  or exists (
    -- Both sides of a pending invitation see each other: the invitee sees who
    -- is on the project, and the project sees who it invited.
    select 1
      from public.general_invitations i
      join public.general_members m on m.project_id = i.project_id
     where i.status = 'pending'
       and ((m.user_id = auth.uid() and i.invitee = p_user)
         or (i.invitee = auth.uid() and m.user_id = p_user))
  );
$$;

create or replace function public.general_permission_label(p public.general_permission)
returns text language sql immutable as $$
  select case p
    when 'edit_project' then 'Edit project details'
    when 'manage_members' then 'Invite and remove members'
    when 'manage_structure' then 'Manage teams and positions'
    when 'manage_tasks' then 'Manage all tasks'
    when 'edit_files' then 'Edit files on any task'
  end;
$$;

create or replace function public.general_field_project(p_field uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.general_fields where id = p_field;
$$;

-- ---------------------------------------------------------------- guards

/**
 * Archiving changes only through the Owner's RPC, which raises a
 * transaction-local flag. Everything else on the row is `edit_project`, which
 * the update policy already checks.
 */
create or replace function public.guard_general_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if current_setting('collabify.general_owner_op', true) is distinct from 'on'
     and new.archived_at is distinct from old.archived_at then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  if old.archived_at is not null and new.archived_at is not null then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_projects_guard on public.general_projects;
create trigger general_projects_guard before update on public.general_projects
  for each row execute function public.guard_general_project();

/** Null when the options suit the type, otherwise why they do not. Mirrors checkOptions(). */
create or replace function public.general_options_problem(
  p_type public.general_field_type,
  p_options jsonb
) returns text language plpgsql immutable as $$
declare
  n int := jsonb_array_length(p_options);
begin
  if p_type not in ('single_choice', 'multi_choice') then
    return case when n = 0 then null else 'Only choice fields have options' end;
  end if;
  if n = 0 then return 'Add at least one option'; end if;
  if n > 50 then return 'Keep it to 50 options'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_options) e
     where jsonb_typeof(e) <> 'string'
        or char_length(btrim(e #>> '{}')) not between 1 and 80
  ) then
    return 'Each option needs 1 to 80 characters';
  end if;
  if (select count(distinct lower(btrim(e))) from jsonb_array_elements_text(p_options) e) <> n then
    return 'An option is listed twice';
  end if;
  return null;
end;
$$;

create or replace function public.guard_general_field()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  problem text;
begin
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;

    if new.type is distinct from old.type
       and exists (select 1 from public.general_field_values v where v.field_id = old.id) then
      raise exception 'This field already holds a value, so its type cannot change. Add a new field instead.'
        using errcode = 'check_violation';
    end if;

    if new.type in ('single_choice', 'multi_choice') and exists (
      select 1
        from public.general_field_values v,
             jsonb_array_elements_text(
               case when jsonb_typeof(v.value) = 'array' then v.value
                    else jsonb_build_array(v.value) end
             ) as chosen(opt)
       where v.field_id = old.id
         and not (new.options ? chosen.opt)
    ) then
      raise exception 'An option you removed is still chosen. Change that value first.'
        using errcode = 'check_violation';
    end if;
  end if;

  if public.general_is_archived(new.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  new.name := btrim(new.name);
  problem := public.general_options_problem(new.type, new.options);
  if problem is not null then
    raise exception '%', problem using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_fields_guard on public.general_fields;
create trigger general_fields_guard before insert or update on public.general_fields
  for each row execute function public.guard_general_field();

/** Mirrors checkFieldValue() in src/lib/general/fields.ts. */
create or replace function public.guard_general_field_value()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f public.general_fields%rowtype;
  kind text := jsonb_typeof(new.value);
  txt text := new.value #>> '{}';
  n numeric;
  d date;
begin
  select * into f from public.general_fields where id = new.field_id;
  if f.id is null then
    raise exception 'That field no longer exists';
  end if;

  case f.type
    when 'short_text' then
      if kind <> 'string' or char_length(btrim(txt)) not between 1 and 200 then
        raise exception 'Short text needs 1 to 200 characters' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
    when 'long_text' then
      if kind <> 'string' or char_length(btrim(txt)) not between 1 and 10000 then
        raise exception 'Long text needs 1 to 10,000 characters' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
    when 'number' then
      if kind <> 'number' or abs(txt::numeric) > 1e12 then
        raise exception 'Enter a number' using errcode = 'check_violation';
      end if;
    when 'money' then
      if kind <> 'number' then
        raise exception 'Enter an amount' using errcode = 'check_violation';
      end if;
      n := txt::numeric;
      if n < 0 or n > 1e12 or n <> round(n, 2) then
        raise exception 'An amount is zero or more, with at most two decimal places'
          using errcode = 'check_violation';
      end if;
    when 'date' then
      if kind <> 'string' or txt !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Pick a date' using errcode = 'check_violation';
      end if;
      begin
        d := txt::date;
      exception when others then
        raise exception 'Pick a real date' using errcode = 'check_violation';
      end;
      if to_char(d, 'YYYY-MM-DD') <> txt then
        raise exception 'Pick a real date' using errcode = 'check_violation';
      end if;
    when 'single_choice' then
      if kind <> 'string' or not (f.options ? txt) then
        raise exception 'Pick one of the options' using errcode = 'check_violation';
      end if;
    when 'multi_choice' then
      if kind <> 'array' or jsonb_array_length(new.value) = 0
         or exists (
           select 1 from jsonb_array_elements(new.value) e
            where jsonb_typeof(e) <> 'string' or not (f.options ? (e #>> '{}'))
         )
         or (select count(distinct e) from jsonb_array_elements_text(new.value) e)
            <> jsonb_array_length(new.value) then
        raise exception 'Pick options from the list, each once' using errcode = 'check_violation';
      end if;
    when 'yes_no' then
      if kind <> 'boolean' then
        raise exception 'Choose yes or no' using errcode = 'check_violation';
      end if;
    when 'member' then
      if kind <> 'string' or not exists (
        select 1 from public.general_members m
         where m.project_id = f.project_id and m.user_id::text = txt
      ) then
        raise exception 'Pick somebody on this project' using errcode = 'check_violation';
      end if;
    when 'link' then
      if kind <> 'string' or char_length(btrim(txt)) > 2000 or btrim(txt) !~* '^https?://\S+$' then
        raise exception 'Start the address with http:// or https://' using errcode = 'check_violation';
      end if;
      new.value := to_jsonb(btrim(txt));
  end case;

  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists general_field_values_guard on public.general_field_values;
create trigger general_field_values_guard before insert or update on public.general_field_values
  for each row execute function public.guard_general_field_value();

/** Teams and positions are frozen with the project too. */
create or replace function public.guard_general_structure()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is not null and public.general_is_archived(p) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_teams_guard on public.general_teams;
create trigger general_teams_guard before insert or update or delete on public.general_teams
  for each row execute function public.guard_general_structure();
drop trigger if exists general_positions_guard on public.general_positions;
create trigger general_positions_guard before insert or update or delete on public.general_positions
  for each row execute function public.guard_general_structure();

-- ---------------------------------------------------------------- row-level security

alter table public.general_projects         enable row level security;
alter table public.general_join_codes       enable row level security;
alter table public.general_members          enable row level security;
alter table public.general_teams            enable row level security;
alter table public.general_team_members     enable row level security;
alter table public.general_positions        enable row level security;
alter table public.general_position_holders enable row level security;
alter table public.general_grants           enable row level security;
alter table public.general_access_requests  enable row level security;
alter table public.general_invitations      enable row level security;
alter table public.general_fields           enable row level security;
alter table public.general_field_values     enable row level security;

drop policy if exists general_projects_select on public.general_projects;
create policy general_projects_select on public.general_projects
  for select using (
    public.is_general_member(id)
    or exists (
      select 1 from public.general_invitations i
       where i.project_id = general_projects.id
         and i.invitee = auth.uid() and i.status = 'pending'
    )
  );

-- `general_has`, not `general_can`: on an archived project the row must reach
-- guard_general_project so the editor is told why, rather than the update
-- silently matching nothing.
drop policy if exists general_projects_update on public.general_projects;
create policy general_projects_update on public.general_projects
  for update using (public.general_has(id, 'edit_project'))
  with check (public.general_has(id, 'edit_project'));

-- No write policy: the code changes only through set_general_join_code.
drop policy if exists general_join_codes_select on public.general_join_codes;
create policy general_join_codes_select on public.general_join_codes
  for select using (public.general_has(project_id, 'manage_members'));

drop policy if exists general_members_select on public.general_members;
create policy general_members_select on public.general_members
  for select using (public.is_general_member(project_id));

-- Teams, positions and the people in them.
do $$
declare
  t text;
begin
  foreach t in array array['general_teams', 'general_team_members',
                           'general_positions', 'general_position_holders'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_general_member(project_id))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all using (public.general_can(project_id, %L))
         with check (public.general_can(project_id, %L))',
      t || '_write', t, 'manage_structure', 'manage_structure');
  end loop;
end $$;

drop policy if exists general_grants_select on public.general_grants;
create policy general_grants_select on public.general_grants
  for select using (public.is_general_member(project_id));

drop policy if exists general_access_requests_select on public.general_access_requests;
create policy general_access_requests_select on public.general_access_requests
  for select using (user_id = auth.uid() or public.is_general_owner(project_id));

drop policy if exists general_invitations_select on public.general_invitations;
create policy general_invitations_select on public.general_invitations
  for select using (invitee = auth.uid() or public.general_has(project_id, 'manage_members'));

drop policy if exists general_fields_select on public.general_fields;
create policy general_fields_select on public.general_fields
  for select using (public.is_general_member(project_id));

drop policy if exists general_fields_write on public.general_fields;
create policy general_fields_write on public.general_fields
  for all using (public.general_can(project_id, 'edit_project'))
  with check (public.general_can(project_id, 'edit_project'));

drop policy if exists general_field_values_select on public.general_field_values;
create policy general_field_values_select on public.general_field_values
  for select using (public.is_general_member(public.general_field_project(field_id)));

drop policy if exists general_field_values_write on public.general_field_values;
create policy general_field_values_write on public.general_field_values
  for all using (public.general_can(public.general_field_project(field_id), 'edit_project'))
  with check (public.general_can(public.general_field_project(field_id), 'edit_project'));

-- Profiles of the people you work with in General.
drop policy if exists profiles_select_general_peer on public.profiles;
create policy profiles_select_general_peer on public.profiles
  for select using (public.shares_general_project_with(id));

-- ---------------------------------------------------------------- RPCs: projects

create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null
) returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and status <> 'rejected'
  ) then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  insert into public.general_projects (name, description, starts_on, ends_on, created_by)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid())
  returning * into p;

  insert into public.general_members (project_id, user_id, level)
  values (p.id, auth.uid(), 'owner');

  return p;
end;
$$;

create or replace function public.archive_general_project(p_project uuid, p_archived boolean)
returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner archives or restores a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_owner_op', 'on', true);
  update public.general_projects
     set archived_at = case when p_archived then now() else null end
   where id = p_project
  returning * into p;
  perform set_config('collabify.general_owner_op', 'off', true);

  -- Archiving closes the door too; restoring leaves it closed.
  if p_archived then
    update public.general_join_codes set open = false, updated_at = now()
     where project_id = p_project;
  end if;

  return p;
end;
$$;

-- ---------------------------------------------------------------- RPCs: people

/**
 * Finding somebody to invite, without handing out the school's address book.
 *
 * A name search returns names and photos only. The email comes back only when
 * the query *is* that email — the person searching already has it. Three
 * characters minimum and a rate limit keep it from being walked.
 */
create or replace function public.search_general_people(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if char_length(q) < 3 then
    return;
  end if;

  perform public.rate_limit('general_people_search', 60, interval '1 minute',
    'Too many searches at once. Wait a minute and try again.');

  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select pr.id, pr.first_name, pr.last_name, pr.avatar_url,
           case when lower(pr.email) = lower(q) then pr.email end
      from public.profiles pr
     where pr.status <> 'rejected'
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

create or replace function public.invite_to_general_project(p_project uuid, p_user uuid)
returns public.general_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to invite people to this project'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_members where project_id = p_project and user_id = p_user) then
    raise exception 'They are already on this project' using errcode = 'unique_violation';
  end if;

  select * into inv from public.general_invitations
   where project_id = p_project and invitee = p_user and status = 'pending';
  if inv.id is not null then
    return inv; -- already invited, and inviting again is not an error
  end if;

  perform public.rate_limit('general_invite', 100, interval '1 hour',
    'You have sent a lot of invitations in the last hour. Try again later.');

  insert into public.general_invitations (project_id, invitee, invited_by)
  values (p_project, p_user, auth.uid())
  returning * into inv;
  return inv;
end;
$$;

create or replace function public.withdraw_general_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  select * into inv from public.general_invitations where id = p_invitation for update;
  if inv.id is null or not public.general_can(inv.project_id, 'manage_members') then
    raise exception 'You cannot withdraw that invitation' using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered' using errcode = 'check_violation';
  end if;
  update public.general_invitations
     set status = 'withdrawn', answered_at = now()
   where id = p_invitation;
end;
$$;

create or replace function public.respond_general_invitation(p_invitation uuid, p_accept boolean)
returns public.general_invitations
language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
begin
  select * into inv from public.general_invitations where id = p_invitation for update;
  if inv.id is null or inv.invitee is distinct from auth.uid() then
    raise exception 'That invitation is not yours to answer' using errcode = 'insufficient_privilege';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already answered or withdrawn' using errcode = 'check_violation';
  end if;
  if p_accept and public.general_is_archived(inv.project_id) then
    raise exception 'That project is archived, so it cannot take new members'
      using errcode = 'check_violation';
  end if;

  update public.general_invitations
     set status = case when p_accept then 'accepted' else 'declined' end::public.general_invite_status,
         answered_at = now()
   where id = p_invitation
  returning * into inv;

  if p_accept then
    insert into public.general_members (project_id, user_id)
    values (inv.project_id, auth.uid())
    on conflict do nothing;
  end if;
  return inv;
end;
$$;

create or replace function public.set_general_join_code(
  p_project    uuid,
  p_open       boolean,
  p_regenerate boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare
  -- No 0/O, 1/I/L: a code gets read aloud across a room.
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  raw bytea;
  i int;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner changes the join code' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select jc.code into v_code from public.general_join_codes jc
   where jc.project_id = p_project for update;
  if p_open and (v_code is null or p_regenerate) then
    loop
      raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      v_code := '';
      -- Bytes 6 and 8 carry the uuid version and variant bits; skip them.
      foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
        v_code := v_code || substr(alphabet, 1 + get_byte(raw, i) % 31, 1);
      end loop;
      exit when not exists (select 1 from public.general_join_codes jc where jc.code = v_code);
    end loop;
  end if;

  if v_code is null then
    return null; -- closing a code that was never opened
  end if;

  insert into public.general_join_codes (project_id, code, open)
  values (p_project, v_code, p_open)
  on conflict (project_id) do update
    set code = excluded.code, open = excluded.open, updated_at = now();

  return v_code;
end;
$$;

create or replace function public.join_general_project(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and status <> 'rejected'
  ) then
    raise exception 'Sign in with an active account to join a project'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  perform public.rate_limit('general_join', 10, interval '10 minutes',
    'Too many join attempts. Wait a few minutes and try again.');

  select pr.* into p
    from public.general_join_codes jc
    join public.general_projects pr on pr.id = jc.project_id
   where jc.code = upper(btrim(p_code)) and jc.open and pr.archived_at is null;
  if p.id is null then
    raise exception 'That code does not match an open project. Check it with whoever shared it.'
      using errcode = 'no_data_found';
  end if;

  insert into public.general_members (project_id, user_id)
  values (p.id, auth.uid())
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$$;

-- ---------------------------------------------------------------- RPCs: levels and membership

create or replace function public.set_general_member_level(
  p_project uuid,
  p_user    uuid,
  p_level   public.general_level
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
  owners int;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner changes access levels' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- Every Owner row locked before counting, so two Owners stepping down at
  -- once cannot both see the other still there.
  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;

  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;

  if target.level = 'owner' and p_level <> 'owner' then
    select count(*) into owners from public.general_members
     where project_id = p_project and level = 'owner';
    if owners <= 1 then
      raise exception 'A project needs at least one Owner. Make someone else an Owner first.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.general_members set level = p_level
   where project_id = p_project and user_id = p_user;

  -- A Manager or Owner already holds every permission, so the extras and any
  -- open requests for them are moot.
  if p_level <> 'member' then
    delete from public.general_grants where project_id = p_project and user_id = p_user;
    update public.general_access_requests
       set status = 'withdrawn', answered_at = now()
     where project_id = p_project and user_id = p_user and status = 'open';
  end if;
end;
$$;

create or replace function public.remove_general_member(p_project uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.general_members%rowtype;
  owners int;
begin
  if p_user = auth.uid() then
    raise exception 'Use Leave project to remove yourself' using errcode = 'check_violation';
  end if;
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to remove people from this project'
      using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;
  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;

  if target.level in ('owner', 'manager') and not public.is_general_owner(p_project) then
    raise exception 'Only an Owner removes an Owner or a Manager'
      using errcode = 'insufficient_privilege';
  end if;
  if target.level = 'owner' then
    select count(*) into owners from public.general_members
     where project_id = p_project and level = 'owner';
    if owners <= 1 then
      raise exception 'A project needs at least one Owner' using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_members where project_id = p_project and user_id = p_user;
end;
$$;

create or replace function public.leave_general_project(p_project uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.general_members%rowtype;
  owners int;
begin
  perform 1 from public.general_members
   where project_id = p_project and level = 'owner' for update;
  select * into me from public.general_members
   where project_id = p_project and user_id = auth.uid() for update;
  if me.user_id is null then
    raise exception 'You are not on this project' using errcode = 'no_data_found';
  end if;

  if me.level = 'owner' then
    select count(*) into owners from public.general_members
     where project_id = p_project and level = 'owner';
    if owners <= 1 then
      raise exception 'You are the last Owner. Make someone else an Owner before you leave.'
        using errcode = 'check_violation';
    end if;
  end if;

  delete from public.general_members where project_id = p_project and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------- RPCs: extra permissions

create or replace function public.grant_general_permission(
  p_project    uuid,
  p_user       uuid,
  p_permission public.general_permission
) returns void
language plpgsql security definer set search_path = public as $$
declare
  lvl public.general_level;
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner grants permissions' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level into lvl from public.general_members
   where project_id = p_project and user_id = p_user;
  if lvl is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;
  if lvl <> 'member' then
    raise exception 'Owners and Managers already hold every permission'
      using errcode = 'check_violation';
  end if;

  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (p_project, p_user, p_permission, auth.uid())
  on conflict do nothing;

  -- Granting what somebody asked for answers their request.
  update public.general_access_requests
     set status = 'approved', answered_by = auth.uid(), answered_at = now()
   where project_id = p_project and user_id = p_user
     and permission = p_permission and status = 'open';
end;
$$;

create or replace function public.revoke_general_permission(
  p_project    uuid,
  p_user       uuid,
  p_permission public.general_permission
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_general_owner(p_project) then
    raise exception 'Only an Owner takes permissions back' using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_grants
   where project_id = p_project and user_id = p_user and permission = p_permission;
end;
$$;

create or replace function public.request_general_access(
  p_project    uuid,
  p_permission public.general_permission,
  p_reason     text default ''
) returns public.general_access_requests
language plpgsql security definer set search_path = public as $$
declare
  lvl public.general_level;
  req public.general_access_requests%rowtype;
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level into lvl from public.general_members
   where project_id = p_project and user_id = auth.uid();
  if lvl <> 'member' or exists (
    select 1 from public.general_grants
     where project_id = p_project and user_id = auth.uid() and permission = p_permission
  ) then
    raise exception 'You already have that permission' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.general_access_requests
     where project_id = p_project and user_id = auth.uid()
       and permission = p_permission and status = 'open'
  ) then
    raise exception 'You already asked for this. An Owner has not answered yet.'
      using errcode = 'unique_violation';
  end if;

  perform public.rate_limit('general_access_request', 20, interval '1 hour',
    'You have sent a lot of access requests in the last hour. Try again later.');

  insert into public.general_access_requests (project_id, user_id, permission, reason)
  values (p_project, auth.uid(), p_permission, btrim(coalesce(p_reason, '')))
  returning * into req;
  return req;
end;
$$;

create or replace function public.answer_general_access_request(
  p_request uuid,
  p_approve boolean,
  p_note    text default ''
) returns public.general_access_requests
language plpgsql security definer set search_path = public as $$
declare
  req public.general_access_requests%rowtype;
  lvl public.general_level;
begin
  select * into req from public.general_access_requests where id = p_request for update;
  if req.id is null or not public.is_general_owner(req.project_id) then
    raise exception 'Only an Owner answers access requests' using errcode = 'insufficient_privilege';
  end if;
  if req.status <> 'open' then
    raise exception 'That request was already answered' using errcode = 'check_violation';
  end if;
  if public.general_is_archived(req.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  update public.general_access_requests
     set status = case when p_approve then 'approved' else 'declined' end::public.general_request_status,
         answered_by = auth.uid(),
         answered_at = now(),
         note = btrim(coalesce(p_note, ''))
   where id = p_request
  returning * into req;

  if p_approve then
    select level into lvl from public.general_members
     where project_id = req.project_id and user_id = req.user_id;
    if lvl = 'member' then
      insert into public.general_grants (project_id, user_id, permission, granted_by)
      values (req.project_id, req.user_id, req.permission, auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return req;
end;
$$;

create or replace function public.withdraw_general_access_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  req public.general_access_requests%rowtype;
begin
  select * into req from public.general_access_requests where id = p_request for update;
  if req.id is null or req.user_id is distinct from auth.uid() then
    raise exception 'That request is not yours to withdraw' using errcode = 'insufficient_privilege';
  end if;
  if req.status <> 'open' then
    raise exception 'That request was already answered' using errcode = 'check_violation';
  end if;
  update public.general_access_requests
     set status = 'withdrawn', answered_at = now()
   where id = p_request;
end;
$$;

-- ---------------------------------------------------------------- grants

grant execute on function public.create_general_project(text, text, date, date) to authenticated;
grant execute on function public.archive_general_project(uuid, boolean) to authenticated;
grant execute on function public.search_general_people(text) to authenticated;
grant execute on function public.invite_to_general_project(uuid, uuid) to authenticated;
grant execute on function public.withdraw_general_invitation(uuid) to authenticated;
grant execute on function public.respond_general_invitation(uuid, boolean) to authenticated;
grant execute on function public.set_general_join_code(uuid, boolean, boolean) to authenticated;
grant execute on function public.join_general_project(text) to authenticated;
grant execute on function public.set_general_member_level(uuid, uuid, public.general_level) to authenticated;
grant execute on function public.remove_general_member(uuid, uuid) to authenticated;
grant execute on function public.leave_general_project(uuid) to authenticated;
grant execute on function public.grant_general_permission(uuid, uuid, public.general_permission) to authenticated;
grant execute on function public.revoke_general_permission(uuid, uuid, public.general_permission) to authenticated;
grant execute on function public.request_general_access(uuid, public.general_permission, text) to authenticated;
grant execute on function public.answer_general_access_request(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_general_access_request(uuid) to authenticated;

grant select, update on public.general_projects to authenticated;
grant select on public.general_join_codes, public.general_members, public.general_grants,
                public.general_access_requests, public.general_invitations to authenticated;
grant select, insert, update, delete on public.general_teams, public.general_team_members,
                public.general_positions, public.general_position_holders,
                public.general_fields, public.general_field_values to authenticated;

-- ---------------------------------------------------------------- realtime

do $$
declare
  t text;
begin
  foreach t in array array['general_projects', 'general_join_codes', 'general_members', 'general_teams',
                           'general_team_members', 'general_positions',
                           'general_position_holders', 'general_grants',
                           'general_access_requests', 'general_invitations',
                           'general_fields', 'general_field_values'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
```

- [ ] **Step 4: Add the file to the rebuild order**

In `scripts/schema-drift.mjs`, the last line of `ORDER` becomes:

```js
consent privacy-requests term-shifts hardening workplaces general`.split(/\s+/)
```

In `docs/07-backup.md`, append ` supabase/general.sql` after `supabase/workplaces.sql`.

- [ ] **Step 5: Apply and run the tests**

```bash
node scripts/db.mjs supabase/general.sql
node scripts/db.mjs supabase/tests/general.test.sql
```

Expected: 58 `PASS` lines, ending with `...and can then leave`.

```bash
node scripts/db.mjs supabase/general.sql
```

Expected: the second run succeeds too, which proves the file is idempotent.

- [ ] **Step 6: Commit**

```bash
git add supabase/general.sql supabase/tests/general.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add General workplace projects, membership and permissions to the database"
```

---

### Task 6: General tasks in the database

**Files:**
- Create: `supabase/general-tasks.sql`
- Create: `supabase/tests/general-tasks.test.sql`
- Modify: `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Consumes (from Task 5): `is_general_member`, `general_can`, `general_is_archived`, `general_teams(id, project_id)`, `general_members(project_id, user_id)`, `set_config('collabify.general_owner_op')` convention.
- Produces, as tables:
  - `general_tasks(id, project_id, team_id, title, description, status, due_at, weight, created_by, completed_at, created_at, updated_at)`
  - `general_task_assignees(task_id, project_id, user_id, assigned_by, assigned_at)`
  - `general_task_comments(id, task_id, project_id, author_id, body, created_at, edited_at)`
  - `general_task_files(id, task_id, project_id, uploaded_by, file_path, file_name, mime_type, size_bytes, created_at)`
  - `general_task_logs(id, task_id, project_id, user_id, minutes, note, logged_on, created_at)`
  - `general_task_events(id, task_id, project_id, actor_id, kind, detail, created_at)`, where `kind` is one of `created`, `updated`, `assigned` or `unassigned`
- Produces, as views:
  - `general_project_overview`: every `general_projects` column plus `join_code` and `join_open` (null and false for anyone who cannot invite), `my_level`, `member_count`, `task_count`, `done_count`, `progress_pct` and `open_request_count`
  - `general_task_overview`: every `general_tasks` column plus `assignee_ids uuid[]`, `comment_count`, `file_count` and `logged_minutes`
- Produces, as helpers: `is_general_task_assignee(uuid)`, `general_task_held(uuid)`, `general_task_project(uuid)`
- Produces, as storage: a private bucket `general-files` with object paths `<project_id>/<task_id>/<random>-<file name>`, capped at 25 MB per file

**Rules this file enforces** (each has a test):
- Members read every task. Any member creates a task, and the creator is always the caller.
- A task is changed by whoever holds it, by its creator while nobody holds it, or by anyone with `manage_tasks`. Only `manage_tasks` sets `weight`.
- A member claims a task nobody holds. Anyone with `manage_tasks` assigns and unassigns anybody. A holder can release themselves.
- Files go on a task you hold, or on any task with `edit_files`. A time log goes only on a task you hold. Any member comments.
- `completed_at` is stamped when a task reaches Done and cleared when it leaves Done.
- Nothing changes on an archived project.
- `progress_pct` matches `projectProgress()` in `src/lib/general/progress.ts`.

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/general-tasks.test.sql
-- General tasks — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/general-tasks.test.sql

begin;

-- ------------------------------------------------------------------ helpers

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Bravo', 'Charlie', 'Outsider'];
  i int;
  v_project uuid;
  v_inv uuid;
begin
  for i in 1..4 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-gtask-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzgtask', 'last_name', v_names[i],
                               'workplace', 'general'),
            now(), now());
  end loop;

  perform pg_temp.act_as(v_ids[1]);
  select (public.create_general_project('Zz Recognition day')).id into v_project;
  for i in 2..3 loop
    perform pg_temp.act_as(v_ids[1]);
    select id into v_inv from public.invite_to_general_project(v_project, v_ids[i]);
    perform pg_temp.act_as(v_ids[i]);
    perform public.respond_general_invitation(v_inv, true);
  end loop;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('a', v_ids[1]), ('b', v_ids[2]), ('c', v_ids[3]), ('d', v_ids[4]),
                        ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ creating and reading

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  t_a uuid; t_b uuid; t_w uuid;
begin
  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Book the gym') returning id into t_a;

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('a non-member cannot read tasks',
    not exists (select 1 from public.general_tasks where id = t_a));
  perform pg_temp.act_as(b);
  perform pg_temp.must_be('...while a member can',
    exists (select 1 from public.general_tasks where id = t_a));

  insert into public.general_tasks (project_id, title, created_by)
  values (p, 'Print certificates', a) returning id into t_b;
  perform pg_temp.must_be('a task is always created by the caller, whatever was sent',
    (select created_by = b from public.general_tasks where id = t_b));

  perform pg_temp.must_refuse('a Member cannot set points when creating a task',
    format($q$insert into public.general_tasks (project_id, title, weight) values (%L, 'Stage', 5)$q$, p));
  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title, weight) values (p, 'Stage design', 5)
  returning id into t_w;
  perform pg_temp.must_be('...while an Owner can', t_w is not null);

  perform pg_temp.act_as_service();
  insert into fx values ('t_a', t_a), ('t_b', t_b), ('t_w', t_w);
end $$;

-- ------------------------------------------------------------------ claiming and editing

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('a member claims a task nobody holds',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, c));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a second member cannot claim a held task',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, b));
  perform pg_temp.must_refuse('the creator cannot edit a task somebody else holds',
    format($q$update public.general_tasks set title = 'Print the certificates' where id = %L$q$, t_b));

  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('the holder moves it along',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, t_b));
  perform pg_temp.must_refuse('the holder cannot change its points',
    format('update public.general_tasks set weight = 3 where id = %L', t_b));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner unassigns the holder',
    format('delete from public.general_task_assignees where task_id = %L and user_id = %L', t_b, c));
  perform pg_temp.must_allow('...and reassigns it to somebody else',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, b));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ files, logs, comments

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('a Member cannot add a file to a task they do not hold',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/1-plan.pdf'));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner grants edit_files',
    format('select public.grant_general_permission(%L, %L, %L)', p, c, 'edit_files'));
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('...and the Member adds a file to any task',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/2-plan.pdf'));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner revokes edit_files',
    format('select public.revoke_general_permission(%L, %L, %L)', p, c, 'edit_files'));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('...and the Member cannot add a file again',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/3-plan.pdf'));

  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('the holder logs time',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes, note) values (%L, %L, 30, 'Layout')$q$, t_b, p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('somebody who does not hold it cannot log time on it',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes) values (%L, %L, 30)$q$, t_b, p));

  perform pg_temp.act_as(d);
  perform pg_temp.must_refuse('an outsider cannot comment',
    format($q$insert into public.general_task_comments (task_id, project_id, body) values (%L, %L, 'Hi')$q$, t_b, p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('any member can comment',
    format($q$insert into public.general_task_comments (task_id, project_id, body) values (%L, %L, 'Paper is in the office')$q$, t_b, p));

  perform pg_temp.act_as(a);
  perform pg_temp.must_be('history records the task being created',
    exists (select 1 from public.general_task_events where task_id = t_b and kind = 'created'));
  perform pg_temp.must_be('history records who it was assigned to',
    exists (select 1 from public.general_task_events
             where task_id = t_b and kind = 'assigned' and detail ->> 'user_id' = b::text));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ done, progress, archive

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  t_a uuid := (select v from fx where k = 't_a');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(b);
  update public.general_tasks set status = 'done' where id = t_b;
  perform pg_temp.must_be('finishing a task stamps when',
    (select completed_at is not null from public.general_tasks where id = t_b));
  update public.general_tasks set status = 'todo' where id = t_b;
  perform pg_temp.must_be('reopening it clears the stamp',
    (select completed_at is null from public.general_tasks where id = t_b));

  perform pg_temp.act_as(a);
  update public.general_tasks set status = 'done' where id = t_a;
  -- Three tasks weighing 1, 1 and 5, with the first one done.
  perform pg_temp.must_be('points off: progress counts finished tasks',
    (select progress_pct = 33.3 from public.general_project_overview where id = p));
  update public.general_projects set points_enabled = true where id = p;
  perform pg_temp.must_be('points on: progress weighs finished tasks',
    (select progress_pct = 14.3 from public.general_project_overview where id = p));

  perform pg_temp.act_as(b);
  delete from public.general_tasks where id = t_a;
  perform pg_temp.must_be('a Member cannot delete somebody else''s task',
    exists (select 1 from public.general_tasks where id = t_a));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner archives the project',
    format('select public.archive_general_project(%L, true)', p));
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('nobody adds a task to an archived project',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Late idea')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner restores it',
    format('select public.archive_general_project(%L, false)', p));
  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/general-tasks.test.sql`
Expected: FAIL with `relation "public.general_tasks" does not exist`.

- [ ] **Step 3: Write `supabase/general-tasks.sql`**

```sql
-- Collabify — tasks in the General workplace.
--
--   node scripts/db.mjs supabase/general-tasks.sql
--
-- The same shape of work as an Education board — assignees, comments, files, a
-- time log and a history — without the rules that only make sense in a class:
-- no deadline lock, no hand-in, no professor-approved reassignment. Anyone with
-- `manage_tasks` moves work between people directly.
--
-- Points are a project setting. `weight` is always stored (default 1); whether
-- it matters is `general_projects.points_enabled`.
--
-- Requires supabase/general.sql.

begin;

do $$ begin
  create type public.general_task_status as enum ('todo', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  team_id      uuid,
  title        text not null,
  description  text not null default '',
  status       public.general_task_status not null default 'todo',
  due_at       timestamptz,
  weight       numeric(8, 2) not null default 1,
  created_by   uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint general_tasks_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint general_tasks_description_len check (char_length(description) <= 20000),
  constraint general_tasks_weight check (weight > 0 and weight <= 1000),
  constraint general_tasks_id_project unique (id, project_id),
  -- Removing a team leaves its tasks on the project rather than deleting them.
  -- The column list on SET NULL needs Postgres 15 or later.
  foreign key (team_id, project_id)
    references public.general_teams (id, project_id) on delete set null (team_id)
);

create index if not exists general_tasks_project_idx on public.general_tasks (project_id, status);
create index if not exists general_tasks_due_idx
  on public.general_tasks (due_at) where status <> 'done' and due_at is not null;

drop trigger if exists general_tasks_touch on public.general_tasks;
create trigger general_tasks_touch before update on public.general_tasks
  for each row execute function public.touch_updated_at();

create table if not exists public.general_task_assignees (
  task_id     uuid not null,
  project_id  uuid not null,
  user_id     uuid not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade
);

create index if not exists general_task_assignees_user_idx on public.general_task_assignees (user_id);

create table if not exists public.general_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  constraint general_task_comments_body_len check (char_length(btrim(body)) between 1 and 5000),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_comments_task_idx
  on public.general_task_comments (task_id, created_at);

create table if not exists public.general_task_files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null,
  project_id  uuid not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_path   text not null unique,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now(),
  constraint general_task_files_name_len check (char_length(file_name) between 1 and 255),
  constraint general_task_files_size check (size_bytes between 0 and 26214400),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_files_task_idx on public.general_task_files (task_id);

create table if not exists public.general_task_logs (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  minutes    int not null,
  note       text not null default '',
  logged_on  date not null default current_date,
  created_at timestamptz not null default now(),
  constraint general_task_logs_minutes check (minutes between 1 and 1440),
  constraint general_task_logs_note_len check (char_length(note) <= 2000),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_logs_task_idx on public.general_task_logs (task_id);

-- Append-only, written by triggers. Nobody has a write policy on it.
create table if not exists public.general_task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  project_id uuid not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint general_task_events_kind check (kind in ('created', 'updated', 'assigned', 'unassigned')),
  foreign key (task_id, project_id)
    references public.general_tasks (id, project_id) on delete cascade
);

create index if not exists general_task_events_task_idx
  on public.general_task_events (task_id, created_at);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_general_task_assignee(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_task_assignees
     where task_id = p_task and user_id = auth.uid()
  );
$$;

create or replace function public.general_task_held(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.general_task_assignees where task_id = p_task);
$$;

create or replace function public.general_task_project(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.general_tasks where id = p_task;
$$;

-- ---------------------------------------------------------------- guards

create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if public.general_is_archived(old.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if not public.general_can(old.project_id, 'manage_tasks') then
    if not (public.is_general_task_assignee(old.id)
            or (old.created_by = auth.uid() and not public.general_task_held(old.id))) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_guard on public.general_tasks;
create trigger general_tasks_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task();

/** Assignees, comments, files and logs: stamp the author, and freeze with the project. */
create or replace function public.guard_general_task_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if public.general_is_archived(p) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    case tg_table_name
      when 'general_task_assignees' then new.assigned_by := auth.uid();
      when 'general_task_comments'  then new.author_id := auth.uid();
      when 'general_task_files'     then new.uploaded_by := auth.uid();
      when 'general_task_logs'      then new.user_id := auth.uid();
      else null;
    end case;
  elsif tg_op = 'UPDATE' and tg_table_name = 'general_task_comments' then
    new.author_id := old.author_id;
    new.task_id := old.task_id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_task_assignees_guard on public.general_task_assignees;
create trigger general_task_assignees_guard before insert or delete on public.general_task_assignees
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_comments_guard on public.general_task_comments;
create trigger general_task_comments_guard before insert or update or delete on public.general_task_comments
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_files_guard on public.general_task_files;
create trigger general_task_files_guard before insert or delete on public.general_task_files
  for each row execute function public.guard_general_task_child();
drop trigger if exists general_task_logs_guard on public.general_task_logs;
create trigger general_task_logs_guard before insert or delete on public.general_task_logs
  for each row execute function public.guard_general_task_child();

-- ---------------------------------------------------------------- history

create or replace function public.record_general_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'created', jsonb_build_object('title', new.title));
    return new;
  end if;

  if new.title is distinct from old.title then changed := array_append(changed, 'title'); end if;
  if new.description is distinct from old.description then changed := array_append(changed, 'description'); end if;
  if new.status is distinct from old.status then changed := array_append(changed, 'status'); end if;
  if new.due_at is distinct from old.due_at then changed := array_append(changed, 'due_at'); end if;
  if new.team_id is distinct from old.team_id then changed := array_append(changed, 'team_id'); end if;
  if new.weight is distinct from old.weight then changed := array_append(changed, 'weight'); end if;

  if array_length(changed, 1) > 0 then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'updated',
            jsonb_build_object('fields', to_jsonb(changed), 'status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_history on public.general_tasks;
create trigger general_tasks_history after insert or update on public.general_tasks
  for each row execute function public.record_general_task_event();

create or replace function public.record_general_assignee_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.task_id, new.project_id, auth.uid(), 'assigned',
            jsonb_build_object('user_id', new.user_id));
    return new;
  end if;
  -- A task deleted with its assignees takes its history with it; nothing to record.
  if exists (select 1 from public.general_tasks where id = old.task_id) then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (old.task_id, old.project_id, auth.uid(), 'unassigned',
            jsonb_build_object('user_id', old.user_id));
  end if;
  return old;
end;
$$;

drop trigger if exists general_task_assignees_history on public.general_task_assignees;
create trigger general_task_assignees_history after insert or delete on public.general_task_assignees
  for each row execute function public.record_general_assignee_event();

-- ---------------------------------------------------------------- row-level security

alter table public.general_tasks          enable row level security;
alter table public.general_task_assignees enable row level security;
alter table public.general_task_comments  enable row level security;
alter table public.general_task_files     enable row level security;
alter table public.general_task_logs      enable row level security;
alter table public.general_task_events    enable row level security;

drop policy if exists general_tasks_select on public.general_tasks;
create policy general_tasks_select on public.general_tasks
  for select using (public.is_general_member(project_id));

drop policy if exists general_tasks_insert on public.general_tasks;
create policy general_tasks_insert on public.general_tasks
  for insert with check (public.is_general_member(project_id));

-- Who may change which task is decided in guard_general_task, which can say why.
drop policy if exists general_tasks_update on public.general_tasks;
create policy general_tasks_update on public.general_tasks
  for update using (public.is_general_member(project_id))
  with check (public.is_general_member(project_id));

drop policy if exists general_tasks_delete on public.general_tasks;
create policy general_tasks_delete on public.general_tasks
  for delete using (
    public.general_can(project_id, 'manage_tasks')
    or (created_by = auth.uid()
        and not public.general_task_held(id)
        and not public.general_is_archived(project_id))
  );

drop policy if exists general_task_assignees_select on public.general_task_assignees;
create policy general_task_assignees_select on public.general_task_assignees
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_assignees_insert on public.general_task_assignees;
create policy general_task_assignees_insert on public.general_task_assignees
  for insert with check (
    public.general_can(project_id, 'manage_tasks')
    or (user_id = auth.uid()
        and public.is_general_member(project_id)
        and not public.general_task_held(task_id))
  );

drop policy if exists general_task_assignees_delete on public.general_task_assignees;
create policy general_task_assignees_delete on public.general_task_assignees
  for delete using (public.general_can(project_id, 'manage_tasks') or user_id = auth.uid());

drop policy if exists general_task_comments_select on public.general_task_comments;
create policy general_task_comments_select on public.general_task_comments
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_comments_insert on public.general_task_comments;
create policy general_task_comments_insert on public.general_task_comments
  for insert with check (author_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_task_comments_update on public.general_task_comments;
create policy general_task_comments_update on public.general_task_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists general_task_comments_delete on public.general_task_comments;
create policy general_task_comments_delete on public.general_task_comments
  for delete using (author_id = auth.uid() or public.general_can(project_id, 'manage_tasks'));

drop policy if exists general_task_files_select on public.general_task_files;
create policy general_task_files_select on public.general_task_files
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_files_insert on public.general_task_files;
create policy general_task_files_insert on public.general_task_files
  for insert with check (
    uploaded_by = auth.uid()
    and public.is_general_member(project_id)
    and (public.is_general_task_assignee(task_id) or public.general_can(project_id, 'edit_files'))
  );

drop policy if exists general_task_files_delete on public.general_task_files;
create policy general_task_files_delete on public.general_task_files
  for delete using (uploaded_by = auth.uid() or public.general_can(project_id, 'edit_files'));

drop policy if exists general_task_logs_select on public.general_task_logs;
create policy general_task_logs_select on public.general_task_logs
  for select using (public.is_general_member(project_id));

drop policy if exists general_task_logs_insert on public.general_task_logs;
create policy general_task_logs_insert on public.general_task_logs
  for insert with check (user_id = auth.uid() and public.is_general_task_assignee(task_id));

drop policy if exists general_task_logs_delete on public.general_task_logs;
create policy general_task_logs_delete on public.general_task_logs
  for delete using (user_id = auth.uid());

drop policy if exists general_task_events_select on public.general_task_events;
create policy general_task_events_select on public.general_task_events
  for select using (public.is_general_member(project_id));

grant select, insert, update, delete on public.general_tasks, public.general_task_assignees,
  public.general_task_comments, public.general_task_files, public.general_task_logs to authenticated;
grant select on public.general_task_events to authenticated;

-- ---------------------------------------------------------------- views

drop view if exists public.general_project_overview;
create view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       -- RLS on general_join_codes leaves these null for anybody who cannot invite.
       (select jc.code from public.general_join_codes jc where jc.project_id = p.id) as join_code,
       coalesce((select jc.open from public.general_join_codes jc where jc.project_id = p.id), false)
         as join_open,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at,
       m.level as my_level,
       (select count(*) from public.general_members x where x.project_id = p.id)::int as member_count,
       coalesce(t.task_count, 0) as task_count,
       coalesce(t.done_count, 0) as done_count,
       -- Mirrors projectProgress() in src/lib/general/progress.ts.
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       -- RLS narrows this: an Owner counts every open request, a Member only their own.
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count
  from public.general_projects p
  join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id
  ) t on true;

grant select on public.general_project_overview to authenticated;

drop view if exists public.general_task_overview;
create view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce(
         (select array_agg(a.user_id order by a.assigned_at)
            from public.general_task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int as comment_count,
       (select count(*) from public.general_task_files f where f.task_id = t.id)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes
  from public.general_tasks t;

grant select on public.general_task_overview to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit)
values ('general-files', 'general-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- Paths are <project_id>/<task_id>/<random>-<file name>.
drop policy if exists general_files_read on storage.objects;
create policy general_files_read on storage.objects
  for select using (
    bucket_id = 'general-files'
    and public.is_general_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists general_files_write on storage.objects;
create policy general_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and public.general_task_project(((storage.foldername(name))[2])::uuid)
        = ((storage.foldername(name))[1])::uuid
    and (public.is_general_task_assignee(((storage.foldername(name))[2])::uuid)
         or public.general_can(((storage.foldername(name))[1])::uuid, 'edit_files'))
  );

drop policy if exists general_files_remove on storage.objects;
create policy general_files_remove on storage.objects
  for delete using (
    bucket_id = 'general-files'
    and (
      exists (select 1 from public.general_task_files f
               where f.file_path = name and f.uploaded_by = auth.uid())
      or public.general_can(((storage.foldername(name))[1])::uuid, 'edit_files')
    )
  );

-- ---------------------------------------------------------------- realtime

do $$
declare
  t text;
begin
  foreach t in array array['general_tasks', 'general_task_assignees', 'general_task_comments',
                           'general_task_files', 'general_task_logs', 'general_task_events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
```

- [ ] **Step 4: Add the file to the rebuild order**

`ORDER` in `scripts/schema-drift.mjs` ends with `workplaces general general-tasks`. In `docs/07-backup.md`, append ` supabase/general-tasks.sql` after `supabase/general.sql`.

- [ ] **Step 5: Apply and run the tests**

```bash
node scripts/db.mjs supabase/general-tasks.sql
node scripts/db.mjs supabase/tests/general-tasks.test.sql
node scripts/db.mjs supabase/tests/general.test.sql
```

Expected: `general-tasks.test.sql` prints 31 `PASS` lines, ending with `the Owner restores it`, and `general.test.sql` still prints 58.

- [ ] **Step 6: Commit**

```bash
git add supabase/general-tasks.sql supabase/tests/general-tasks.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add General workplace tasks, files, time logs and history to the database"
```

---

### Task 7: Notifications, project conversations and admin counts

**Files:**
- Create: `supabase/general-notify.sql`
- Create: `supabase/tests/general-notify.test.sql`
- Modify: `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Consumes: every table from Tasks 5 and 6, `notification_prefs` (`task_assignments`, `comments_mentions`, `deadline_reminders`), `conversations`, `conversation_members`, and `conversation_is_writable` (`supabase/messages.sql:120`).
- Produces:
  - `notification_type` values `general_invited`, `general_access_requested`, `general_access_answered`, `general_task_assigned`, `general_comment_posted` and `general_deadline_soon`
  - `notifications.general_project_id uuid` and `notifications.general_task_id uuid`
  - `conversation_kind` value `project`, and `conversations.general_project_id uuid`
  - `conversation_overview` gains a last column, `general_project_id`
  - `send_general_deadline_reminders() returns integer`, scheduled hourly as `collabify-general-deadline-reminders`
  - `general_counts() returns table(projects int, active_projects int, archived_projects int, people int)`, admin only

**Notification rule**, from `supabase/notifications.sql:32-36`: anything a person must act on, or asked for, arrives regardless of settings.
- **Always sent:** invitations, access requests to Owners, and answers to the person who asked.
- **Gated by settings:** assignments (`task_assignments`), comments (`comments_mentions`) and deadline reminders (`deadline_reminders`).

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/general-notify.test.sql
-- General notifications and conversations — rolled back at the end.
--
--   node scripts/db.mjs supabase/tests/general-notify.test.sql

begin;

-- ------------------------------------------------------------------ helpers

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  p uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-gnote-owner@example.test', '',
     jsonb_build_object('first_name', 'Zzgnote', 'last_name', 'Owner', 'workplace', 'general'), now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-gnote-bravo@example.test', '',
     jsonb_build_object('first_name', 'Zzgnote', 'last_name', 'Bravo', 'workplace', 'general'), now(), now());

  perform pg_temp.act_as(a);
  select (public.create_general_project('Zz Science fair')).id into p;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('a', a), ('b', b), ('project', p);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ conversation and invitations

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  convo uuid;
  inv uuid;
begin
  select id into convo from public.conversations where kind = 'project' and general_project_id = p;
  perform pg_temp.must_be('creating a project creates its conversation', convo is not null);
  perform pg_temp.must_be('...with the Owner in it',
    exists (select 1 from public.conversation_members where conversation_id = convo and user_id = a));

  perform pg_temp.act_as(a);
  select id into inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an invitation notifies the invited person',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_invited' and general_project_id = p));

  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting adds them to the conversation',
    exists (select 1 from public.conversation_members where conversation_id = convo and user_id = b));

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('the conversation list carries the project id',
    exists (select 1 from public.conversation_overview where id = convo and general_project_id = p));
  perform pg_temp.act_as_service();

  insert into fx values ('convo', convo);
end $$;

-- ------------------------------------------------------------------ requests, tasks, comments

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  req uuid;
  t1 uuid;
  t2 uuid;
begin
  perform pg_temp.act_as(b);
  select id into req from public.request_general_access(p, 'edit_files', 'Uploading the posters');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an access request notifies every Owner',
    exists (select 1 from public.notifications
             where user_id = a and type = 'general_access_requested' and general_project_id = p));

  perform pg_temp.act_as(a);
  perform public.answer_general_access_request(req, false, 'Ask again next week');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the answer notifies whoever asked',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_access_answered' and general_project_id = p));

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Judge sheets') returning id into t1;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t1, p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('being assigned by somebody else notifies you',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_task_assigned' and general_task_id = t1));

  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Extension cords') returning id into t2;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t2, p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('claiming a task yourself does not notify you',
    not exists (select 1 from public.notifications where user_id = b and general_task_id = t2));

  perform pg_temp.act_as(a);
  insert into public.general_task_comments (task_id, project_id, body) values (t1, p, 'Use the 2025 template');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a comment notifies whoever holds the task',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_comment_posted' and general_task_id = t1));
  perform pg_temp.must_be('...but not the person who wrote it',
    not exists (select 1 from public.notifications
                 where user_id = a and type = 'general_comment_posted' and general_task_id = t1));

  update public.general_tasks set due_at = now() + interval '2 hours' where id = t1;
  perform public.send_general_deadline_reminders();
  perform pg_temp.must_be('a task due within a day sends a reminder',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_deadline_soon' and general_task_id = t1));
  perform public.send_general_deadline_reminders();
  perform pg_temp.must_be('...once, however often the job runs',
    (select count(*) = 1 from public.notifications
      where user_id = b and type = 'general_deadline_soon' and general_task_id = t1));
end $$;

-- ------------------------------------------------------------------ writing, leaving, counts

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  convo uuid := (select v from fx where k = 'convo');
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
begin
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('a member writes in the project conversation',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Booth 4 is ours')$q$, convo, b));

  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, true);
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('nobody writes in an archived project''s conversation',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Still here')$q$, convo, b));

  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, false);
  perform public.remove_general_member(p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing a member takes them out of the conversation',
    not exists (select 1 from public.conversation_members where conversation_id = convo and user_id = b));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('only an admin reads the General counts',
    'select * from public.general_counts()');
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('an admin reads the General counts',
    'select * from public.general_counts()');
  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/general-notify.test.sql`
Expected: FAIL with `column "general_project_id" does not exist`.

- [ ] **Step 3: Write `supabase/general-notify.sql`**

```sql
-- Collabify — notifications and conversations for the General workplace.
--
--   node scripts/db.mjs supabase/general-notify.sql
--
-- Two transactions: a new enum value cannot be used in the transaction that
-- added it.
--
-- The notification rule, from supabase/notifications.sql: anything a person
-- must act on, or asked for, arrives regardless of their settings. So an
-- invitation, an access request to its Owners and the answer to whoever asked
-- are ungated; assignments, comments and deadline reminders follow the same
-- three switches Education uses.
--
-- Requires supabase/general.sql, supabase/general-tasks.sql and supabase/messages.sql.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'general_invited';
  alter type public.notification_type add value if not exists 'general_access_requested';
  alter type public.notification_type add value if not exists 'general_access_answered';
  alter type public.notification_type add value if not exists 'general_task_assigned';
  alter type public.notification_type add value if not exists 'general_comment_posted';
  alter type public.notification_type add value if not exists 'general_deadline_soon';
  alter type public.conversation_kind add value if not exists 'project';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.notifications
  add column if not exists general_project_id uuid
  references public.general_projects (id) on delete cascade;
alter table public.notifications
  add column if not exists general_task_id uuid
  references public.general_tasks (id) on delete cascade;

-- ---------------------------------------------------------------- invitations

create or replace function public.notify_general_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select new.invitee,
         'general_invited'::public.notification_type,
         p.id,
         p.name,
         coalesce(nullif(btrim(i.first_name || ' ' || i.last_name), ''), 'Somebody')
           || ' invited you to join this project'
    from public.general_projects p
    left join public.profiles i on i.id = new.invited_by
   where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists general_invitations_notify on public.general_invitations;
create trigger general_invitations_notify after insert on public.general_invitations
  for each row when (new.status = 'pending')
  execute function public.notify_general_invitation();

-- ---------------------------------------------------------------- access requests

create or replace function public.notify_general_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select o.user_id,
           'general_access_requested'::public.notification_type,
           p.id,
           p.name,
           btrim(r.first_name || ' ' || r.last_name) || ' asked for: '
             || public.general_permission_label(new.permission)
      from public.general_members o
      join public.general_projects p on p.id = o.project_id
      join public.profiles r on r.id = new.user_id
     where o.project_id = new.project_id and o.level = 'owner';
  elsif old.status = 'open' and new.status in ('approved', 'declined') then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select new.user_id,
           'general_access_answered'::public.notification_type,
           p.id,
           p.name,
           case when new.status = 'approved' then 'Approved: ' else 'Declined: ' end
             || public.general_permission_label(new.permission)
      from public.general_projects p
     where p.id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists general_access_requests_notify on public.general_access_requests;
create trigger general_access_requests_notify after insert or update on public.general_access_requests
  for each row execute function public.notify_general_access_request();

-- ---------------------------------------------------------------- tasks

create or replace function public.notify_general_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Claiming a task yourself is not news to you.
  if new.assigned_by is null or new.assigned_by = new.user_id then
    return new;
  end if;
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select new.user_id,
         'general_task_assigned'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         p.name
    from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = new.user_id
   where t.id = new.task_id and np.task_assignments;
  return new;
end;
$$;

drop trigger if exists general_task_assignees_notify on public.general_task_assignees;
create trigger general_task_assignees_notify after insert on public.general_task_assignees
  for each row execute function public.notify_general_assignment();

create or replace function public.notify_general_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select a.user_id,
         'general_comment_posted'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         left(new.body, 140)
    from public.general_task_assignees a
    join public.general_tasks t on t.id = a.task_id
    join public.notification_prefs np on np.user_id = a.user_id
   where a.task_id = new.task_id
     and a.user_id is distinct from new.author_id
     and np.comments_mentions;
  return new;
end;
$$;

drop trigger if exists general_task_comments_notify on public.general_task_comments;
create trigger general_task_comments_notify after insert on public.general_task_comments
  for each row execute function public.notify_general_comment();

/** One nudge per task per person, the day before, on a live project. */
create or replace function public.send_general_deadline_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select a.user_id,
         'general_deadline_soon'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         'Due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
    from public.general_tasks t
    join public.general_task_assignees a on a.task_id = t.id
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = a.user_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.due_at > now()
     and t.due_at <= now() + interval '24 hours'
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.user_id
          and n.general_task_id = t.id
          and n.type = 'general_deadline_soon'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke execute on function public.send_general_deadline_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-general-deadline-reminders');
exception when others then null; end $$;

-- Hourly, at half past, so it does not land on the same minute as Education's.
select cron.schedule(
  'collabify-general-deadline-reminders',
  '30 * * * *',
  $cron$ select public.send_general_deadline_reminders() $cron$
);

-- ---------------------------------------------------------------- conversations

alter table public.conversations
  add column if not exists general_project_id uuid
  references public.general_projects (id) on delete cascade;

alter table public.conversations drop constraint if exists conversations_shape;
alter table public.conversations add constraint conversations_shape check (
  (kind = 'class'   and class_id is not null and group_id is null and direct_key is null
                    and general_project_id is null) or
  (kind = 'group'   and group_id is not null and class_id is null and direct_key is null
                    and general_project_id is null) or
  (kind = 'direct'  and direct_key is not null and class_id is null and group_id is null
                    and general_project_id is null) or
  (kind = 'project' and general_project_id is not null and class_id is null and group_id is null
                    and direct_key is null)
);

create unique index if not exists conversations_one_per_general_project
  on public.conversations (general_project_id) where kind = 'project';

create or replace function public.create_general_project_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (kind, general_project_id)
  values ('project', new.id)
  on conflict (general_project_id) where kind = 'project' do nothing;
  return new;
end;
$$;

drop trigger if exists general_projects_conversation on public.general_projects;
create trigger general_projects_conversation after insert on public.general_projects
  for each row execute function public.create_general_project_conversation();

create or replace function public.sync_general_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
      from public.conversations c
     where c.kind = 'project' and c.general_project_id = new.project_id
    on conflict do nothing;
    return new;
  end if;

  delete from public.conversation_members cm
   using public.conversations c
   where c.id = cm.conversation_id
     and c.kind = 'project'
     and c.general_project_id = old.project_id
     and cm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists general_members_conversation on public.general_members;
create trigger general_members_conversation after insert or delete on public.general_members
  for each row execute function public.sync_general_conversation_member();

-- Projects that existed before this file ran.
insert into public.conversations (kind, general_project_id)
select 'project', p.id from public.general_projects p
on conflict (general_project_id) where kind = 'project' do nothing;

insert into public.conversation_members (conversation_id, user_id)
select c.id, m.user_id
  from public.general_members m
  join public.conversations c on c.kind = 'project' and c.general_project_id = m.project_id
on conflict do nothing;

/** As supabase/messages.sql, and an archived General project is read-only too. */
create or replace function public.conversation_is_writable(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
      left join public.classes gcl on gcl.id = gs.class_id
      left join public.general_projects gp on gp.id = c.general_project_id
     where c.id = p_conversation
       and coalesce(cl.archived_at, gcl.archived_at, gp.archived_at) is not null
  );
$$;

-- As supabase/messages.sql, with general_project_id appended. A column can only
-- be added at the end by `create or replace view`.
create or replace view public.conversation_overview
with (security_invoker = true) as
select c.id,
       c.kind,
       c.class_id,
       c.group_id,
       c.direct_key,
       c.updated_at,
       cm.last_read_at,
       (
         select count(*)
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at > cm.last_read_at
            and m.sender_id <> auth.uid()
            and m.deleted_at is null
       )::int as unread_count,
       (
         select m.body from public.messages m
          where m.conversation_id = c.id and m.deleted_at is null
          order by m.created_at desc limit 1
       ) as last_body,
       (
         select m.created_at from public.messages m
          where m.conversation_id = c.id
          order by m.created_at desc limit 1
       ) as last_at,
       c.general_project_id
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid();

grant select on public.conversation_overview to authenticated;

-- ---------------------------------------------------------------- admin counts

/** Counts, never content — the same rule the admin console follows for classes. */
create or replace function public.general_counts()
returns table (projects int, active_projects int, archived_projects int, people int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the program admin reads these counts'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select (select count(*) from public.general_projects)::int,
           (select count(*) from public.general_projects
             where archived_at is null and status not in ('done', 'cancelled'))::int,
           (select count(*) from public.general_projects where archived_at is not null)::int,
           (select count(distinct m.user_id) from public.general_members m)::int;
end;
$$;

grant execute on function public.general_counts() to authenticated;

commit;
```

- [ ] **Step 4: Add the file to the rebuild order**

`ORDER` in `scripts/schema-drift.mjs` ends with `workplaces general general-tasks general-notify`. In `docs/07-backup.md`, append ` supabase/general-notify.sql` after `supabase/general-tasks.sql`.

- [ ] **Step 5: Apply and run every test that touches these tables**

```bash
node scripts/db.mjs supabase/general-notify.sql
node scripts/db.mjs supabase/tests/general-notify.test.sql
node scripts/db.mjs supabase/tests/general.test.sql supabase/tests/general-tasks.test.sql supabase/tests/notifications.test.sql
node scripts/schema-drift.mjs
```

Expected:
- `general-notify.test.sql` prints 18 `PASS` lines, ending with `an admin reads the General counts`.
- The other three test files still pass.
- The drift report lists `view conversation_overview messages -> general-notify` and `function conversation_is_writable messages -> general-notify`, each with the last definition longer than the first.

- [ ] **Step 6: Commit**

```bash
git add supabase/general-notify.sql supabase/tests/general-notify.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add General workplace notifications, project conversations and admin counts"
```

---

### Task 8: General row types and API

**Files:**
- Create: `src/lib/general/types.ts`
- Create: `src/lib/api/general.ts`

**Interfaces:**
- Consumes: `FieldType` and `FieldValue` (Task 2), `GeneralLevel` and `GeneralPermission` (Task 1), `GeneralTaskStatus` (Task 3), and every table, view and RPC from Tasks 5, 6 and 7.
- Produces: every type and function listed in the code below. Later tasks import them by exactly these names.

This task has no unit test: every function is a network call, and Vitest runs without a network or a DOM. The database behavior behind each call is already covered by the SQL tests. Typecheck is the gate.

- [ ] **Step 1: Write `src/lib/general/types.ts`**

```ts
// src/lib/general/types.ts
/**
 * Row shapes for the General workplace, one per table or view in
 * supabase/general.sql, general-tasks.sql and general-notify.sql.
 */
import type { Profile } from '../types'
import type { FieldType, FieldValue } from './fields'
import type { GeneralLevel, GeneralPermission } from './permissions'
import type { GeneralTaskStatus } from './progress'

export type GeneralStatus = 'planning' | 'in_progress' | 'on_hold' | 'done' | 'cancelled'

export const PROJECT_STATUSES: { value: GeneralStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function projectStatusLabel(status: GeneralStatus) {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status
}

export type Person = Pick<Profile, 'id' | 'first_name' | 'last_name' | 'avatar_url'>

export type GeneralProject = {
  id: string
  name: string
  description: string
  starts_on: string | null
  ends_on: string | null
  status: GeneralStatus
  points_enabled: boolean
  created_by: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** general_project_overview: one row per project the viewer is on. */
export type GeneralProjectSummary = GeneralProject & {
  /** Null unless the viewer can invite. */
  join_code: string | null
  join_open: boolean
  my_level: GeneralLevel
  member_count: number
  task_count: number
  done_count: number
  progress_pct: number
  /** Every open request for an Owner; only the viewer's own for anyone else. */
  open_request_count: number
}

export type GeneralMember = {
  project_id: string
  user_id: string
  level: GeneralLevel
  joined_at: string
  profile: Person | null
}

export type GeneralTeam = { id: string; project_id: string; name: string; created_at: string }

export type GeneralTeamMember = { team_id: string; project_id: string; user_id: string }

export type GeneralPosition = {
  id: string
  project_id: string
  /** Null covers the whole project. */
  team_id: string | null
  name: string
  sort: number
  created_at: string
}

export type GeneralPositionHolder = { position_id: string; project_id: string; user_id: string }

export type GeneralGrant = {
  project_id: string
  user_id: string
  permission: GeneralPermission
  granted_by: string | null
  granted_at: string
}

export type AccessRequestStatus = 'open' | 'approved' | 'declined' | 'withdrawn'

export type GeneralAccessRequest = {
  id: string
  project_id: string
  user_id: string
  permission: GeneralPermission
  reason: string
  status: AccessRequestStatus
  answered_by: string | null
  answered_at: string | null
  note: string
  created_at: string
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn'

export type GeneralInvitation = {
  id: string
  project_id: string
  invitee: string
  invited_by: string | null
  status: InviteStatus
  created_at: string
  answered_at: string | null
}

/** A pending invitation on the project page, with who was invited. */
export type ProjectInvitation = GeneralInvitation & { invitee_profile: Person | null }

/** A pending invitation on the invited person's home page. */
export type MyInvitation = GeneralInvitation & {
  project: Pick<GeneralProject, 'id' | 'name' | 'description'> | null
  inviter: Person | null
}

export type GeneralField = {
  id: string
  project_id: string
  name: string
  type: FieldType
  options: string[]
  sort: number
  created_at: string
}

export type GeneralFieldValue = {
  field_id: string
  value: FieldValue
  updated_by: string | null
  updated_at: string
}

/** general_task_overview. */
export type GeneralTask = {
  id: string
  project_id: string
  team_id: string | null
  title: string
  description: string
  status: GeneralTaskStatus
  due_at: string | null
  weight: number
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  assignee_ids: string[]
  comment_count: number
  file_count: number
  logged_minutes: number
}

export type GeneralComment = {
  id: string
  task_id: string
  project_id: string
  author_id: string | null
  body: string
  created_at: string
  edited_at: string | null
}

export type GeneralFile = {
  id: string
  task_id: string
  project_id: string
  uploaded_by: string | null
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  created_at: string
}

export type GeneralLog = {
  id: string
  task_id: string
  project_id: string
  user_id: string
  minutes: number
  note: string
  logged_on: string
  created_at: string
}

export type GeneralTaskEvent = {
  id: string
  task_id: string
  project_id: string
  actor_id: string | null
  kind: 'created' | 'updated' | 'assigned' | 'unassigned'
  detail: { title?: string; fields?: string[]; status?: GeneralTaskStatus; user_id?: string }
  created_at: string
}

export type PersonHit = {
  person_id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  /** Only set when the search was that exact address. */
  email: string | null
}

export type GeneralCounts = {
  projects: number
  active_projects: number
  archived_projects: number
  people: number
}
```

- [ ] **Step 2: Write `src/lib/api/general.ts`**

```ts
// src/lib/api/general.ts
/**
 * Every call the General workplace makes.
 *
 * Membership, levels, grants, requests, invitations, join codes and archiving
 * go through RPCs; the tables have no write policy for them. Teams, positions,
 * fields and tasks are written directly and fenced by row-level security, so a
 * write that RLS filters out changes nothing *without an error*. `changed()`
 * turns that silence into a message.
 */
import { supabase } from '../supabase'
import type { FieldType, FieldValue } from '../general/fields'
import type { GeneralLevel, GeneralPermission } from '../general/permissions'
import type { GeneralTaskStatus } from '../general/progress'
import type {
  GeneralAccessRequest,
  GeneralComment,
  GeneralCounts,
  GeneralField,
  GeneralFieldValue,
  GeneralFile,
  GeneralGrant,
  GeneralLog,
  GeneralMember,
  GeneralPosition,
  GeneralPositionHolder,
  GeneralProject,
  GeneralProjectSummary,
  GeneralStatus,
  GeneralTask,
  GeneralTaskEvent,
  GeneralTeam,
  GeneralTeamMember,
  MyInvitation,
  PersonHit,
  ProjectInvitation,
} from '../general/types'

const PERSON = 'id, first_name, last_name, avatar_url'
const BUCKET = 'general-files'
export const GENERAL_FILE_LIMIT = 25 * 1024 * 1024

function changed<T>(rows: T[] | null, message: string): T[] {
  if (!rows || rows.length === 0) throw new Error(message)
  return rows
}

/* ---------------------------------------------------------------- projects */

export async function listMyGeneralProjects() {
  const { data, error } = await supabase
    .from('general_project_overview')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralProjectSummary[]
}

export async function getGeneralProject(projectId: string) {
  const { data, error } = await supabase
    .from('general_project_overview')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  return (data as GeneralProjectSummary | null) ?? null
}

export async function createGeneralProject(input: {
  name: string
  description: string
  startsOn: string | null
  endsOn: string | null
}) {
  const { data, error } = await supabase.rpc('create_general_project', {
    p_name: input.name,
    p_description: input.description,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
  })
  if (error) throw error
  return data as GeneralProject
}

export type ProjectPatch = Partial<{
  name: string
  description: string
  starts_on: string | null
  ends_on: string | null
  status: GeneralStatus
  points_enabled: boolean
}>

export async function updateGeneralProject(projectId: string, patch: ProjectPatch) {
  const { data, error } = await supabase
    .from('general_projects')
    .update(patch)
    .eq('id', projectId)
    .select('id')
  if (error) throw error
  changed(data, 'You do not have permission to edit this project.')
}

export async function archiveGeneralProject(projectId: string, archived: boolean) {
  const { error } = await supabase.rpc('archive_general_project', {
    p_project: projectId,
    p_archived: archived,
  })
  if (error) throw error
}

export async function setJoinCode(projectId: string, open: boolean, regenerate = false) {
  const { data, error } = await supabase.rpc('set_general_join_code', {
    p_project: projectId,
    p_open: open,
    p_regenerate: regenerate,
  })
  if (error) throw error
  return (data as string | null) ?? null
}

export async function joinGeneralProject(code: string) {
  const { data, error } = await supabase.rpc('join_general_project', { p_code: code })
  if (error) throw error
  return data as string
}

/* ---------------------------------------------------------------- members */

export async function listGeneralMembers(projectId: string) {
  const { data, error } = await supabase
    .from('general_members')
    .select(`project_id, user_id, level, joined_at, profile:profiles (${PERSON})`)
    .eq('project_id', projectId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []) as unknown as GeneralMember[]
}

export async function setMemberLevel(projectId: string, userId: string, level: GeneralLevel) {
  const { error } = await supabase.rpc('set_general_member_level', {
    p_project: projectId,
    p_user: userId,
    p_level: level,
  })
  if (error) throw error
}

export async function removeMember(projectId: string, userId: string) {
  const { error } = await supabase.rpc('remove_general_member', {
    p_project: projectId,
    p_user: userId,
  })
  if (error) throw error
}

export async function leaveProject(projectId: string) {
  const { error } = await supabase.rpc('leave_general_project', { p_project: projectId })
  if (error) throw error
}

/* ---------------------------------------------------------------- permissions */

export async function listGrants(projectId: string) {
  const { data, error } = await supabase
    .from('general_grants')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralGrant[]
}

export async function grantPermission(projectId: string, userId: string, permission: GeneralPermission) {
  const { error } = await supabase.rpc('grant_general_permission', {
    p_project: projectId,
    p_user: userId,
    p_permission: permission,
  })
  if (error) throw error
}

export async function revokePermission(projectId: string, userId: string, permission: GeneralPermission) {
  const { error } = await supabase.rpc('revoke_general_permission', {
    p_project: projectId,
    p_user: userId,
    p_permission: permission,
  })
  if (error) throw error
}

/** RLS narrows this: an Owner gets every request, anyone else only their own. */
export async function listAccessRequests(projectId: string) {
  const { data, error } = await supabase
    .from('general_access_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralAccessRequest[]
}

export async function requestAccess(projectId: string, permission: GeneralPermission, reason: string) {
  const { error } = await supabase.rpc('request_general_access', {
    p_project: projectId,
    p_permission: permission,
    p_reason: reason,
  })
  if (error) throw error
}

export async function answerAccessRequest(requestId: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc('answer_general_access_request', {
    p_request: requestId,
    p_approve: approve,
    p_note: note,
  })
  if (error) throw error
}

export async function withdrawAccessRequest(requestId: string) {
  const { error } = await supabase.rpc('withdraw_general_access_request', { p_request: requestId })
  if (error) throw error
}

/* ---------------------------------------------------------------- invitations */

export async function searchPeople(query: string) {
  const { data, error } = await supabase.rpc('search_general_people', { p_query: query })
  if (error) throw error
  return (data ?? []) as PersonHit[]
}

export async function inviteToProject(projectId: string, userId: string) {
  const { error } = await supabase.rpc('invite_to_general_project', {
    p_project: projectId,
    p_user: userId,
  })
  if (error) throw error
}

export async function listProjectInvitations(projectId: string) {
  const { data, error } = await supabase
    .from('general_invitations')
    .select(`*, invitee_profile:profiles!general_invitations_invitee_fkey (${PERSON})`)
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ProjectInvitation[]
}

export async function withdrawInvitation(invitationId: string) {
  const { error } = await supabase.rpc('withdraw_general_invitation', { p_invitation: invitationId })
  if (error) throw error
}

export async function listMyInvitations(userId: string) {
  const { data, error } = await supabase
    .from('general_invitations')
    .select(
      `*, project:general_projects (id, name, description), inviter:profiles!general_invitations_invited_by_fkey (${PERSON})`,
    )
    .eq('invitee', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as MyInvitation[]
}

export async function respondToInvitation(invitationId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_general_invitation', {
    p_invitation: invitationId,
    p_accept: accept,
  })
  if (error) throw error
}

/* ---------------------------------------------------------------- teams and positions */

const NO_STRUCTURE = 'You do not have permission to manage teams and positions.'

export async function listTeams(projectId: string) {
  const { data, error } = await supabase
    .from('general_teams')
    .select('*')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return (data ?? []) as GeneralTeam[]
}

export async function createTeam(projectId: string, name: string) {
  const { error } = await supabase.from('general_teams').insert({ project_id: projectId, name: name.trim() })
  if (error) throw error
}

export async function renameTeam(teamId: string, name: string) {
  const { data, error } = await supabase
    .from('general_teams')
    .update({ name: name.trim() })
    .eq('id', teamId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function deleteTeam(teamId: string) {
  const { data, error } = await supabase.from('general_teams').delete().eq('id', teamId).select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listTeamMembers(projectId: string) {
  const { data, error } = await supabase
    .from('general_team_members')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralTeamMember[]
}

export async function addTeamMember(teamId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_team_members')
    .insert({ team_id: teamId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function removeTeamMember(teamId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('team_id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listPositions(projectId: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .select('*')
    .eq('project_id', projectId)
    .order('sort')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralPosition[]
}

export async function createPosition(projectId: string, name: string, teamId: string | null, sort: number) {
  const { error } = await supabase
    .from('general_positions')
    .insert({ project_id: projectId, name: name.trim(), team_id: teamId, sort })
  if (error) throw error
}

export async function renamePosition(positionId: string, name: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .update({ name: name.trim() })
    .eq('id', positionId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function deletePosition(positionId: string) {
  const { data, error } = await supabase
    .from('general_positions')
    .delete()
    .eq('id', positionId)
    .select('id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

export async function listPositionHolders(projectId: string) {
  const { data, error } = await supabase
    .from('general_position_holders')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as GeneralPositionHolder[]
}

export async function addPositionHolder(positionId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_position_holders')
    .insert({ position_id: positionId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function removePositionHolder(positionId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_position_holders')
    .delete()
    .eq('position_id', positionId)
    .eq('user_id', userId)
    .select('position_id')
  if (error) throw error
  changed(data, NO_STRUCTURE)
}

/* ---------------------------------------------------------------- fields */

const NO_FIELDS = 'You do not have permission to edit this project.'

export async function listFields(projectId: string) {
  const { data, error } = await supabase
    .from('general_fields')
    .select('*')
    .eq('project_id', projectId)
    .order('sort')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralField[]
}

export async function createField(input: {
  projectId: string
  name: string
  type: FieldType
  options: string[]
  sort: number
}) {
  const { error } = await supabase.from('general_fields').insert({
    project_id: input.projectId,
    name: input.name.trim(),
    type: input.type,
    options: input.options.map((o) => o.trim()),
    sort: input.sort,
  })
  if (error) throw error
}

export async function updateField(
  fieldId: string,
  patch: Partial<{ name: string; type: FieldType; options: string[]; sort: number }>,
) {
  const { data, error } = await supabase
    .from('general_fields')
    .update(patch)
    .eq('id', fieldId)
    .select('id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

export async function deleteField(fieldId: string) {
  const { data, error } = await supabase.from('general_fields').delete().eq('id', fieldId).select('id')
  if (error) throw error
  changed(data, NO_FIELDS)
}

export async function listFieldValues(fieldIds: string[]) {
  if (fieldIds.length === 0) return []
  const { data, error } = await supabase
    .from('general_field_values')
    .select('*')
    .in('field_id', fieldIds)
  if (error) throw error
  return (data ?? []) as GeneralFieldValue[]
}

export async function setFieldValue(fieldId: string, value: FieldValue) {
  const { error } = await supabase
    .from('general_field_values')
    .upsert({ field_id: fieldId, value }, { onConflict: 'field_id' })
  if (error) throw error
}

export async function clearFieldValue(fieldId: string) {
  const { error } = await supabase.from('general_field_values').delete().eq('field_id', fieldId)
  if (error) throw error
}

/* ---------------------------------------------------------------- tasks */

export async function listTasks(projectId: string) {
  const { data, error } = await supabase
    .from('general_task_overview')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralTask[]
}

export async function createTask(input: {
  projectId: string
  title: string
  description: string
  dueAt: string | null
  teamId: string | null
  weight: number
}) {
  const { data, error } = await supabase
    .from('general_tasks')
    .insert({
      project_id: input.projectId,
      title: input.title.trim(),
      description: input.description,
      due_at: input.dueAt,
      team_id: input.teamId,
      weight: input.weight,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export type TaskPatch = Partial<{
  title: string
  description: string
  status: GeneralTaskStatus
  due_at: string | null
  team_id: string | null
  weight: number
}>

export async function updateTask(taskId: string, patch: TaskPatch) {
  const { data, error } = await supabase
    .from('general_tasks')
    .update(patch)
    .eq('id', taskId)
    .select('id')
  if (error) throw error
  changed(data, 'You cannot change this task.')
}

export async function deleteTask(taskId: string) {
  const { data, error } = await supabase.from('general_tasks').delete().eq('id', taskId).select('id')
  if (error) throw error
  changed(data, 'Only its creator, before anyone takes it, or someone who manages tasks can remove this.')
}

export async function assignTask(taskId: string, projectId: string, userId: string) {
  const { error } = await supabase
    .from('general_task_assignees')
    .insert({ task_id: taskId, project_id: projectId, user_id: userId })
  if (error) throw error
}

export async function unassignTask(taskId: string, userId: string) {
  const { data, error } = await supabase
    .from('general_task_assignees')
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .select('task_id')
  if (error) throw error
  changed(data, 'You cannot take this person off the task.')
}

export async function listComments(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralComment[]
}

export async function addComment(taskId: string, projectId: string, body: string) {
  const { error } = await supabase
    .from('general_task_comments')
    .insert({ task_id: taskId, project_id: projectId, body: body.trim() })
  if (error) throw error
}

export async function deleteComment(commentId: string) {
  const { data, error } = await supabase
    .from('general_task_comments')
    .delete()
    .eq('id', commentId)
    .select('id')
  if (error) throw error
  changed(data, 'You cannot remove this comment.')
}

export async function listFiles(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_files')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as GeneralFile[]
}

export async function uploadTaskFile(projectId: string, taskId: string, file: File) {
  if (file.size > GENERAL_FILE_LIMIT) throw new Error('Files can be up to 25 MB.')
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-120)
  // The storage policy reads the project and task off the first two segments.
  const path = `${projectId}/${taskId}/${crypto.randomUUID()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { error } = await supabase.from('general_task_files').insert({
    task_id: taskId,
    project_id: projectId,
    file_path: path,
    file_name: file.name.slice(0, 255),
    mime_type: file.type || null,
    size_bytes: file.size,
  })
  if (error) {
    // Do not leave an orphan object behind if the row is rejected.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

/** Storage first: the remove policy reads the row to know who uploaded it. */
export async function deleteTaskFile(file: GeneralFile) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([file.file_path])
  if (storageError) throw storageError
  const { data, error } = await supabase
    .from('general_task_files')
    .delete()
    .eq('id', file.id)
    .select('id')
  if (error) throw error
  changed(data, 'You cannot remove this file.')
}

/** The bucket is private, so viewing goes through a ten-minute signed URL. */
export async function generalFileUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

export async function listLogs(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_logs')
    .select('*')
    .eq('task_id', taskId)
    .order('logged_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralLog[]
}

export async function addLog(taskId: string, projectId: string, minutes: number, note: string) {
  const { error } = await supabase
    .from('general_task_logs')
    .insert({ task_id: taskId, project_id: projectId, minutes, note: note.trim() })
  if (error) throw error
}

export async function deleteLog(logId: string) {
  const { data, error } = await supabase.from('general_task_logs').delete().eq('id', logId).select('id')
  if (error) throw error
  changed(data, 'You can only remove your own time entries.')
}

export async function listTaskEvents(taskId: string) {
  const { data, error } = await supabase
    .from('general_task_events')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GeneralTaskEvent[]
}

/* ---------------------------------------------------------------- admin */

export async function generalCounts() {
  const { data, error } = await supabase.rpc('general_counts')
  if (error) throw error
  const row = ((data ?? []) as GeneralCounts[])[0]
  return row ?? { projects: 0, active_projects: 0, archived_projects: 0, people: 0 }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit code 0, no output after the `tsc -b --noEmit` line.

- [ ] **Step 4: Commit**

```bash
git add src/lib/general/types.ts src/lib/api/general.ts
git commit -m "Add General workplace row types and API calls"
```

---

### Task 9: Workplace-aware accounts and routing

**Files:**
- Create: `src/lib/workplace.ts`
- Test: `src/lib/workplace.test.ts`
- Create: `src/pages/auth/EnterEducation.tsx`
- Delete: `src/lib/roleHome.ts`
- Modify: `src/lib/types.ts` (`Profile`, `Account`)
- Modify: `src/context/AuthContext.tsx`
- Modify: `src/routes/ProtectedRoute.tsx`
- Modify: `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`, `src/pages/auth/Pending.tsx`, `src/pages/auth/AuthCallback.tsx`
- Modify: `src/components/app/nav.ts`, `src/components/app/TopNav.tsx`, `src/components/app/AppShell.tsx`, `src/components/app/NotificationBell.tsx`
- Modify: `src/pages/app/admin/Accounts.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `profiles.home_workplace`, nullable `profiles.role`, and `enter_education` (Task 4).
- Produces:
  - `type Workplace = 'education' | 'general'`
  - `educationHome(profile: HomeProfile): string`
  - `homeFor(profile: HomeProfile | null | undefined): string`
  - `workplaceOf(pathname: string, home: Workplace): Workplace`
  - `type HomeProfile = Pick<Profile, 'role' | 'status' | 'home_workplace'>`
  - `Profile.role: Role | null` and `Profile.home_workplace: Workplace`
  - `useAuth().enterEducation(role: 'student' | 'professor'): Promise<Profile>`
  - `SignUpInput.workplace` and `completeOnboarding({ workplace })`
  - `<ProtectedRoute workplace="education" | "general" allow={…} />`
  - `GENERAL_NAV: NavGroup[]` and `navForWorkplace(workplace: Workplace, role: Role | null): NavGroup[]`
  - Route `/education/enter`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/workplace.test.ts
import { describe, expect, it } from 'vitest'
import { educationHome, homeFor, workplaceOf } from './workplace'

const p = (
  role: 'student' | 'professor' | 'admin' | null,
  status: 'active' | 'pending' | 'rejected',
  home_workplace: 'education' | 'general',
) => ({ role, status, home_workplace })

describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops a deactivated account at the door, whichever workplace', () => {
    expect(homeFor(p('student', 'rejected', 'education'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected', 'general'))).toBe('/pending')
  })

  it('keeps the admin on the console', () => {
    expect(homeFor(p('admin', 'active', 'education'))).toBe('/admin')
  })

  it('lands a General account in General, even as a pending professor', () => {
    expect(homeFor(p(null, 'active', 'general'))).toBe('/general')
    expect(homeFor(p('professor', 'pending', 'general'))).toBe('/general')
  })

  it('lands an Education account where it always did', () => {
    expect(homeFor(p('student', 'active', 'education'))).toBe('/student')
    expect(homeFor(p('professor', 'pending', 'education'))).toBe('/pending')
    expect(homeFor(p(null, 'active', 'education'))).toBe('/education/enter')
  })
})

describe('educationHome', () => {
  it('asks for a role before anything else', () => {
    expect(educationHome(p(null, 'active', 'general'))).toBe('/education/enter')
  })

  it('parks a pending professor and opens an approved one', () => {
    expect(educationHome(p('professor', 'pending', 'general'))).toBe('/pending')
    expect(educationHome(p('professor', 'active', 'general'))).toBe('/professor')
  })
})

describe('workplaceOf', () => {
  it('reads General from its own section', () => {
    expect(workplaceOf('/general', 'education')).toBe('general')
    expect(workplaceOf('/general/projects/abc', 'education')).toBe('general')
  })

  it('does not mistake a lookalike path for General', () => {
    expect(workplaceOf('/generally', 'education')).toBe('education')
  })

  it('reads Education from the role sections', () => {
    expect(workplaceOf('/student/tasks', 'general')).toBe('education')
    expect(workplaceOf('/professor', 'general')).toBe('education')
    expect(workplaceOf('/education/enter', 'general')).toBe('education')
  })

  it('uses the home workplace on shared pages', () => {
    expect(workplaceOf('/settings', 'general')).toBe('general')
    expect(workplaceOf('/privacy/request', 'education')).toBe('education')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/workplace.test.ts`
Expected: FAIL with `Failed to resolve import "./workplace"`

- [ ] **Step 3: Write `src/lib/workplace.ts`**

```ts
// src/lib/workplace.ts
/**
 * The two workplaces, and where somebody belongs in them.
 *
 * One account uses both. `home_workplace` is only where sign-in lands; the
 * switcher in the top bar opens the other. Education needs a student or
 * professor role, which an account that registered for General does not have
 * until it enters Education once. General needs nothing but an active account.
 *
 * `rejected` is what the admin's Deactivate sets (supabase/accounts.sql), so it
 * closes both workplaces. `pending` is a professor waiting for approval, which
 * closes only Education.
 */
import type { Profile, Role } from './types'

export type Workplace = 'education' | 'general'

export type HomeProfile = Pick<Profile, 'role' | 'status' | 'home_workplace'>

const EDUCATION_HOME: Record<Role, string> = {
  student: '/student',
  professor: '/professor',
  admin: '/admin',
}

export function educationHome(profile: HomeProfile): string {
  if (profile.status === 'rejected') return '/pending'
  if (!profile.role) return '/education/enter'
  if (profile.status === 'pending') return '/pending'
  return EDUCATION_HOME[profile.role]
}

export function homeFor(profile: HomeProfile | null | undefined): string {
  if (!profile) return '/onboarding'
  if (profile.status === 'rejected') return '/pending'
  if (profile.role === 'admin') return '/admin'
  if (profile.home_workplace === 'general') return '/general'
  return educationHome(profile)
}

export function workplaceOf(pathname: string, home: Workplace): Workplace {
  if (pathname === '/general' || pathname.startsWith('/general/')) return 'general'
  if (/^\/(student|professor|admin|education)(\/|$)/.test(pathname)) return 'education'
  return home
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/workplace.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Update the profile types**

In `src/lib/types.ts`, add the import at the top:

```ts
import type { Workplace } from './workplace'
```

Change `Profile` to:

```ts
export type Profile = {
  id: string
  email: string
  first_name: string
  middle_name: string | null
  last_name: string
  /** Null until the account enters the Education workplace. */
  role: Role | null
  status: AccountStatus
  avatar_url: string | null
  theme: ThemeMode
  /** Where sign-in lands. Both workplaces stay open either way. */
  home_workplace: Workplace
  created_at: string
  updated_at: string
}
```

In the `Account` type (around `src/lib/types.ts:1192`), change `role: Role` to:

```ts
  /** Null for an account that has only used the General workplace. */
  role: Role | null
```

- [ ] **Step 6: Add workplaces to the auth context**

In `src/context/AuthContext.tsx`:

Add the import:

```ts
import type { Workplace } from '../lib/workplace'
```

Replace `SignUpInput` with:

```ts
type SignUpInput = {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  password: string
  workplace: Workplace
  /** Required for Education, ignored for General. */
  role: Exclude<Role, 'admin'> | null
}
```

In `AuthValue`, replace the `completeOnboarding` entry and add `enterEducation`:

```ts
  completeOnboarding: (input: {
    firstName: string
    middleName?: string
    lastName: string
    workplace: Workplace
    role: Exclude<Role, 'admin'> | null
  }) => Promise<void>
  enterEducation: (role: Exclude<Role, 'admin'>) => Promise<Profile>
```

In `signUpWithEmail`, replace the `role: input.role,` line in `data` with:

```ts
          role: input.workplace === 'education' ? input.role : null,
          workplace: input.workplace,
```

In `completeOnboarding`, replace the `row` object with:

```ts
      const role = input.workplace === 'education' ? input.role : null
      const row = {
        id: session.user.id,
        email: session.user.email ?? '',
        first_name: input.firstName.trim(),
        middle_name: input.middleName?.trim() || null,
        last_name: input.lastName.trim(),
        role,
        // guard_profile_insert derives this anyway; sending the right value
        // keeps the returned row honest on the first render.
        status: role === 'professor' ? 'pending' : 'active',
        home_workplace: input.workplace,
        avatar_url:
          (session.user.user_metadata?.avatar_url as string | undefined) ?? null,
      }
```

After `completeOnboarding`, add:

```ts
  const enterEducation = useCallback<AuthValue['enterEducation']>(async (role) => {
    const { data, error } = await supabase.rpc('enter_education', { p_role: role })
    if (error) throw error
    const next = data as Profile
    setProfile(next)
    return next
  }, [])
```

Add `enterEducation` to both the object and the dependency array of the `useMemo` that builds `value`, next to `completeOnboarding`.

- [ ] **Step 7: Make the route guard workplace-aware**

Replace `src/routes/ProtectedRoute.tsx` with:

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/workplace'
import type { Workplace } from '../lib/workplace'
import type { Role } from '../lib/types'

function Booting() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5">
        <LogoMark size={44} />
        <Spinner size={18} className="text-muted" />
      </div>
    </div>
  )
}

/**
 * `workplace` says which door this is.
 *
 * - Education needs a role and an active account, as every page did before.
 * - General needs only an account that is not deactivated, so a professor
 *   waiting on approval can still work there.
 * - No workplace (Settings, Your data) is the same as General: every account
 *   is owed its own settings and its own data.
 */
export function ProtectedRoute({ allow, workplace }: { allow?: Role[]; workplace?: Workplace }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (workplace !== 'education') return <Outlet />

  if (!profile.role) return <Navigate to="/education/enter" replace />
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />

  return <Outlet />
}
```

- [ ] **Step 8: Write the Enter Education page**

```tsx
// src/pages/auth/EnterEducation.tsx
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { RoleChoice } from '../../components/ui/RoleChoice'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { educationHome } from '../../lib/workplace'
import type { Role } from '../../lib/types'

/**
 * The one time an account that registered for General says whether it takes
 * classes or teaches them. `enter_education` refuses a second call, so this
 * page is never a way to change a role — that stays with the program admin.
 */
export default function EnterEducation() {
  const { ready, session, profile, enterEducation } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<Exclude<Role, 'admin'>>('student')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Open Education · Collabify'
  }, [])

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && !profile) return <Navigate to="/onboarding" replace />
  if (profile?.role) return <Navigate to={educationHome(profile)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const next = await enterEducation(role)
      navigate(educationHome(next), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not open Education for this account.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Open the Education workplace"
      subtitle="Education is for class projects. Say whether you take classes or teach them. You choose this once."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <RoleChoice value={role} onChange={setRole} />

        {role === 'professor' && (
          <Alert tone="info">
            The program office reviews professor accounts before teaching tools unlock. The
            General workplace keeps working while you wait.
          </Alert>
        )}

        <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
          Open Education
        </Button>

        <Link
          to="/general"
          className="block text-center text-[13px] font-medium text-muted hover:text-ink"
        >
          Back to the General workplace
        </Link>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 9: Replace `roleHome` everywhere and delete it**

Delete `src/lib/roleHome.ts`. Then:

`src/pages/auth/AuthCallback.tsx`: change the import to `import { homeFor } from '../../lib/workplace'`, and the navigate call to:

```ts
    navigate(homeFor(profile), { replace: true })
```

`homeFor(null)` is already `/onboarding`.

`src/pages/auth/Onboarding.tsx`: change the import to `import { homeFor } from '../../lib/workplace'`. Change line 45 to:

```tsx
  if (ready && profile) return <Navigate to={homeFor(profile)} replace />
```

Pass `workplace: 'education'` into `completeOnboarding`, and navigate with the same rule:

```ts
      await completeOnboarding({ firstName, middleName, lastName, role, workplace: 'education' })
      navigate(role === 'professor' ? '/pending' : '/student', { replace: true })
```

Task 10 replaces this with a workplace choice.

`src/pages/auth/Register.tsx`: add `workplace: 'education',` to the `signUpWithEmail({...})` call. Task 10 replaces this with a workplace choice.

`src/pages/auth/Pending.tsx`: change the import to `import { homeFor } from '../../lib/workplace'` and add `Link` to the react-router import. Replace the redirect with:

```tsx
  if (ready && profile && profile.status === 'active')
    return <Navigate to={homeFor(profile)} replace />
```

Change the `title` and `subtitle` so a deactivated account is not told it was only "not approved":

```tsx
      title={rejected ? 'Account not active' : 'Waiting on approval'}
      subtitle={
        rejected
          ? 'The program admin has not approved this account, or has deactivated it.'
          : 'Your professor account is with the program admin.'
      }
```

Directly after the `Check again` button block, add:

```tsx
        {!rejected && (
          <Link
            to="/general"
            className="block rounded-xl border border-line px-4 py-3 text-center text-[14px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
          >
            Use the General workplace while you wait
          </Link>
        )}
```

- [ ] **Step 10: Give the shell a nav for each workplace**

In `src/components/app/nav.ts`, add the import and, above `navFor`, the General rail and the chooser:

```ts
import type { Workplace } from '../../lib/workplace'

/**
 * General is small on purpose. Its projects page is the spine, and a project
 * holds everything else — tasks, members and positions live inside it rather
 * than as pages of their own.
 */
export const GENERAL_NAV: NavGroup[] = [
  {
    title: 'Workplace',
    items: [
      { label: 'Projects', icon: 'kanban', to: '/general' },
      { label: 'Messages', icon: 'message', to: '/general/messages', badge: 'messages' },
    ],
  },
  SETTINGS,
]

/** An account with no Education role only ever sees General's rail. */
export function navForWorkplace(workplace: Workplace, role: Role | null): NavGroup[] {
  if (workplace === 'general' || !role) return GENERAL_NAV
  return BY_ROLE[role]
}
```

In `src/components/app/TopNav.tsx`:
- Replace the `roleHome` import with `import { homeFor, workplaceOf } from '../../lib/workplace'`.
- Replace the `navFor` import with `import { navForWorkplace } from './nav'`.
- Add `useLocation` to the react-router import if it is not there.
- In `AccountMenu`, change `{ROLE_LABEL[profile.role]}` to `{profile.role ? ROLE_LABEL[profile.role] : 'General workplace'}`.

In `TopNav`, add `const location = useLocation()` at the top, next to `useAuth`, and replace `const groups = navFor(profile.role)` with:

```tsx
  const workplace = workplaceOf(location.pathname, profile.home_workplace)
  const groups = navForWorkplace(workplace, profile.role)
```

Replace the logo link target `roleHome(profile.role, profile.status)` with:

```tsx
workplace === 'general' ? '/general' : homeFor(profile)
```

In `src/components/app/AppShell.tsx`:
- Replace `import { roleHome } from '../../lib/roleHome'` with `import { homeFor, workplaceOf } from '../../lib/workplace'`.
- Replace `import { navFor } from './nav'` with `import { navForWorkplace } from './nav'`.
- In `DrawerNav`, add `const location = useLocation()` (import `useLocation` from `react-router-dom`).
- Replace `navFor(profile.role)` with `navForWorkplace(workplaceOf(location.pathname, profile.home_workplace), profile.role)`.
- Replace both `roleHome(profile?.role, profile?.status)` calls with `homeFor(profile)`.

In `src/components/app/NotificationBell.tsx`, replace `const base = ROLE_BASE[profile.role]` with:

```ts
    const base = profile.role ? ROLE_BASE[profile.role] : '/general'
```

In `src/pages/app/admin/Accounts.tsx:202`, replace `{ROLE_LABEL[a.role]}` with:

```tsx
{a.role ? ROLE_LABEL[a.role] : 'General only'}
```

- [ ] **Step 11: Wire the routes**

In `src/App.tsx`:

Add the lazy import next to the others:

```tsx
const EnterEducation = lazy(() => import('./pages/auth/EnterEducation'))
```

Add the route next to `/pending`:

```tsx
          <Route path="/education/enter" element={<EnterEducation />} />
```

Add `workplace="education"` to the three role groups:

```tsx
          <Route element={<ProtectedRoute workplace="education" allow={['student']} />}>
          <Route element={<ProtectedRoute workplace="education" allow={['professor']} />}>
          <Route element={<ProtectedRoute workplace="education" allow={['admin']} />}>
```

The shared group (`/settings`, `/privacy/request`) keeps `<ProtectedRoute />` with no props.

- [ ] **Step 12: Typecheck, lint and run every unit test**

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
npm run test
```

Expected:
- Typecheck exits 0. If it reports `role` possibly null in a file this task did not list, that page only renders inside Education routes, where `ProtectedRoute` guarantees a role. Narrow it with `profile.role ?? 'student'` only if the page is Education-only, and add the file to this task's commit.
- Lint reports `23 problems (0 errors, 23 warnings)`.
- Tests: every file passes, including `workplace.test.ts` (11 tests).

- [ ] **Step 13: Check in the browser that Education is unchanged**

Start the dev server with `preview_start` `{ name: "collabify" }`. Then:
1. Sign in as an existing professor. The browser lands on `/professor`, the nav is unchanged, and the account menu says "Professor".
2. Open `/education/enter`. It redirects straight back to `/professor`, because the account already has a role.
3. Open `/settings`. It renders.

- [ ] **Step 14: Commit**

```bash
git add -A src/lib/workplace.ts src/lib/workplace.test.ts src/lib/roleHome.ts src/lib/types.ts src/context/AuthContext.tsx src/routes/ProtectedRoute.tsx src/pages/auth src/components/app/nav.ts src/components/app/TopNav.tsx src/components/app/AppShell.tsx src/components/app/NotificationBell.tsx src/pages/app/admin/Accounts.tsx src/App.tsx
git commit -m "Route accounts by workplace and let a General account enter Education once"
```

---

### Task 10: Register for General, switch workplaces, and the General home

**Files:**
- Create: `src/lib/general/dates.ts`
- Test: `src/lib/general/dates.test.ts`
- Create: `src/components/auth/WorkplaceChoice.tsx`
- Create: `src/components/app/WorkplaceSwitcher.tsx`
- Create: `src/components/general/NewProjectDialog.tsx`
- Create: `src/pages/general/GeneralHome.tsx`
- Modify: `src/lib/limits.ts`
- Modify: `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`
- Modify: `src/components/app/TopNav.tsx`, `src/components/app/AppShell.tsx`, `src/components/app/NotificationBell.tsx`
- Modify: `src/lib/types.ts` (`AppNotification`, `ConversationKind`, `ConversationRow`)
- Modify: `src/lib/api/messages.ts`, `src/components/messages/ConversationList.tsx`, `src/components/messages/MessageThread.tsx`, `src/pages/app/messages/Messages.tsx`
- Modify: `src/pages/app/AdminHome.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 8's `listMyGeneralProjects`, `listMyInvitations`, `respondToInvitation`, `joinGeneralProject`, `createGeneralProject` and `generalCounts`. Task 9's `Workplace`, `educationHome` and `workplaceOf`.
- Produces:
  - `formatDay(day: string): string`, `dateRange(start: string | null, end: string | null): string`, `formatDue(iso: string): string`, `isOverdue(iso: string | null, status: string, now?: number): boolean`, `toLocalInput(iso: string | null): string`, `fromLocalInput(value: string): string | null`
  - `<WorkplaceChoice value onChange />`
  - `<WorkplaceSwitcher tone="onNavy" | "surface" className? />`
  - `<NewProjectDialog open onClose />`, which navigates to the new project
  - `LIMIT` keys `generalName: 200`, `generalDescription: 20000`, `generalShortName: 80`, `accessReason: 1000`
  - Routes `/general`, `/general/messages` and `/general/messages/:conversationId`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/general/dates.test.ts
import { describe, expect, it } from 'vitest'
import { dateRange, formatDay, fromLocalInput, isOverdue, toLocalInput } from './dates'

describe('formatDay', () => {
  it('shows a calendar day without shifting it across a timezone', () => {
    expect(formatDay('2026-10-01')).toBe('Oct 1, 2026')
  })
})

describe('dateRange', () => {
  it('says whichever ends are set', () => {
    expect(dateRange('2026-10-01', '2026-10-05')).toBe('Oct 1, 2026 – Oct 5, 2026')
    expect(dateRange('2026-10-01', null)).toBe('Starts Oct 1, 2026')
    expect(dateRange(null, '2026-10-05')).toBe('Ends Oct 5, 2026')
    expect(dateRange(null, null)).toBe('No dates set')
  })
})

describe('isOverdue', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()

  it('is overdue only past its date and not done', () => {
    expect(isOverdue(new Date(2026, 9, 9).toISOString(), 'todo', now)).toBe(true)
    expect(isOverdue(new Date(2026, 9, 9).toISOString(), 'done', now)).toBe(false)
    expect(isOverdue(new Date(2026, 9, 11).toISOString(), 'todo', now)).toBe(false)
    expect(isOverdue(null, 'todo', now)).toBe(false)
  })
})

describe('local datetime inputs', () => {
  it('round-trips through the input format', () => {
    const iso = new Date(2026, 9, 10, 14, 30).toISOString()
    expect(toLocalInput(iso)).toBe('2026-10-10T14:30')
    expect(fromLocalInput('2026-10-10T14:30')).toBe(iso)
  })

  it('reads an empty input as no date', () => {
    expect(toLocalInput(null)).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/general/dates.test.ts`
Expected: FAIL with `Failed to resolve import "./dates"`

- [ ] **Step 3: Write `src/lib/general/dates.ts`**

```ts
// src/lib/general/dates.ts
/**
 * Dates as the General workplace shows them.
 *
 * A project's start and end are calendar days (`date` columns), so they are
 * parsed by hand: `new Date('2026-10-01')` is UTC midnight, which is the day
 * before anywhere west of Greenwich. Task due dates are instants.
 */

export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function dateRange(start: string | null, end: string | null) {
  if (start && end) return `${formatDay(start)} – ${formatDay(end)}`
  if (start) return `Starts ${formatDay(start)}`
  if (end) return `Ends ${formatDay(end)}`
  return 'No dates set'
}

export function formatDue(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function isOverdue(iso: string | null, status: string, now = Date.now()) {
  return Boolean(iso) && status !== 'done' && new Date(iso as string).getTime() < now
}

const pad = (n: number) => String(n).padStart(2, '0')

/** For `<input type="datetime-local">`, which has no timezone. */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string) {
  if (!value) return null
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/general/dates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the General limits**

In `src/lib/limits.ts`, add before the closing `} as const` of `LIMIT`:

```ts

  /* General workplace — supabase/general.sql and general-tasks.sql */
  generalName: 200,
  generalDescription: 20000,
  /** Team, position and field names. */
  generalShortName: 80,
  accessReason: 1000,
```

- [ ] **Step 6: Write the workplace choice**

```tsx
// src/components/auth/WorkplaceChoice.tsx
import { Icon } from '../ui/Icon'
import type { Workplace } from '../../lib/workplace'

const OPTIONS: { value: Workplace; label: string; note: string; icon: 'folder' | 'kanban' }[] = [
  { value: 'education', label: 'Education', note: 'Class projects run by professors and students', icon: 'folder' },
  { value: 'general', label: 'General', note: 'School projects for anyone at DYCI', icon: 'kanban' },
]

/** Where sign-in lands. The other workplace stays one press away in the top bar. */
export function WorkplaceChoice({
  value,
  onChange,
}: {
  value: Workplace
  onChange: (next: Workplace) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium text-ink">I am here for</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
                active
                  ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                  : 'surface border-[var(--line)] hover:border-[var(--line-strong)]'
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-[13px] font-semibold ${
                  active ? 'text-navy-700 dark:text-navy-100' : 'text-ink'
                }`}
              >
                <Icon name={o.icon} size={15} />
                {o.label}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{o.note}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
```

- [ ] **Step 7: Ask for the workplace on Register and Onboarding**

In `src/pages/auth/Register.tsx`:

Add imports:

```tsx
import { WorkplaceChoice } from '../../components/auth/WorkplaceChoice'
import type { Workplace } from '../../lib/workplace'
```

Add state next to `role`:

```tsx
  const [workplace, setWorkplace] = useState<Workplace>('education')
```

In the `signUpWithEmail({...})` call, replace `workplace: 'education',` and `role,` with:

```tsx
        workplace,
        role: workplace === 'education' ? role : null,
```

Replace the `<RoleChoice …/>` line and the professor `Alert` below it with:

```tsx
        <WorkplaceChoice value={workplace} onChange={setWorkplace} />

        {workplace === 'education' ? (
          <>
            <RoleChoice value={role} onChange={setRole} />
            {role === 'professor' && (
              <Alert tone="info">
                Professor accounts are reviewed by the program office. You can sign in straight
                away; teaching tools open once you are approved.
              </Alert>
            )}
          </>
        ) : (
          <Alert tone="info">
            General opens straight away. You see a project once somebody invites you or you
            create one, and you can open Education later from the top bar.
          </Alert>
        )}
```

In `src/pages/auth/Onboarding.tsx`, make the same three changes: the imports, `workplace` state, and the choice block in place of `<RoleChoice …/>` and its `Alert`. Then replace the `completeOnboarding` call and navigation with:

```tsx
      await completeOnboarding({
        firstName,
        middleName,
        lastName,
        workplace,
        role: workplace === 'education' ? role : null,
      })
      navigate(
        workplace === 'general' ? '/general' : role === 'professor' ? '/pending' : '/student',
        { replace: true },
      )
```

- [ ] **Step 8: Write the workplace switcher and put it in the shell**

```tsx
// src/components/app/WorkplaceSwitcher.tsx
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { educationHome, workplaceOf } from '../../lib/workplace'
import type { Workplace } from '../../lib/workplace'

/**
 * Education or General, always one press apart.
 *
 * Links rather than a toggle: each workplace has a real address, so the
 * browser's back button and a copied link both behave. Education goes wherever
 * the account belongs there — its dashboard, the pending page, or the one-time
 * role choice.
 */
export function WorkplaceSwitcher({
  tone = 'onNavy',
  className = '',
}: {
  tone?: 'onNavy' | 'surface'
  className?: string
}) {
  const { profile } = useAuth()
  const location = useLocation()
  if (!profile) return null

  const current = workplaceOf(location.pathname, profile.home_workplace)
  const options: { value: Workplace; label: string; to: string }[] = [
    { value: 'education', label: 'Education', to: educationHome(profile) },
    { value: 'general', label: 'General', to: '/general' },
  ]
  const onNavy = tone === 'onNavy'

  return (
    <nav
      aria-label="Workplace"
      className={`items-center gap-0.5 rounded-lg p-0.5 ${
        onNavy ? 'bg-white/8' : 'surface-sunken'
      } ${className || 'flex'}`}
    >
      {options.map((o) => {
        const on = o.value === current
        return (
          <Link
            key={o.value}
            to={o.to}
            aria-current={on ? 'page' : undefined}
            className={`flex-1 rounded-md px-2.5 py-1 text-center text-[12px] font-medium transition-colors ${
              on
                ? onNavy
                  ? 'bg-amber-400 text-navy-900'
                  : 'surface text-ink ring-1 ring-[var(--line-strong)]'
                : onNavy
                  ? 'text-amber-50/65 hover:text-amber-50'
                  : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

In `src/components/app/TopNav.tsx`, import it and place it directly after the logo `Link` inside the left cluster:

```tsx
            <WorkplaceSwitcher className="ml-2 hidden sm:flex" />
```

In `src/components/app/AppShell.tsx`, import it and place it at the top of `DrawerNav`'s `<nav>`, before the groups:

```tsx
      <WorkplaceSwitcher tone="surface" />
```

- [ ] **Step 9: Route General notifications, and label project conversations**

In `src/lib/types.ts`:

Extend `AppNotification['type']` with:

```ts
    | 'general_invited'
    | 'general_access_requested'
    | 'general_access_answered'
    | 'general_task_assigned'
    | 'general_comment_posted'
    | 'general_deadline_soon'
```

Add to `AppNotification`, after `group_id`:

```ts
  general_project_id: string | null
  general_task_id: string | null
```

Change `ConversationKind` to:

```ts
export type ConversationKind = 'class' | 'group' | 'direct' | 'project'
```

Add to `ConversationRow`, after `direct_key`:

```ts
  /** Set on a General project's conversation. */
  general_project_id: string | null
```

In `src/components/app/NotificationBell.tsx`, inside `openNotification`, directly after `if (!profile) return`:

```ts
    // An invitation has nothing to open until it is accepted, and accepting
    // happens on the General home page.
    if (n.type === 'general_invited') {
      navigate('/general')
      return
    }
    if (n.general_project_id) {
      navigate(
        `/general/projects/${n.general_project_id}${n.general_task_id ? `?task=${n.general_task_id}` : ''}`,
      )
      return
    }
```

In the same file, label the workplace on every item. Directly after the `{ago(n.created_at)}` line inside the item's last `<span>`, add:

```tsx
                          {n.general_project_id && ' · General'}
```

A notification from a General project then reads, for example, "2h · General". An Education notification reads as it does today.

In `src/lib/api/messages.ts`, inside `decorateConversations`:

Collect project ids next to the others:

```ts
  const projectIds = rows.map((r) => r.general_project_id).filter(Boolean) as string[]
```

Add a fourth query to the `Promise.all`, and name it in the destructuring (`const [classes, groups, people, projects] = …`):

```ts
    projectIds.length
      ? supabase.from('general_projects').select('id, name, archived_at').in('id', projectIds)
      : Promise.resolve({ data: [] as never[] }),
```

Build the lookup after `personById`:

```ts
  const projectById = new Map(
    ((projects.data ?? []) as { id: string; name: string; archived_at: string | null }[]).map(
      (p) => [p.id, p],
    ),
  )
```

Before the direct-message fallback in `rows.map`, add:

```ts
    if (row.kind === 'project') {
      const gp = row.general_project_id ? projectById.get(row.general_project_id) : undefined
      return {
        ...row,
        title: gp ? gp.name : 'Project chat',
        subtitle: 'General project · everyone on it',
        writable: !gp?.archived_at,
      }
    }
```

In `src/components/messages/ConversationList.tsx`, add `{ kind: 'project', label: 'Projects' },` to `SECTIONS` after `group`. Change the icon to:

```tsx
<Icon name={kind === 'class' ? 'board' : kind === 'project' ? 'kanban' : 'users'} size={18} />
```

In `src/components/messages/MessageThread.tsx`, change the icon line to:

```tsx
<Icon name={conversation.kind === 'class' ? 'board' : conversation.kind === 'project' ? 'kanban' : 'users'} size={18} />
```

In `src/pages/app/messages/Messages.tsx`, change the prop and base path:

```tsx
export default function Messages({ role }: { role: 'professor' | 'student' | 'general' }) {
```

```tsx
  const base =
    role === 'professor'
      ? '/professor/messages'
      : role === 'general'
        ? '/general/messages'
        : '/student/messages'
```

Change the stat label `'Class & group chats'` to `'Group chats'`, since it now counts project chats too.

- [ ] **Step 10: Write the new project dialog**

```tsx
// src/components/general/NewProjectDialog.tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { createGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'

/**
 * Four things, all changeable later. Everything else — fields, teams,
 * positions, people — is added on the project itself, where it can be seen in
 * context rather than guessed at up front.
 */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Give the project a name.')
    if (startsOn && endsOn && endsOn < startsOn) return setError('The end date is before the start date.')
    setBusy(true)
    try {
      const project = await createGeneralProject({
        name,
        description,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
      })
      onClose()
      navigate(`/general/projects/${project.id}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="You become its Owner. You can change all of this later."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-general-project" loading={busy}>
            Create project
          </Button>
        </>
      }
    >
      <form id="new-general-project" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={LIMIT.generalName}
              placeholder="Intramurals 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="What it is for" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              placeholder="The goal, who it is for, and what done looks like."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" optional>
            {(id) => (
              <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            )}
          </Field>
          <Field label="Ends" optional>
            {(id) => (
              <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            )}
          </Field>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 11: Write the General home page**

```tsx
// src/pages/general/GeneralHome.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { NewProjectDialog } from '../../components/general/NewProjectDialog'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Input } from '../../components/ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import {
  joinGeneralProject,
  listMyGeneralProjects,
  listMyInvitations,
  respondToInvitation,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralProjectSummary, GeneralStatus, MyInvitation } from '../../lib/general/types'
import { fullName } from '../../lib/types'

/**
 * The General workplace's front door: what is waiting on you, then what you
 * are part of.
 *
 * Invitations come first because they are the only thing here that needs an
 * answer, and until they are answered the projects behind them are not yours
 * to open.
 */
export default function GeneralHome() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [projects, setProjects] = useState<GeneralProjectSummary[] | null>(null)
  const [invitations, setInvitations] = useState<MyInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [answering, setAnswering] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    document.title = 'General · Collabify'
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const [p, i] = await Promise.all([listMyGeneralProjects(), listMyInvitations(profile.id)])
      setProjects(p)
      setInvitations(i)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your projects.'))
      setProjects((prev) => prev ?? [])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_projects', 'general_members', 'general_invitations', 'general_tasks'])

  async function answer(inv: MyInvitation, accept: boolean) {
    setAnswering(inv.id)
    try {
      await respondToInvitation(inv.id, accept)
      show(accept ? `You joined ${inv.project?.name ?? 'the project'}` : 'Invitation declined')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  const all = useMemo(() => projects ?? [], [projects])
  const live = all.filter((p) => !p.archived_at)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((p) => (showArchived ? true : !p.archived_at))
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [all, query, status, showArchived])

  return (
    <div className="w-full">
      <DirectoryHero
        title="Run any project"
        accent="with your people."
        description="School events, committees, research, outreach and anything else. You decide the fields, the teams and who holds which position."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={17} />
              New project
            </Button>
            <Button variant="onNavy" onClick={() => setJoinOpen(true)}>
              Join with a code
            </Button>
          </div>
        }
        stats={[
          { value: projects === null ? '—' : live.length, label: 'Projects' },
          { value: invitations.length, label: 'Invitations' },
        ]}
      />

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {invitations.length > 0 && (
          <section className="overflow-hidden rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
            <header className="flex items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
              <div>
                <h2>Invitations</h2>
                <p className="mt-0.5 text-[12px] text-muted">Projects waiting for your answer.</p>
              </div>
              <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
                {invitations.length}
              </span>
            </header>
            <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                  {inv.inviter && <Avatar profile={inv.inviter} size={34} />}
                  <div className="min-w-[14rem] flex-1">
                    <p className="text-[14px] font-medium text-ink">{inv.project?.name ?? 'A project'}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {inv.inviter ? `${fullName(inv.inviter)} invited you` : 'You were invited'}
                      {inv.project?.description ? ` · ${inv.project.description.slice(0, 90)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={answering === inv.id}
                      onClick={() => void answer(inv, false)}
                    >
                      Decline
                    </Button>
                    <Button size="sm" loading={answering === inv.id} onClick={() => void answer(inv, true)}>
                      <Icon name="check" size={14} />
                      Join
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {projects === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon="kanban"
            title="No projects yet"
            body="Create one for anything you are running, or join one with a code somebody shared with you."
            action={
              <Button onClick={() => setNewOpen(true)} className="!rounded-xl">
                New project
              </Button>
            }
          />
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto">Your projects</h2>
              <FilterPopover
                align="right"
                label="Filter projects"
                active={[query.trim(), status, showArchived].filter(Boolean).length}
                summary={[
                  query.trim() && `“${query.trim()}”`,
                  status && projectStatusLabel(status),
                  showArchived && 'Including archived',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={() => {
                  setQuery('')
                  setStatus('')
                  setShowArchived(false)
                }}
              >
                <FilterField label="Search">
                  <FilterSearch value={query} onChange={setQuery} placeholder="Name or description" />
                </FilterField>
                <FilterField label="Status">
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as GeneralStatus | '')}
                    placeholder="Any status"
                    options={PROJECT_STATUSES}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Include archived projects
                </label>
              </FilterPopover>
            </div>

            {shown.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matches"
                body="No project fits these filters. Clear them to see everything you are on."
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <JoinDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  )
}

function ProjectCard({ project: p }: { project: GeneralProjectSummary }) {
  const pct = Number(p.progress_pct)
  return (
    <Link
      to={`/general/projects/${p.id}`}
      className="group flex flex-col rounded-card border border-line bg-[var(--surface)] p-4 transition-colors hover:border-line-strong sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 leading-snug group-hover:underline">{p.name}</h3>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {p.archived_at ? 'Archived' : projectStatusLabel(p.status)}
        </span>
      </div>
      {p.description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{p.description}</p>
      )}
      <p className="mt-3 text-[12px] text-faint">{dateRange(p.starts_on, p.ends_on)}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted">
            {p.done_count}/{p.task_count} tasks done
          </span>
          <span className="font-mono text-faint">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="users" size={14} />
          {p.member_count} {p.member_count === 1 ? 'member' : 'members'}
        </span>
        <span className="text-faint">·</span>
        <span>You are {levelLabel(p.my_level)}</span>
        {p.my_level === 'owner' && p.open_request_count > 0 && (
          <span className="ml-auto rounded-full bg-amber-400/25 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200">
            {p.open_request_count} access {p.open_request_count === 1 ? 'request' : 'requests'}
          </span>
        )}
      </div>
    </Link>
  )
}

function JoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const projectId = await joinGeneralProject(code)
      onClose()
      setCode('')
      navigate(`/general/projects/${projectId}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not join with that code.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join with a code"
      description="Whoever runs the project can give you its eight-character code."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="join-general-project" loading={busy} disabled={code.trim().length < 8}>
            Join
          </Button>
        </>
      }
    >
      <form id="join-general-project" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Code">
          {(id) => (
            <Input
              id={id}
              required
              autoComplete="off"
              maxLength={8}
              placeholder="ABCD2345"
              className="font-mono uppercase tracking-[0.2em]"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 12: Show General counts on the admin home**

Replace `src/pages/app/AdminHome.tsx`'s default export with:

```tsx
export default function AdminHome() {
  return (
    <>
      <RoleHome
        headline="Program overview"
        intro="Classes, faculty load and cohort progress are live, beside approvals, accounts and the audit log. Everything here is counts — what happens inside a class stays with its professor and their students."
        upcoming={UPCOMING}
      />
      <GeneralCountsBand />
    </>
  )
}

/** Counts only. What happens inside a General project stays with the people on it. */
function GeneralCountsBand() {
  const [counts, setCounts] = useState<GeneralCounts | null>(null)

  useEffect(() => {
    void generalCounts()
      .then(setCounts)
      .catch(() => setCounts(null))
  }, [])

  if (!counts) return null

  const items = [
    { label: 'General projects', value: counts.projects },
    { label: 'Running', value: counts.active_projects },
    { label: 'Archived', value: counts.archived_projects },
    { label: 'People on them', value: counts.people },
  ]

  return (
    <section className="mt-8 rounded-panel border border-line surface p-4 sm:p-5">
      <p className="eyebrow">General workplace</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-xl surface-sunken px-3 py-2.5">
            <dt className="text-[12px] text-muted">{i.label}</dt>
            <dd className="mt-0.5 font-mono text-[20px] font-bold text-ink">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
```

Add the imports at the top:

```tsx
import { useEffect, useState } from 'react'
import { generalCounts } from '../../lib/api/general'
import type { GeneralCounts } from '../../lib/general/types'
```

- [ ] **Step 13: Add the General routes**

In `src/App.tsx`, add the lazy import:

```tsx
const GeneralHome = lazy(() => import('./pages/general/GeneralHome'))
```

Add a route group after the shared `/settings` group:

```tsx
          <Route element={<ProtectedRoute workplace="general" />}>
          <Route element={<AppShell />}>
            <Route path="/general" element={<GeneralHome />} />
            <Route path="/general/messages" element={<Messages role="general" />} />
            <Route path="/general/messages/:conversationId" element={<Messages role="general" />} />
          </Route>
          </Route>
```

- [ ] **Step 14: Run the checks**

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
npm run test
node scripts/contrast.mjs
node scripts/a11y-names.mjs
node scripts/motion-lint.mjs
```

Expected: typecheck exits 0; lint `23 problems (0 errors, 23 warnings)`; every test file passes; `0 failing pairs.`; `0 icon-only buttons with no accessible name`; `motion-lint: ok`.

- [ ] **Step 15: Verify in the browser**

With the dev server running (restart it with `preview_stop` and `preview_start` if Tailwind has not picked up the new files):
1. Sign out. Open `/register` and pick **General**. The role choice disappears and the General note shows.
2. Register a test account with an address you control, confirm it, and sign in. The browser lands on `/general`.
3. The top bar shows the switcher with General highlighted, and the nav shows Projects only.
4. Press **New project**, fill in a name, and create it. The browser goes to `/general/projects/<id>`. That page is built in Task 11 and shows the not-found page until then.
5. Go back to `/general`. The project card shows "You are Owner" and `0/0 tasks done`.
6. Press **Education** in the switcher. The browser goes to `/education/enter`. Pick Professor and press **Open Education**. The browser lands on `/pending`, and **Use the General workplace while you wait** returns to `/general`.
7. Sign in as an existing student. The browser lands on `/student`, and **General** in the switcher opens `/general` with an empty projects page.
8. Check `/general` at 375px and 1440px, in light and dark, with `resize_window`. There is no sideways page scroll.

- [ ] **Step 16: Commit**

```bash
git add src/lib/general/dates.ts src/lib/general/dates.test.ts src/lib/limits.ts src/components/auth/WorkplaceChoice.tsx src/components/app/WorkplaceSwitcher.tsx src/components/general/NewProjectDialog.tsx src/pages/general/GeneralHome.tsx src/pages/auth/Register.tsx src/pages/auth/Onboarding.tsx src/components/app/TopNav.tsx src/components/app/AppShell.tsx src/components/app/NotificationBell.tsx src/lib/types.ts src/lib/api/messages.ts src/components/messages/ConversationList.tsx src/components/messages/MessageThread.tsx src/pages/app/messages/Messages.tsx src/pages/app/AdminHome.tsx src/App.tsx
git commit -m "Let people register for General, switch workplaces, and start General projects"
```

---

### Task 11: The project page and its Overview tab

**Files:**
- Create: `src/components/general/useGeneralProject.ts`
- Create: `src/components/general/RequestAccessButton.tsx`
- Create: `src/components/general/FieldInput.tsx`
- Create: `src/components/general/FieldDialog.tsx`
- Create: `src/components/general/OverviewTab.tsx`
- Create: `src/pages/general/GeneralProject.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 8's API and types, Task 1's `can` and `requestable`, Task 2's field helpers, and Task 10's `dateRange`.
- Produces:
  - `useGeneralProject(projectId: string | undefined, viewerId: string | undefined): GeneralProjectState`, where `GeneralProjectState` is exported with exactly the fields in Step 1
  - `<RequestAccessButton state={GeneralProjectState} permission={GeneralPermission} />`
  - `<FieldInput field value onChange members id? />`
  - `<FieldDialog open onClose state field? />`
  - `<OverviewTab state />`
  - Route `/general/projects/:projectId`. `?task=<id>` opens the Tasks tab with that task, and `?tab=members` opens Members.

Tasks 12 and 13 add `MembersTab` and `TasksTab` to this page. Until then those two tabs render nothing.

- [ ] **Step 1: Write the project data hook**

```ts
// src/components/general/useGeneralProject.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import {
  getGeneralProject,
  listAccessRequests,
  listFieldValues,
  listFields,
  listGeneralMembers,
  listGrants,
  listPositionHolders,
  listPositions,
  listTasks,
  listTeamMembers,
  listTeams,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { can as canDo } from '../../lib/general/permissions'
import type { GeneralPermission } from '../../lib/general/permissions'
import type {
  GeneralAccessRequest,
  GeneralField,
  GeneralFieldValue,
  GeneralGrant,
  GeneralMember,
  GeneralPosition,
  GeneralPositionHolder,
  GeneralProjectSummary,
  GeneralTask,
  GeneralTeam,
  GeneralTeamMember,
} from '../../lib/general/types'
import { fullName } from '../../lib/types'

export type GeneralProjectState = {
  project: GeneralProjectSummary | null
  members: GeneralMember[]
  grants: GeneralGrant[]
  requests: GeneralAccessRequest[]
  teams: GeneralTeam[]
  teamMembers: GeneralTeamMember[]
  positions: GeneralPosition[]
  holders: GeneralPositionHolder[]
  fields: GeneralField[]
  values: GeneralFieldValue[]
  tasks: GeneralTask[]
  loading: boolean
  /** Loaded, and there is no project this viewer can see. */
  missing: boolean
  error: string | null
  reload: () => Promise<void>
  viewerId: string | undefined
  me: GeneralMember | null
  myGrants: GeneralPermission[]
  myOpenRequests: GeneralPermission[]
  archived: boolean
  isOwner: boolean
  ownerCount: number
  can: (permission: GeneralPermission) => boolean
  nameOf: (userId: string) => string
}

/**
 * One project and everything about the viewer in it, loaded together.
 *
 * Every tab reads the same copy, so the Members tab granting a permission and
 * the Tasks tab offering a button can never disagree about what the viewer may
 * do. Realtime reloads it whenever anything under the project changes.
 */
export function useGeneralProject(
  projectId: string | undefined,
  viewerId: string | undefined,
): GeneralProjectState {
  const [project, setProject] = useState<GeneralProjectSummary | null>(null)
  const [members, setMembers] = useState<GeneralMember[]>([])
  const [grants, setGrants] = useState<GeneralGrant[]>([])
  const [requests, setRequests] = useState<GeneralAccessRequest[]>([])
  const [teams, setTeams] = useState<GeneralTeam[]>([])
  const [teamMembers, setTeamMembers] = useState<GeneralTeamMember[]>([])
  const [positions, setPositions] = useState<GeneralPosition[]>([])
  const [holders, setHolders] = useState<GeneralPositionHolder[]>([])
  const [fields, setFields] = useState<GeneralField[]>([])
  const [values, setValues] = useState<GeneralFieldValue[]>([])
  const [tasks, setTasks] = useState<GeneralTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectId) return
    try {
      const found = await getGeneralProject(projectId)
      setProject(found)
      if (!found) return
      const [m, g, r, t, tm, p, h, f, tk] = await Promise.all([
        listGeneralMembers(projectId),
        listGrants(projectId),
        listAccessRequests(projectId),
        listTeams(projectId),
        listTeamMembers(projectId),
        listPositions(projectId),
        listPositionHolders(projectId),
        listFields(projectId),
        listTasks(projectId),
      ])
      setMembers(m)
      setGrants(g)
      setRequests(r)
      setTeams(t)
      setTeamMembers(tm)
      setPositions(p)
      setHolders(h)
      setFields(f)
      setTasks(tk)
      setValues(await listFieldValues(f.map((x) => x.id)))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load this project.'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  useLive(reload, [
    'general_projects',
    'general_join_codes',
    'general_members',
    'general_grants',
    'general_access_requests',
    'general_invitations',
    'general_teams',
    'general_team_members',
    'general_positions',
    'general_position_holders',
    'general_fields',
    'general_field_values',
    'general_tasks',
    'general_task_assignees',
  ])

  return useMemo(() => {
    const me = members.find((m) => m.user_id === viewerId) ?? null
    const myGrants = grants.filter((g) => g.user_id === viewerId).map((g) => g.permission)
    const myOpenRequests = requests
      .filter((r) => r.user_id === viewerId && r.status === 'open')
      .map((r) => r.permission)
    const archived = Boolean(project?.archived_at)
    const names = new Map(
      members.map((m) => [m.user_id, m.profile ? fullName(m.profile) : 'A member']),
    )
    return {
      project,
      members,
      grants,
      requests,
      teams,
      teamMembers,
      positions,
      holders,
      fields,
      values,
      tasks,
      loading,
      missing: !loading && !project && !error,
      error,
      reload,
      viewerId,
      me,
      myGrants,
      myOpenRequests,
      archived,
      isOwner: me?.level === 'owner',
      ownerCount: members.filter((m) => m.level === 'owner').length,
      can: (permission: GeneralPermission) =>
        canDo(me?.level ?? null, myGrants, permission, archived),
      nameOf: (userId: string) => names.get(userId) ?? 'A former member',
    }
  }, [project, members, grants, requests, teams, teamMembers, positions, holders, fields, values, tasks, loading, error, reload, viewerId])
}
```

- [ ] **Step 2: Write the request access button**

```tsx
// src/components/general/RequestAccessButton.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { requestAccess } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { PERMISSIONS, permissionLabel, requestable } from '../../lib/general/permissions'
import type { GeneralPermission } from '../../lib/general/permissions'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Shown exactly where a Member runs into something they cannot do.
 *
 * Nothing renders for somebody who already holds the permission, for an Owner
 * or Manager, or on an archived project. Once asked, it says so rather than
 * offering to ask again, because a second request is refused anyway.
 */
export function RequestAccessButton({
  state,
  permission,
}: {
  state: GeneralProjectState
  permission: GeneralPermission
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!state.project || state.archived || state.me?.level !== 'member') return null
  if (state.myOpenRequests.includes(permission)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg surface-sunken px-2.5 py-1 text-[12px] text-muted">
        <Icon name="clock" size={13} />
        Access requested
      </span>
    )
  }
  if (!requestable(state.me.level, state.myGrants, state.myOpenRequests).includes(permission)) return null

  async function send() {
    if (!state.project) return
    setError(null)
    setBusy(true)
    try {
      await requestAccess(state.project.id, permission, reason)
      show('Request sent to the Owners')
      setOpen(false)
      setReason('')
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send that request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon name="lock" size={14} />
        Request access
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Ask for: ${permissionLabel(permission)}`}
        description={PERMISSIONS.find((p) => p.value === permission)?.note}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void send()} loading={busy}>
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Why you need it" optional>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={LIMIT.accessReason}
                placeholder="What you are working on, so an Owner can decide quickly."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <p className="text-[12px] text-faint">
            Every Owner of this project is notified. You hear back either way.
          </p>
        </div>
      </Modal>
    </>
  )
}
```

- [ ] **Step 3: Write the typed field input**

```tsx
// src/components/general/FieldInput.tsx
import { Input } from '../ui/Field'
import { Select, Textarea } from '../ui/Select'
import { FIELD_LIMIT } from '../../lib/general/fields'
import type { GeneralField, GeneralMember } from '../../lib/general/types'
import { fullName } from '../../lib/types'

/**
 * One control per field type. The value it hands back is raw — a string from a
 * text box, a boolean, a list — and `checkFieldValue` turns it into what is
 * stored, so validation lives in one place.
 */
export function FieldInput({
  field,
  value,
  onChange,
  members,
  id,
}: {
  field: GeneralField
  value: unknown
  onChange: (next: unknown) => void
  members: GeneralMember[]
  id?: string
}) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''

  switch (field.type) {
    case 'short_text':
      return (
        <Input id={id} maxLength={FIELD_LIMIT.shortText} value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'long_text':
      return (
        <Textarea id={id} rows={4} maxLength={FIELD_LIMIT.longText} value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'number':
      return <Input id={id} type="number" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'money':
      return (
        <Input id={id} type="number" min={0} step="0.01" value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'date':
      return <Input id={id} type="date" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'link':
      return (
        <Input
          id={id}
          type="url"
          maxLength={FIELD_LIMIT.link}
          placeholder="https://"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'single_choice':
      return (
        <Select
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Not set"
          options={field.options.map((o) => ({ value: o, label: o }))}
        />
      )
    case 'yes_no':
      return (
        <Select
          id={id}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'yes')}
          placeholder="Not set"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
      )
    case 'member':
      return (
        <Select
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nobody"
          options={members.map((m) => ({
            value: m.user_id,
            label: m.profile ? fullName(m.profile) : 'A member',
          }))}
        />
      )
    case 'multi_choice': {
      const chosen = Array.isArray(value) ? (value as string[]) : []
      return (
        <fieldset id={id} className="flex flex-wrap gap-2">
          {field.options.map((o) => {
            const on = chosen.includes(o)
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${
                  on ? 'border-navy-400 bg-navy-500/10 text-ink' : 'border-line text-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? chosen.filter((x) => x !== o) : [...chosen, o])}
                />
                {o}
              </label>
            )
          })}
        </fieldset>
      )
    }
  }
}
```

- [ ] **Step 4: Write the field dialog**

```tsx
// src/components/general/FieldDialog.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { createField, updateField } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { FIELD_LIMIT, FIELD_TYPES, checkOptions, isChoice } from '../../lib/general/fields'
import type { FieldType } from '../../lib/general/fields'
import type { GeneralField } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Add a field, or rename one and change its options.
 *
 * The type is fixed once the field holds a value — the database refuses the
 * change — so the select says why it is locked instead of failing on save.
 */
export function FieldDialog({
  open,
  onClose,
  state,
  field,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  field?: GeneralField
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('short_text')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(field?.name ?? '')
    setType(field?.type ?? 'short_text')
    setOptions((field?.options ?? []).join('\n'))
    setError(null)
  }, [open, field])

  const hasValue = Boolean(field && state.values.some((v) => v.field_id === field.id))

  async function save() {
    if (!state.project) return
    const list = isChoice(type) ? options.split('\n').map((o) => o.trim()).filter(Boolean) : []
    if (!name.trim()) return setError('Give the field a name.')
    const problem = checkOptions(type, list)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      if (field) {
        await updateField(field.id, { name: name.trim(), type, options: list })
      } else {
        await createField({
          projectId: state.project.id,
          name,
          type,
          options: list,
          sort: state.fields.length,
        })
      }
      await state.reload()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that field.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={field ? 'Edit field' : 'Add a field'}
      description="Fields are yours to name. Everyone on the project sees them."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {field ? 'Save field' : 'Add field'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              maxLength={FIELD_LIMIT.name}
              placeholder="Budget, Venue, Adviser"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Type"
          hint={hasValue ? <span className="text-[12px] text-faint">Locked: it holds a value</span> : undefined}
        >
          {(id) => (
            <Select
              id={id}
              value={type}
              disabled={hasValue}
              onChange={(e) => setType(e.target.value as FieldType)}
              options={FIELD_TYPES.map((t) => ({ value: t.value, label: `${t.label} — ${t.hint}` }))}
            />
          )}
        </Field>
        {isChoice(type) && (
          <Field label="Options" hint={<span className="text-[12px] text-faint">One per line</span>}>
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                placeholder={'Gym\nCovered court\nAudio-visual room'}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 5: Write the Overview tab**

```tsx
// src/components/general/OverviewTab.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  clearFieldValue,
  deleteField,
  setFieldValue,
  updateField,
  updateGeneralProject,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { checkFieldValue, formatFieldValue, isEmptyValue } from '../../lib/general/fields'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralField, GeneralStatus } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { FieldDialog } from './FieldDialog'
import { FieldInput } from './FieldInput'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

export function OverviewTab({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project')
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Details</h2>
            <p className="mt-0.5 text-[12px] text-muted">What every project has.</p>
          </div>
          {!editable && <RequestAccessButton state={state} permission="edit_project" />}
        </header>
        {editable ? <DetailsForm state={state} /> : <DetailsView state={state} />}
      </section>

      <FieldsPanel state={state} />
    </div>
  )
}

function DetailsView({ state }: { state: GeneralProjectState }) {
  const p = state.project
  if (!p) return null
  return (
    <dl className="space-y-3 text-[14px]">
      <div>
        <dt className="text-[12px] text-faint">Status</dt>
        <dd className="text-ink">{projectStatusLabel(p.status)}</dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">Dates</dt>
        <dd className="text-ink">{dateRange(p.starts_on, p.ends_on)}</dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">Progress</dt>
        <dd className="text-ink">
          {p.points_enabled ? 'Tasks carry points' : 'Every task counts the same'}
        </dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">About</dt>
        <dd className="whitespace-pre-wrap text-ink">{p.description || 'No description yet.'}</dd>
      </div>
    </dl>
  )
}

function DetailsForm({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const [name, setName] = useState('')
  const [status, setStatus] = useState<GeneralStatus>('planning')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the project changes underneath, not on every realtime reload
  // while somebody is typing.
  const updatedAt = p?.updated_at
  useEffect(() => {
    if (!p) return
    setName(p.name)
    setStatus(p.status)
    setStartsOn(p.starts_on ?? '')
    setEndsOn(p.ends_on ?? '')
    setDescription(p.description)
    setPoints(p.points_enabled)
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  async function save() {
    if (!p) return
    setError(null)
    if (!name.trim()) return setError('A project needs a name.')
    if (startsOn && endsOn && endsOn < startsOn) return setError('The end date is before the start date.')
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        name: name.trim(),
        status,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        description,
        points_enabled: points,
      })
      show('Project saved')
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Name">
        {(id) => (
          <Input id={id} maxLength={LIMIT.generalName} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralStatus)}
              options={PROJECT_STATUSES}
            />
          )}
        </Field>
        <Field label="Starts" optional>
          {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
        </Field>
        <Field label="Ends" optional>
          {(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
        </Field>
      </div>
      <Field label="About" optional>
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            maxLength={LIMIT.generalDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <label className="flex items-start gap-3 rounded-xl surface-sunken px-3.5 py-3">
        <input type="checkbox" className="mt-1" checked={points} onChange={(e) => setPoints(e.target.checked)} />
        <span>
          <span className="block text-[14px] font-medium text-ink">Tasks carry points</span>
          <span className="block text-[12px] text-muted">
            On, the project is worth 100 and each task is a share of it. Off, every task counts the same.
          </span>
        </span>
      </label>
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={busy}>
          Save details
        </Button>
      </div>
    </div>
  )
}

function FieldsPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const editable = state.can('edit_project')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<GeneralField | null>(null)
  const [removing, setRemoving] = useState<GeneralField | null>(null)

  async function move(field: GeneralField, delta: -1 | 1) {
    const list = state.fields
    const i = list.findIndex((f) => f.id === field.id)
    const other = list[i + delta]
    if (!other) return
    try {
      await Promise.all([updateField(field.id, { sort: i + delta }), updateField(other.id, { sort: i })])
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that field.'), 'error')
    }
  }

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Fields</h2>
          <p className="mt-0.5 text-[12px] text-muted">What this project needs to keep track of.</p>
        </div>
        {editable ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add field
          </Button>
        ) : (
          <RequestAccessButton state={state} permission="edit_project" />
        )}
      </header>

      {state.fields.length === 0 ? (
        <EmptyState
          icon="file"
          title="No fields yet"
          body={
            editable
              ? 'Add what this project needs: a budget, a venue, an adviser, a grade level.'
              : 'Nobody has added fields to this project.'
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {state.fields.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              state={state}
              editable={editable}
              first={i === 0}
              last={i === state.fields.length - 1}
              onEdit={() => setEditing(f)}
              onRemove={() => setRemoving(f)}
              onMove={(d) => void move(f, d)}
            />
          ))}
        </ul>
      )}

      <FieldDialog open={adding} onClose={() => setAdding(false)} state={state} />
      <FieldDialog open={Boolean(editing)} onClose={() => setEditing(null)} state={state} field={editing ?? undefined} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteField(removing.id)
          show('Field removed')
          await state.reload()
        }}
        title={`Remove ${removing?.name ?? 'this field'}?`}
        body={
          removing && state.values.some((v) => v.field_id === removing.id)
            ? 'It holds a value, and the value is removed with it. This cannot be undone.'
            : 'It holds no value yet.'
        }
        confirmLabel="Remove field"
      />
    </section>
  )
}

function FieldRow({
  field,
  state,
  editable,
  first,
  last,
  onEdit,
  onRemove,
  onMove,
}: {
  field: GeneralField
  state: GeneralProjectState
  editable: boolean
  first: boolean
  last: boolean
  onEdit: () => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const { show } = useToast()
  const stored = state.values.find((v) => v.field_id === field.id)
  const [draft, setDraft] = useState<unknown>(stored?.value ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storedAt = stored?.updated_at
  useEffect(() => {
    setDraft(stored?.value ?? '')
  }, [storedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(null)
    setBusy(true)
    try {
      if (isEmptyValue(draft)) {
        await clearFieldValue(field.id)
      } else {
        const checked = checkFieldValue(field.type, draft, {
          options: field.options,
          memberIds: state.members.map((m) => m.user_id),
        })
        if (!checked.ok) {
          setError(checked.error)
          return
        }
        await setFieldValue(field.id, checked.value)
      }
      show(`${field.name} saved`)
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that value.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">{field.name}</p>
        {editable && (
          <div className="flex items-center">
            <button
              type="button"
              aria-label={`Move ${field.name} up`}
              disabled={first}
              onClick={() => onMove(-1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
            >
              <Icon name="chevronDown" size={15} className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label={`Move ${field.name} down`}
              disabled={last}
              onClick={() => onMove(1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
            >
              <Icon name="chevronDown" size={15} />
            </button>
            <button
              type="button"
              aria-label={`Edit ${field.name}`}
              onClick={onEdit}
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              <Icon name="edit" size={15} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${field.name}`}
              onClick={onRemove}
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </div>

      {editable ? (
        <div className="mt-2 space-y-2">
          <FieldInput field={field} value={draft} onChange={setDraft} members={state.members} />
          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void save()} loading={busy}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[14px] text-muted">
          {stored ? formatFieldValue(field.type, stored.value, state.nameOf) : 'Not set'}
        </p>
      )}
    </li>
  )
}
```

- [ ] **Step 6: Write the project page**

```tsx
// src/pages/general/GeneralProject.tsx
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { OverviewTab } from '../../components/general/OverviewTab'
import { useGeneralProject } from '../../components/general/useGeneralProject'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { archiveGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { projectStatusLabel } from '../../lib/general/types'

type TabId = 'overview' | 'tasks' | 'members'

export default function GeneralProject() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const state = useGeneralProject(projectId, profile?.id)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<TabId>(() =>
    params.has('task') ? 'tasks' : params.get('tab') === 'members' ? 'members' : 'overview',
  )
  const [archiving, setArchiving] = useState(false)

  const p = state.project
  useEffect(() => {
    document.title = `${p?.name ?? 'Project'} · Collabify`
  }, [p?.name])

  if (state.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the project…
      </div>
    )
  }

  if (state.missing || !p) {
    return (
      <EmptyState
        icon="kanban"
        title="Project not found"
        body="It does not exist, or you are not on it. Ask whoever runs it for an invitation or its join code."
        action={
          <Link to="/general" className="text-[14px] font-medium text-navy-600 hover:underline dark:text-navy-200">
            Back to your projects
          </Link>
        }
      />
    )
  }

  const openForOwner = state.isOwner ? state.requests.filter((r) => r.status === 'open').length : 0

  async function restore() {
    if (!p) return
    try {
      await archiveGeneralProject(p.id, false)
      show('Project restored')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not restore the project.'), 'error')
    }
  }

  return (
    <div className="w-full space-y-6">
      <Link to="/general" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <Icon name="arrowLeft" size={14} />
        All projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
              {p.archived_at ? 'Archived' : projectStatusLabel(p.status)}
            </span>
            <span className="rounded-md bg-navy-500/10 px-2 py-0.5 text-[12px] text-navy-700 dark:text-navy-200">
              You are {levelLabel(p.my_level)}
            </span>
          </div>
          <h1 className="mt-2 font-display">{p.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {dateRange(p.starts_on, p.ends_on)} · {p.member_count}{' '}
            {p.member_count === 1 ? 'member' : 'members'} · {Number(p.progress_pct)}% done
          </p>
        </div>
        {state.isOwner && !state.archived && (
          <Button variant="outline" size="sm" onClick={() => setArchiving(true)}>
            <Icon name="archive" size={15} />
            Archive
          </Button>
        )}
      </header>

      {state.error && <Alert tone="error">{state.error}</Alert>}

      {state.archived && (
        <Alert tone="info">
          This project is archived, so nothing in it can change.
          {state.isOwner && (
            <>
              {' '}
              <button type="button" onClick={() => void restore()} className="font-medium underline">
                Restore it
              </button>{' '}
              to make changes again.
            </>
          )}
        </Alert>
      )}

      <Tabs<TabId>
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'file' },
          { id: 'tasks', label: 'Tasks', icon: 'check', count: state.tasks.length },
          {
            id: 'members',
            label: 'Members',
            icon: 'users',
            count: openForOwner > 0 ? openForOwner : state.members.length,
          },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && <OverviewTab state={state} />}

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={async () => {
          await archiveGeneralProject(p.id, true)
          show('Project archived')
          await state.reload()
        }}
        title={`Archive ${p.name}?`}
        body="Nothing in it can change until an Owner restores it, and its join code closes. Everyone on it can still read it."
        confirmLabel="Archive project"
        tone="primary"
      />
    </div>
  )
}
```

- [ ] **Step 7: Add the route**

In `src/App.tsx`, add the lazy import and a route inside the General group:

```tsx
const GeneralProject = lazy(() => import('./pages/general/GeneralProject'))
```

```tsx
            <Route path="/general/projects/:projectId" element={<GeneralProject />} />
```

- [ ] **Step 8: Run the checks**

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
node scripts/a11y-names.mjs
node scripts/motion-lint.mjs
```

Expected: typecheck exits 0; lint `23 problems (0 errors, 23 warnings)`; `0 icon-only buttons with no accessible name`; `motion-lint: ok`.

- [ ] **Step 9: Verify in the browser**

Signed in as the General test account from Task 10:
1. Open the project. The header shows the status, "You are Owner", and the dates. Overview shows the editable Details form.
2. Change the name and turn points on. Press **Save details**. A toast appears, and the header shows the new name.
3. Press **Add field**, name it "Budget", choose Money, and add it. Type `-5` and press Save. The inline error reads "An amount cannot be negative." Type `15000.50` and save; the value stays after a reload.
4. Open **Edit** on Budget. The type select is disabled and reads "Locked: it holds a value".
5. Add a Single choice field "Venue" with options Gym and Covered court. Choose Gym and save. Edit the field and remove Gym from the options. The save fails with "An option you removed is still chosen. Change that value first."
6. Archive the project. The banner appears, **Restore it** brings the form back.
7. Check the page at 375px and 1440px, in light and dark.

- [ ] **Step 10: Commit**

```bash
git add src/components/general/useGeneralProject.ts src/components/general/RequestAccessButton.tsx src/components/general/FieldInput.tsx src/components/general/FieldDialog.tsx src/components/general/OverviewTab.tsx src/pages/general/GeneralProject.tsx src/App.tsx
git commit -m "Add the General project page with editable details and added fields"
```

---

### Task 12: Members, access, invitations, teams and positions

**Files:**
- Create: `src/components/general/MembersTab.tsx`
- Create: `src/components/general/RequestsPanel.tsx`
- Create: `src/components/general/InvitePanel.tsx`
- Create: `src/components/general/StructurePanel.tsx`
- Modify: `src/pages/general/GeneralProject.tsx`

**Interfaces:**
- Consumes: `GeneralProjectState` and `RequestAccessButton` (Task 11), Task 8's member, grant, request, invitation, team and position calls, and Task 1's `LEVELS`, `PERMISSIONS`, `canStepDown`, `permissionLabel` and `requestable`.
- Produces: `<MembersTab state />`, `<RequestsPanel state />`, `<InvitePanel state />` and `<StructurePanel state />`.

**What each viewer sees:**
- **Owner:** level selects, extra permissions, open requests with Approve and Decline, the join code controls, invitations, and teams and positions.
- **Manager:** everything except levels, extra permissions, requests and join code controls. A Manager sees the code but cannot change it.
- **Member:** the member list, their own requests, "Ask for more", and read-only teams and positions. Each blocked area shows a "Request access" button.

- [ ] **Step 1: Write the requests panel**

```tsx
// src/components/general/RequestsPanel.tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { useToast } from '../ui/Toast'
import { answerAccessRequest, withdrawAccessRequest } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { PERMISSIONS, permissionLabel, requestable } from '../../lib/general/permissions'
import type { GeneralAccessRequest } from '../../lib/general/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

const STATUS_LABEL: Record<GeneralAccessRequest['status'], string> = {
  open: 'Waiting',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

/**
 * An Owner answers here; everybody else sees what they asked for and can ask
 * for more. Requests are the one thing on this tab that waits on a person, so
 * the panel sits at the top of its column.
 */
export function RequestsPanel({ state }: { state: GeneralProjectState }) {
  if (state.isOwner) return <OwnerRequests state={state} />
  return <MyRequests state={state} />
}

function OwnerRequests({ state }: { state: GeneralProjectState }) {
  const open = state.requests.filter((r) => r.status === 'open')
  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <h2>Access requests</h2>
      <p className="mt-0.5 text-[12px] text-muted">Members asking for a permission their level does not include.</p>
      {open.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          Nothing waiting on you.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {open.map((r) => (
            <OwnerRequestRow key={r.id} request={r} state={state} />
          ))}
        </ul>
      )}
    </section>
  )
}

function OwnerRequestRow({ request, state }: { request: GeneralAccessRequest; state: GeneralProjectState }) {
  const { show } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function answer(approve: boolean) {
    setBusy(true)
    try {
      await answerAccessRequest(request.id, approve, note)
      show(approve ? 'Access granted' : 'Request declined')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that request.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-amber-300 bg-amber-400/6 p-3.5 dark:border-amber-400/40 dark:bg-amber-400/8">
      <p className="text-[14px] text-ink">
        <strong className="font-medium">{state.nameOf(request.user_id)}</strong> asked for{' '}
        <strong className="font-medium">{permissionLabel(request.permission)}</strong>
      </p>
      {request.reason && (
        <p className="mt-1.5 whitespace-pre-wrap rounded-lg surface px-3 py-2 text-[13px] text-muted">
          {request.reason}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="A note back"
          placeholder="A note back (optional)"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          className="!h-9 !text-[13px]"
        />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
            Decline
          </Button>
          <Button size="sm" loading={busy} onClick={() => void answer(true)}>
            Approve
          </Button>
        </div>
      </div>
    </li>
  )
}

function MyRequests({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const mine = state.requests.filter((r) => r.user_id === state.viewerId)
  const askable =
    state.me && !state.archived ? requestable(state.me.level, state.myGrants, state.myOpenRequests) : []

  async function withdraw(r: GeneralAccessRequest) {
    try {
      await withdrawAccessRequest(r.id)
      show('Request withdrawn')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that request.'), 'error')
    }
  }

  if (state.me?.level !== 'member') return null

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <h2>Your access</h2>
      <p className="mt-0.5 text-[12px] text-muted">
        {state.myGrants.length > 0
          ? `Beyond Member, you can: ${state.myGrants.map(permissionLabel).join(', ')}.`
          : 'You have what every Member has. Ask an Owner for more.'}
      </p>

      {mine.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {mine.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1 text-[13px] text-ink">{permissionLabel(r.permission)}</span>
              <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === 'open' && (
                <button
                  type="button"
                  onClick={() => void withdraw(r)}
                  className="text-[12px] font-medium text-muted hover:text-ink"
                >
                  Withdraw
                </button>
              )}
              {r.note && <p className="w-full text-[12px] text-faint">“{r.note}”</p>}
            </li>
          ))}
        </ul>
      )}

      {askable.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-[12px] font-medium text-muted">Ask for more</p>
          {askable.map((p) => (
            <div key={p} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink">
                {PERMISSIONS.find((x) => x.value === p)?.label}
              </span>
              <RequestAccessButton state={state} permission={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Write the invite panel**

```tsx
// src/components/general/InvitePanel.tsx
import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { FilterSearch } from '../ui/FilterPopover'
import { useLive } from '../../hooks/useLive'
import {
  inviteToProject,
  listProjectInvitations,
  searchPeople,
  setJoinCode,
  withdrawInvitation,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { PersonHit, ProjectInvitation } from '../../lib/general/types'
import { fullName } from '../../lib/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Bringing people in, two ways: find them by name, or hand out a code.
 *
 * A name search shows names and photos, never addresses — the email appears
 * only when the search was that exact address, which the person searching
 * already had.
 */
export function InvitePanel({ state }: { state: GeneralProjectState }) {
  const allowed = state.can('manage_members')
  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Bring people in</h2>
          <p className="mt-0.5 text-[12px] text-muted">Invite someone, or share a join code.</p>
        </div>
        {!allowed && <RequestAccessButton state={state} permission="manage_members" />}
      </header>
      {allowed && (
        <>
          <Search state={state} />
          <Pending state={state} />
        </>
      )}
      {(state.isOwner || (allowed && state.project?.join_open)) && <JoinCode state={state} />}
    </section>
  )
}

function Search({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      searchPeople(q)
        .then(setHits)
        .catch((err) => show(authErrorMessage(err, 'Could not search right now.'), 'error'))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, show])

  const memberIds = new Set(state.members.map((m) => m.user_id))

  async function invite(hit: PersonHit) {
    if (!state.project) return
    setInviting(hit.person_id)
    try {
      await inviteToProject(state.project.id, hit.person_id)
      show(`Invited ${hit.first_name} ${hit.last_name}`)
      setQuery('')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that invitation.'), 'error')
    } finally {
      setInviting(null)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <FilterSearch value={query} onChange={setQuery} placeholder="Name, or their exact email" />
      {query.trim().length > 0 && query.trim().length < 3 && (
        <p className="text-[12px] text-faint">Type at least three characters.</p>
      )}
      {searching && <p className="text-[12px] text-faint">Searching…</p>}
      {hits.length > 0 && (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
          {hits.map((hit) => {
            const onIt = memberIds.has(hit.person_id)
            return (
              <li key={hit.person_id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar
                  profile={{ first_name: hit.first_name, last_name: hit.last_name, avatar_url: hit.avatar_url }}
                  size={30}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    {hit.first_name} {hit.last_name}
                  </span>
                  {hit.email && <span className="block truncate text-[12px] text-faint">{hit.email}</span>}
                </span>
                {onIt ? (
                  <span className="text-[12px] text-faint">On the project</span>
                ) : (
                  <Button size="sm" loading={inviting === hit.person_id} onClick={() => void invite(hit)}>
                    Invite
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!searching && query.trim().length >= 3 && hits.length === 0 && (
        <p className="text-[12px] text-faint">Nobody matches. They may need to create an account first.</p>
      )}
    </div>
  )
}

function Pending({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const projectId = state.project?.id
  const [invites, setInvites] = useState<ProjectInvitation[]>([])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      setInvites(await listProjectInvitations(projectId))
    } catch {
      setInvites([])
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load, state.members.length])

  useLive(load, ['general_invitations'])

  if (invites.length === 0) return null

  async function withdraw(inv: ProjectInvitation) {
    try {
      await withdrawInvitation(inv.id)
      show('Invitation withdrawn')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that invitation.'), 'error')
    }
  }

  return (
    <div className="mt-5">
      <p className="text-[12px] font-medium text-muted">Waiting for an answer</p>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {invites.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
              {inv.invitee_profile ? fullName(inv.invitee_profile) : 'Somebody'}
            </span>
            <button
              type="button"
              onClick={() => void withdraw(inv)}
              className="text-[12px] font-medium text-muted hover:text-ink"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function JoinCode({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const [busy, setBusy] = useState(false)
  if (!p) return null

  async function set(open: boolean, regenerate = false) {
    if (!p) return
    setBusy(true)
    try {
      await setJoinCode(p.id, open, regenerate)
      show(open ? (regenerate ? 'New code made. The old one no longer works.' : 'Join code is on') : 'Join code is off')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the join code.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!p?.join_code) return
    try {
      await navigator.clipboard.writeText(p.join_code)
      show('Code copied')
    } catch {
      show('Could not copy. Select the code and copy it instead.', 'error')
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[12px] font-medium text-muted">Join code</p>
      {p.join_open && p.join_code ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-lg surface-sunken px-3 py-1.5 font-mono text-[16px] tracking-[0.2em] text-ink select-all">
            {p.join_code}
          </code>
          <button
            type="button"
            aria-label="Copy the join code"
            onClick={() => void copy()}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="copy" size={16} />
          </button>
          {state.isOwner && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void set(true, true)}>
                New code
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void set(false)}>
                Turn off
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">Off. Anyone with a code joins as a Member, so share it with care.</p>
          {state.isOwner && !state.archived && (
            <Button size="sm" variant="outline" loading={busy} onClick={() => void set(true)}>
              Turn on
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Write the structure panel**

```tsx
// src/components/general/StructurePanel.tsx
import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  addPositionHolder,
  addTeamMember,
  createPosition,
  createTeam,
  deletePosition,
  deleteTeam,
  removePositionHolder,
  removeTeamMember,
  renamePosition,
  renameTeam,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type Renaming = { kind: 'team' | 'position'; id: string; name: string } | null
type Removing = { kind: 'team' | 'position'; id: string; name: string } | null

/**
 * Teams split a project's people; positions say what somebody is to it.
 *
 * Neither grants anything. A "Treasurer" who needs to edit files still asks an
 * Owner for that, which keeps names free to be whatever the project calls its
 * people without each name becoming a security decision.
 */
export function StructurePanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const editable = state.can('manage_structure')
  const [teamName, setTeamName] = useState('')
  const [positionName, setPositionName] = useState('')
  const [positionTeam, setPositionTeam] = useState('')
  const [renaming, setRenaming] = useState<Renaming>(null)
  const [removing, setRemoving] = useState<Removing>(null)

  const project = state.project
  if (!project) return null

  async function run(action: () => Promise<void>, done: string, failed: string) {
    try {
      await action()
      show(done)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    }
  }

  const memberOptions = (taken: string[]) =>
    state.members
      .filter((m) => !taken.includes(m.user_id))
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Teams and positions</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Name them whatever this project calls them. They describe people; they grant nothing.
          </p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="manage_structure" />}
      </header>

      {/* Teams */}
      <div className="mt-5">
        <p className="text-[12px] font-medium text-muted">Teams</p>
        {state.teams.length === 0 && (
          <p className="mt-2 text-[13px] text-faint">No teams. Everybody works as one group.</p>
        )}
        <ul className="mt-2 space-y-2.5">
          {state.teams.map((team) => {
            const inTeam = state.teamMembers.filter((tm) => tm.team_id === team.id).map((tm) => tm.user_id)
            return (
              <li key={team.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{team.name}</p>
                  {editable && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${team.name}`}
                        onClick={() => setRenaming({ kind: 'team', id: team.id, name: team.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${team.name}`}
                        onClick={() => setRemoving({ kind: 'team', id: team.id, name: team.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <PeopleChips
                  ids={inTeam}
                  state={state}
                  editable={editable}
                  onRemove={(userId) =>
                    void run(() => removeTeamMember(team.id, userId), 'Taken off the team', 'Could not change the team.')
                  }
                />
                {editable && memberOptions(inTeam).length > 0 && (
                  <AddPerson
                    options={memberOptions(inTeam)}
                    onAdd={(userId) =>
                      void run(() => addTeamMember(team.id, project.id, userId), 'Added to the team', 'Could not change the team.')
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        {editable && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!teamName.trim()) return
              void run(() => createTeam(project.id, teamName), 'Team added', 'Could not add that team.').then(() =>
                setTeamName(''),
              )
            }}
          >
            <Input
              aria-label="New team name"
              placeholder="Logistics, Program, Finance"
              maxLength={LIMIT.generalShortName}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="!h-10"
            />
            <Button type="submit" size="sm" variant="outline" className="!h-10 shrink-0">
              Add team
            </Button>
          </form>
        )}
      </div>

      {/* Positions */}
      <div className="mt-6 border-t border-line pt-5">
        <p className="text-[12px] font-medium text-muted">Positions</p>
        {state.positions.length === 0 && (
          <p className="mt-2 text-[13px] text-faint">No positions yet, like Adviser, Chairperson or Treasurer.</p>
        )}
        <ul className="mt-2 space-y-2.5">
          {state.positions.map((position) => {
            const holding = state.holders.filter((h) => h.position_id === position.id).map((h) => h.user_id)
            const team = state.teams.find((t) => t.id === position.team_id)
            return (
              <li key={position.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                    {position.name}
                    <span className="ml-2 text-[12px] font-normal text-faint">
                      {team ? team.name : 'Whole project'}
                    </span>
                  </p>
                  {editable && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${position.name}`}
                        onClick={() => setRenaming({ kind: 'position', id: position.id, name: position.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${position.name}`}
                        onClick={() => setRemoving({ kind: 'position', id: position.id, name: position.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <PeopleChips
                  ids={holding}
                  state={state}
                  editable={editable}
                  onRemove={(userId) =>
                    void run(() => removePositionHolder(position.id, userId), 'Position updated', 'Could not change that position.')
                  }
                />
                {editable && memberOptions(holding).length > 0 && (
                  <AddPerson
                    options={memberOptions(holding)}
                    onAdd={(userId) =>
                      void run(
                        () => addPositionHolder(position.id, project.id, userId),
                        'Position updated',
                        'Could not change that position.',
                      )
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        {editable && (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!positionName.trim()) return
              void run(
                () => createPosition(project.id, positionName, positionTeam || null, state.positions.length),
                'Position added',
                'Could not add that position.',
              ).then(() => setPositionName(''))
            }}
          >
            <Input
              aria-label="New position name"
              placeholder="Adviser, Treasurer, Team lead"
              maxLength={LIMIT.generalShortName}
              value={positionName}
              onChange={(e) => setPositionName(e.target.value)}
              className="!h-10"
            />
            <Select
              aria-label="Position covers"
              value={positionTeam}
              onChange={(e) => setPositionTeam(e.target.value)}
              placeholder="Whole project"
              options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
              className="!h-10 !text-[13px]"
            />
            <Button type="submit" size="sm" variant="outline" className="!h-10">
              Add position
            </Button>
          </form>
        )}
      </div>

      <RenameDialog
        renaming={renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming) return
          await (renaming.kind === 'team' ? renameTeam(renaming.id, name) : renamePosition(renaming.id, name))
          show('Renamed')
          await state.reload()
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await (removing.kind === 'team' ? deleteTeam(removing.id) : deletePosition(removing.id))
          show(removing.kind === 'team' ? 'Team removed' : 'Position removed')
          await state.reload()
        }}
        title={`Remove ${removing?.name ?? ''}?`}
        body={
          removing?.kind === 'team'
            ? 'Its positions are removed with it. Its tasks stay on the project, just without a team.'
            : 'Whoever holds it keeps everything else on the project.'
        }
        confirmLabel="Remove"
      />
    </section>
  )
}

function PeopleChips({
  ids,
  state,
  editable,
  onRemove,
}: {
  ids: string[]
  state: GeneralProjectState
  editable: boolean
  onRemove: (userId: string) => void
}) {
  if (ids.length === 0) return <p className="mt-2 text-[12px] text-faint">Nobody yet.</p>
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <li
          key={id}
          className="flex items-center gap-1 rounded-full surface-sunken py-0.5 pr-1 pl-2.5 text-[12px] text-ink"
        >
          {state.nameOf(id)}
          {editable && (
            <button
              type="button"
              aria-label={`Take ${state.nameOf(id)} off`}
              onClick={() => onRemove(id)}
              className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function AddPerson({
  options,
  onAdd,
}: {
  options: { value: string; label: string }[]
  onAdd: (userId: string) => void
}) {
  return (
    <div className="mt-2 max-w-[16rem]">
      <Select
        aria-label="Add a person"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value)
        }}
        placeholder="Add a person…"
        options={options}
        className="!h-9 !text-[13px]"
      />
    </div>
  )
}

function RenameDialog({
  renaming,
  onClose,
  onSave,
}: {
  renaming: Renaming
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const { show } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(renaming?.name ?? '')
  }, [renaming])

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSave(name)
      onClose()
    } catch (err) {
      show(authErrorMessage(err, 'Could not rename that.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(renaming)}
      onClose={onClose}
      title={renaming?.kind === 'team' ? 'Rename team' : 'Rename position'}
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id) => (
          <Input id={id} maxLength={LIMIT.generalShortName} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
    </Modal>
  )
}
```

- [ ] **Step 4: Write the Members tab**

```tsx
// src/components/general/MembersTab.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  grantPermission,
  leaveProject,
  removeMember,
  revokePermission,
  setMemberLevel,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, PERMISSIONS, canStepDown, levelLabel, permissionLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type { GeneralMember } from '../../lib/general/types'
import { InvitePanel } from './InvitePanel'
import { RequestsPanel } from './RequestsPanel'
import { StructurePanel } from './StructurePanel'
import type { GeneralProjectState } from './useGeneralProject'

export function MembersTab({ state }: { state: GeneralProjectState }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-6">
        <MemberList state={state} />
        <StructurePanel state={state} />
      </div>
      <div className="space-y-6">
        <RequestsPanel state={state} />
        <InvitePanel state={state} />
      </div>
    </div>
  )
}

function MemberList({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [permissionsFor, setPermissionsFor] = useState<GeneralMember | null>(null)
  const [removing, setRemoving] = useState<GeneralMember | null>(null)
  const [leaving, setLeaving] = useState(false)
  const project = state.project
  if (!project) return null

  const canRemove = (m: GeneralMember) =>
    m.user_id !== state.viewerId &&
    state.can('manage_members') &&
    (m.level === 'member' || state.isOwner)

  async function changeLevel(m: GeneralMember, level: GeneralLevel) {
    if (!project) return
    try {
      await setMemberLevel(project.id, m.user_id, level)
      show(`${state.nameOf(m.user_id)} is now ${levelLabel(level)}`)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that access level.'), 'error')
    }
  }

  const positionsOf = (userId: string) =>
    state.holders
      .filter((h) => h.user_id === userId)
      .map((h) => state.positions.find((p) => p.id === h.position_id)?.name)
      .filter(Boolean) as string[]

  const me = state.me

  return (
    <section className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <h2>Members</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Owners and Managers can do everything. Members do what they were given.
          </p>
        </div>
        <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
          {state.members.length}
        </span>
      </header>

      <ul className="divide-y divide-[var(--line)]">
        {state.members.map((m) => {
          const grants = state.grants.filter((g) => g.user_id === m.user_id).map((g) => g.permission)
          const positions = positionsOf(m.user_id)
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
              {m.profile && <Avatar profile={m.profile} size={36} />}
              <div className="min-w-[12rem] flex-1">
                <p className="text-[14px] font-medium text-ink">
                  {state.nameOf(m.user_id)}
                  {m.user_id === state.viewerId && <span className="ml-1.5 text-[12px] font-normal text-faint">you</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {positions.length > 0 ? positions.join(', ') : 'No position'}
                  {grants.length > 0 && ` · Also: ${grants.map(permissionLabel).join(', ')}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {state.isOwner && !state.archived ? (
                  <Select
                    aria-label={`Access level for ${state.nameOf(m.user_id)}`}
                    value={m.level}
                    onChange={(e) => void changeLevel(m, e.target.value as GeneralLevel)}
                    options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
                    className="!h-9 !w-[8.5rem] !text-[13px]"
                  />
                ) : (
                  <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                    {levelLabel(m.level)}
                  </span>
                )}
                {state.isOwner && !state.archived && m.level === 'member' && (
                  <Button size="sm" variant="ghost" onClick={() => setPermissionsFor(m)}>
                    Permissions
                  </Button>
                )}
                {canRemove(m) && (
                  <button
                    type="button"
                    aria-label={`Remove ${state.nameOf(m.user_id)}`}
                    onClick={() => setRemoving(m)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {me && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          {canStepDown(me.level, state.ownerCount) ? (
            <>
              <p className="text-[12px] text-faint">Leaving removes your tasks' assignments and your positions.</p>
              <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                Leave project
              </Button>
            </>
          ) : (
            <p className="text-[12px] text-faint">
              You are the only Owner. Make someone else an Owner before you leave.
            </p>
          )}
        </footer>
      )}

      <PermissionsDialog member={permissionsFor} state={state} onClose={() => setPermissionsFor(null)} />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await removeMember(project.id, removing.user_id)
          show(`${state.nameOf(removing.user_id)} removed`)
          await state.reload()
        }}
        title={`Remove ${removing ? state.nameOf(removing.user_id) : 'this person'}?`}
        body="They lose access to the project, its tasks and its conversation. Tasks they created stay. You can invite them again."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          await leaveProject(project.id)
          show('You left the project')
          navigate('/general')
        }}
        title={`Leave ${project.name}?`}
        body="You lose access to the project and its conversation until somebody invites you back."
        confirmLabel="Leave project"
      />
    </section>
  )
}

function PermissionsDialog({
  member,
  state,
  onClose,
}: {
  member: GeneralMember | null
  state: GeneralProjectState
  onClose: () => void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const project = state.project
  const held = member ? state.grants.filter((g) => g.user_id === member.user_id).map((g) => g.permission) : []

  async function toggle(permission: (typeof PERMISSIONS)[number]['value'], on: boolean) {
    if (!project || !member) return
    setBusy(permission)
    try {
      if (on) await grantPermission(project.id, member.user_id, permission)
      else await revokePermission(project.id, member.user_id, permission)
      show(on ? `Granted: ${permissionLabel(permission)}` : `Taken back: ${permissionLabel(permission)}`)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that permission.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      title={member ? `What ${state.nameOf(member.user_id)} can also do` : 'Permissions'}
      description="On top of what every Member can do. To give everything, make them a Manager instead."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <ul className="space-y-2">
        {PERMISSIONS.map((p) => {
          const on = held.includes(p.value)
          return (
            <li key={p.value}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 hover:bg-[var(--surface-sunken)]">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={busy !== null}
                  onChange={(e) => void toggle(p.value, e.target.checked)}
                />
                <span>
                  <span className="block text-[14px] font-medium text-ink">{p.label}</span>
                  <span className="block text-[12px] text-muted">{p.note}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
```

- [ ] **Step 5: Render the tab**

In `src/pages/general/GeneralProject.tsx`, import `MembersTab` and render it after the Overview line:

```tsx
import { MembersTab } from '../../components/general/MembersTab'
```

```tsx
      {tab === 'members' && <MembersTab state={state} />}
```

- [ ] **Step 6: Run the checks**

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
node scripts/a11y-names.mjs
node scripts/motion-lint.mjs
node scripts/contrast.mjs
```

Expected: typecheck exits 0; lint `23 problems (0 errors, 23 warnings)`; `0 icon-only buttons with no accessible name`; `motion-lint: ok`; `0 failing pairs.`

- [ ] **Step 7: Verify the full access loop in the browser**

You need two General test accounts: **Owner** from Task 10, and a second, **Bravo**.
1. As Owner, open Members. Search Bravo by name. The result shows a name and photo with no email. Search Bravo's exact email; the email appears. Press **Invite**. Bravo is listed under "Waiting for an answer".
2. As Bravo, the bell shows the invitation, and it opens `/general`. Press **Join**. The project opens from its card.
3. As Bravo, the Members tab shows "Your access" with "Ask for more". Teams and positions are read-only, with a **Request access** button.
4. Bravo asks for **Edit files on any task** with a reason. The button changes to "Access requested".
5. As Owner, the Members tab count shows 1. The request shows the reason. Approve it with a note. Bravo gets a notification, and Bravo's row reads "Also: Edit files on any task".
6. As Owner, create a team "Logistics" and add Bravo. Create a position "Treasurer" for the whole project and give it to Bravo. Bravo's row reads "Treasurer".
7. As Owner, open **Permissions** on Bravo and untick edit files. The row no longer says "Also".
8. As Owner, turn on the join code, copy it, and turn it off.
9. As Owner, the footer says you are the only Owner. Make Bravo an Owner; the footer now offers **Leave project**.
10. Check the tab at 375px and 1440px, in both themes.

- [ ] **Step 8: Commit**

```bash
git add src/components/general/MembersTab.tsx src/components/general/RequestsPanel.tsx src/components/general/InvitePanel.tsx src/components/general/StructurePanel.tsx src/pages/general/GeneralProject.tsx
git commit -m "Add General project members, access requests, invitations, teams and positions"
```

---

### Task 13: The Tasks tab and a task's detail

**Files:**
- Create: `src/lib/general/history.ts`
- Test: `src/lib/general/history.test.ts`
- Create: `src/components/general/TasksTab.tsx`
- Create: `src/components/general/TaskDialog.tsx`
- Modify: `src/pages/general/GeneralProject.tsx`

**Interfaces:**
- Consumes: `GeneralProjectState` and `RequestAccessButton` (Task 11), Task 8's task, comment, file and log calls, Task 3's `projectProgress`, `taskShare` and `TASK_STATUSES`, Task 10's `formatDue`, `isOverdue`, `toLocalInput` and `fromLocalInput`, and `formatMinutes` from `src/lib/types.ts`.
- Produces:
  - `describeEvent(event: GeneralTaskEvent, nameOf: (id: string) => string): string`
  - `<TasksTab state />`, which opens `<TaskDialog>` from `?task=<id>`
  - `<TaskDialog state taskId onClose />`

**Who may do what on a task** mirrors `guard_general_task` and the policies in Task 6:
- `canManage` is `state.can('manage_tasks')`.
- `holds` is true when the viewer is an assignee.
- `canEdit` is `canManage || holds || (createdByMe && nobody holds it)`.
- `canAttach` is `holds || state.can('edit_files')`.
- Only `canManage` sets points, and only when the project has points on.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/general/history.test.ts
import { describe, expect, it } from 'vitest'
import { describeEvent } from './history'
import type { GeneralTaskEvent } from './types'

const names: Record<string, string> = { a: 'Ana Reyes', b: 'Ben Cruz' }
const nameOf = (id: string) => names[id] ?? 'A former member'

function event(over: Partial<GeneralTaskEvent>): GeneralTaskEvent {
  return {
    id: 'e1',
    task_id: 't1',
    project_id: 'p1',
    actor_id: 'a',
    kind: 'created',
    detail: {},
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  }
}

describe('describeEvent', () => {
  it('names who created the task', () => {
    expect(describeEvent(event({}), nameOf)).toBe('Ana Reyes created this task')
  })

  it('says where a task moved when only its status changed', () => {
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['status'], status: 'in_progress' } }), nameOf),
    ).toBe('Ana Reyes moved it to In progress')
  })

  it('lists the other things that changed in plain words', () => {
    expect(
      describeEvent(event({ kind: 'updated', detail: { fields: ['title', 'due_at', 'weight'] } }), nameOf),
    ).toBe('Ana Reyes changed the title, due date and points')
  })

  it('tells claiming apart from being assigned', () => {
    expect(describeEvent(event({ kind: 'assigned', detail: { user_id: 'a' } }), nameOf)).toBe(
      'Ana Reyes took this task',
    )
    expect(describeEvent(event({ kind: 'assigned', detail: { user_id: 'b' } }), nameOf)).toBe(
      'Ana Reyes assigned it to Ben Cruz',
    )
  })

  it('tells releasing apart from being taken off', () => {
    expect(describeEvent(event({ kind: 'unassigned', detail: { user_id: 'a' } }), nameOf)).toBe(
      'Ana Reyes released this task',
    )
    expect(describeEvent(event({ kind: 'unassigned', detail: { user_id: 'b' } }), nameOf)).toBe(
      'Ana Reyes took Ben Cruz off it',
    )
  })

  it('does not invent a name for a missing actor', () => {
    expect(describeEvent(event({ actor_id: null }), nameOf)).toBe('Somebody created this task')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/general/history.test.ts`
Expected: FAIL with `Failed to resolve import "./history"`

- [ ] **Step 3: Write `src/lib/general/history.ts`**

```ts
// src/lib/general/history.ts
import { TASK_STATUSES } from './progress'
import type { GeneralTaskEvent } from './types'

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  due_at: 'due date',
  team_id: 'team',
  weight: 'points',
}

function listOf(words: string[]) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** One line of a task's history, as a sentence. */
export function describeEvent(event: GeneralTaskEvent, nameOf: (id: string) => string) {
  const actor = event.actor_id ? nameOf(event.actor_id) : 'Somebody'
  const subject = event.detail.user_id
  switch (event.kind) {
    case 'created':
      return `${actor} created this task`
    case 'updated': {
      const fields = event.detail.fields ?? []
      if (fields.length === 1 && fields[0] === 'status') {
        const label = TASK_STATUSES.find((s) => s.value === event.detail.status)?.label ?? 'a new stage'
        return `${actor} moved it to ${label}`
      }
      return `${actor} changed the ${listOf(fields.map((f) => FIELD_WORDS[f] ?? f))}`
    }
    case 'assigned':
      return subject === event.actor_id
        ? `${actor} took this task`
        : `${actor} assigned it to ${subject ? nameOf(subject) : 'somebody'}`
    case 'unassigned':
      return subject === event.actor_id
        ? `${actor} released this task`
        : `${actor} took ${subject ? nameOf(subject) : 'somebody'} off it`
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/general/history.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the task dialog**

```tsx
// src/components/general/TaskDialog.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  addComment,
  addLog,
  assignTask,
  deleteComment,
  deleteLog,
  deleteTask,
  deleteTaskFile,
  generalFileUrl,
  listComments,
  listFiles,
  listLogs,
  listTaskEvents,
  unassignTask,
  updateTask,
  uploadTaskFile,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue, toLocalInput } from '../../lib/general/dates'
import { describeEvent } from '../../lib/general/history'
import { TASK_STATUSES, taskShare } from '../../lib/general/progress'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import type { GeneralComment, GeneralFile, GeneralLog, GeneralTaskEvent } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { formatMinutes } from '../../lib/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

export function TaskDialog({
  state,
  taskId,
  onClose,
}: {
  state: GeneralProjectState
  taskId: string | null
  onClose: () => void
}) {
  const task = state.tasks.find((t) => t.id === taskId) ?? null
  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      title={task?.title ?? 'Task'}
      description={task ? TASK_STATUSES.find((s) => s.value === task.status)?.label : undefined}
      size="xl"
    >
      {task && <TaskBody key={task.id} state={state} taskId={task.id} onClose={onClose} />}
    </Modal>
  )
}

function TaskBody({
  state,
  taskId,
  onClose,
}: {
  state: GeneralProjectState
  taskId: string
  onClose: () => void
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  const [comments, setComments] = useState<GeneralComment[]>([])
  const [files, setFiles] = useState<GeneralFile[]>([])
  const [logs, setLogs] = useState<GeneralLog[]>([])
  const [events, setEvents] = useState<GeneralTaskEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, f, l, e] = await Promise.all([
        listComments(taskId),
        listFiles(taskId),
        listLogs(taskId),
        listTaskEvents(taskId),
      ])
      setComments(c)
      setFiles(f)
      setLogs(l)
      setEvents(e)
    } catch (err) {
      show(authErrorMessage(err, 'Could not load this task.'), 'error')
    } finally {
      setLoaded(true)
    }
  }, [taskId, show])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_task_comments', 'general_task_files', 'general_task_logs', 'general_task_events'])

  if (!task || !state.project) return null

  const me = state.viewerId
  const holds = Boolean(me && task.assignee_ids.includes(me))
  const canManage = state.can('manage_tasks')
  const createdByMe = task.created_by === me
  const archived = state.archived
  const canEdit = !archived && (canManage || holds || (createdByMe && task.assignee_ids.length === 0))
  const canAttach = !archived && (holds || state.can('edit_files'))
  const canDelete = !archived && (canManage || (createdByMe && task.assignee_ids.length === 0))

  async function act(action: () => Promise<void>, done: string, failed: string) {
    try {
      await action()
      if (done) show(done)
      await Promise.all([state.reload(), load()])
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <TaskDetails state={state} taskId={task.id} canEdit={canEdit} canManage={canManage} onSaved={load} />

        <section>
          <h3 className="text-[14px]">Comments</h3>
          <ul className="mt-2 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl surface-sunken px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-ink">
                    {c.author_id ? state.nameOf(c.author_id) : 'A former member'}
                    <span className="ml-2 font-normal text-faint">{formatDue(c.created_at)}</span>
                  </p>
                  {(c.author_id === me || canManage) && !archived && (
                    <button
                      type="button"
                      aria-label="Remove comment"
                      onClick={() => void act(() => deleteComment(c.id), 'Comment removed', 'Could not remove it.')}
                      className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{c.body}</p>
              </li>
            ))}
            {loaded && comments.length === 0 && <p className="text-[13px] text-faint">No comments yet.</p>}
          </ul>
          {!archived && (
            <CommentForm
              onSend={(body) =>
                act(() => addComment(task.id, task.project_id, body), '', 'Could not post that comment.')
              }
            />
          )}
        </section>
      </div>

      <div className="space-y-6">
        <section>
          <h3 className="text-[14px]">People</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {task.assignee_ids.map((id) => (
              <li
                key={id}
                className="flex items-center gap-1 rounded-full surface-sunken py-0.5 pr-1 pl-2.5 text-[12px] text-ink"
              >
                {state.nameOf(id)}
                {!archived && (canManage || id === me) && (
                  <button
                    type="button"
                    aria-label={id === me ? 'Release this task' : `Take ${state.nameOf(id)} off`}
                    onClick={() =>
                      void act(() => unassignTask(task.id, id), id === me ? 'Released' : 'Taken off', 'Could not change that.')
                    }
                    className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </li>
            ))}
            {task.assignee_ids.length === 0 && <li className="text-[13px] text-faint">Nobody holds this yet.</li>}
          </ul>
          {!archived && canManage && (
            <div className="mt-2 max-w-[16rem]">
              <Select
                aria-label="Assign someone"
                value=""
                onChange={(e) => {
                  const userId = e.target.value
                  if (userId) void act(() => assignTask(task.id, task.project_id, userId), 'Assigned', 'Could not assign that.')
                }}
                placeholder="Assign someone…"
                options={state.members
                  .filter((m) => !task.assignee_ids.includes(m.user_id))
                  .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))}
                className="!h-9 !text-[13px]"
              />
            </div>
          )}
          {!archived && !canManage && task.assignee_ids.length === 0 && me && (
            <Button
              size="sm"
              className="mt-2"
              onClick={() => void act(() => assignTask(task.id, task.project_id, me), 'The task is yours', 'Could not take it.')}
            >
              Take this task
            </Button>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px]">Files</h3>
            {!canAttach && !archived && <RequestAccessButton state={state} permission="edit_files" />}
          </div>
          <ul className="mt-2 space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Icon name="file" size={15} className="shrink-0 text-faint" />
                <button
                  type="button"
                  onClick={() =>
                    void generalFileUrl(f.file_path)
                      .then((url) => window.open(url, '_blank', 'noopener'))
                      .catch((err) => show(authErrorMessage(err, 'Could not open that file.'), 'error'))
                  }
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
                >
                  {f.file_name}
                </button>
                {!archived && (f.uploaded_by === me || state.can('edit_files')) && (
                  <button
                    type="button"
                    aria-label={`Remove ${f.file_name}`}
                    onClick={() => void act(() => deleteTaskFile(f), 'File removed', 'Could not remove that file.')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
            {loaded && files.length === 0 && <li className="text-[13px] text-faint">No files.</li>}
          </ul>
          {canAttach && (
            <FilePicker
              onPick={(file) =>
                act(() => uploadTaskFile(task.project_id, task.id, file), 'File added', 'Could not upload that file.')
              }
            />
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px]">Time</h3>
            <span className="font-mono text-[12px] text-faint">{formatMinutes(task.logged_minutes)}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-[13px]">
                <span className="w-14 shrink-0 font-mono text-ink">{formatMinutes(l.minutes)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {state.nameOf(l.user_id)}
                  {l.note ? ` · ${l.note}` : ''}
                </span>
                {l.user_id === me && !archived && (
                  <button
                    type="button"
                    aria-label="Remove time entry"
                    onClick={() => void act(() => deleteLog(l.id), 'Entry removed', 'Could not remove that entry.')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-red-600"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {holds && !archived && (
            <LogForm
              onLog={(minutes, note) =>
                act(() => addLog(task.id, task.project_id, minutes, note), 'Time logged', 'Could not log that time.')
              }
            />
          )}
        </section>

        <section>
          <h3 className="text-[14px]">History</h3>
          <ul className="mt-2 space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[12px] text-muted">
                {describeEvent(e, state.nameOf)}
                <span className="ml-1.5 text-faint">{formatDue(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        {canDelete && (
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={14} />
            Remove task
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await deleteTask(task.id)
          show('Task removed')
          onClose()
          await state.reload()
        }}
        title={`Remove ${task.title}?`}
        body="Its comments, files, time and history go with it. This cannot be undone."
        confirmLabel="Remove task"
      />
    </div>
  )
}

function TaskDetails({
  state,
  taskId,
  canEdit,
  canManage,
  onSaved,
}: {
  state: GeneralProjectState
  taskId: string
  canEdit: boolean
  canManage: boolean
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const task = state.tasks.find((t) => t.id === taskId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<GeneralTaskStatus>('todo')
  const [due, setDue] = useState('')
  const [team, setTeam] = useState('')
  const [weight, setWeight] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updatedAt = task?.updated_at
  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description)
    setStatus(task.status)
    setDue(toLocalInput(task.due_at))
    setTeam(task.team_id ?? '')
    setWeight(String(task.weight))
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!task || !state.project) return null
  const points = state.project.points_enabled

  if (!canEdit) {
    return (
      <section className="space-y-2 text-[14px]">
        <p className={task.due_at && isOverdue(task.due_at, task.status) ? 'text-red-600 dark:text-red-400' : 'text-muted'}>
          {task.due_at ? `Due ${formatDue(task.due_at)}` : 'No due date'}
          {points && ` · ${taskShare(Number(task.weight), state.tasks)}% of the project`}
        </p>
        <p className="whitespace-pre-wrap text-ink">{task.description || 'No description.'}</p>
      </section>
    )
  }

  async function save() {
    if (!task) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const w = Number(weight)
    if (canManage && points && (!Number.isFinite(w) || w <= 0 || w > 1000))
      return setError('Points are a number above 0 and up to 1000.')
    setBusy(true)
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description,
        status,
        due_at: fromLocalInput(due),
        team_id: team || null,
        ...(canManage && points ? { weight: w } : {}),
      })
      show('Task saved')
      await Promise.all([state.reload(), onSaved()])
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Title">
        {(id) => <Input id={id} maxLength={LIMIT.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralTaskStatus)}
              options={TASK_STATUSES}
            />
          )}
        </Field>
        <Field label="Due" optional>
          {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        <Field label="Team" optional>
          {(id) => (
            <Select
              id={id}
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Whole project"
              options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
            />
          )}
        </Field>
        {points && canManage && (
          <Field
            label="Points"
            hint={<span className="text-[12px] text-faint">{taskShare(Number(task.weight), state.tasks)}% now</span>}
          >
            {(id) => (
              <Input id={id} type="number" min={0.01} max={1000} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
            )}
          </Field>
        )}
      </div>
      <Field label="Description" optional>
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            maxLength={LIMIT.generalDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={busy}>
          Save task
        </Button>
      </div>
    </section>
  )
}

function CommentForm({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!body.trim()) return
        setBusy(true)
        void onSend(body)
          .then(() => setBody(''))
          .finally(() => setBusy(false))
      }}
    >
      <Textarea
        aria-label="Write a comment"
        rows={2}
        maxLength={LIMIT.commentBody}
        placeholder="Write a comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy} disabled={!body.trim()}>
          Comment
        </Button>
      </div>
    </form>
  )
}

function FilePicker({ onPick }: { onPick: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          void onPick(file).finally(() => setBusy(false))
        }}
      />
      <Button variant="outline" size="sm" className="mt-2" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
        Add a file
      </Button>
    </>
  )
}

function LogForm({ onLog }: { onLog: (minutes: number, note: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="mt-2 grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        const m = Number(minutes)
        if (!Number.isInteger(m) || m < 1 || m > 1440) {
          setError('Log between 1 and 1440 minutes at a time.')
          return
        }
        setError(null)
        void onLog(m, note).then(() => {
          setMinutes('')
          setNote('')
        })
      }}
    >
      <Input
        aria-label="Minutes"
        type="number"
        min={1}
        max={1440}
        placeholder="Minutes"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        className="!h-9 !text-[13px]"
      />
      <Input
        aria-label="What you did"
        maxLength={LIMIT.worklogNote}
        placeholder="What you did"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="!h-9 !text-[13px]"
      />
      <Button type="submit" size="sm" variant="outline" className="!h-9">
        Log
      </Button>
      {error && <p className="text-[12px] text-red-600 sm:col-span-3 dark:text-red-400">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 6: Write the Tasks tab**

```tsx
// src/components/general/TasksTab.tsx
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { createTask } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue, fromLocalInput, isOverdue } from '../../lib/general/dates'
import { TASK_STATUSES, projectProgress, taskShare } from '../../lib/general/progress'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import type { GeneralTask } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { TaskDialog } from './TaskDialog'
import type { GeneralProjectState } from './useGeneralProject'

type View = 'board' | 'list'

export function TasksTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('board')
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [assignee, setAssignee] = useState('')
  const [status, setStatus] = useState<GeneralTaskStatus | ''>('')
  const [creating, setCreating] = useState(false)

  const openTask = params.get('task')
  const showTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  const project = state.project
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.tasks
      .filter((t) => (team ? t.team_id === team : true))
      .filter((t) =>
        assignee === ''
          ? true
          : assignee === 'nobody'
            ? t.assignee_ids.length === 0
            : t.assignee_ids.includes(assignee),
      )
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (q ? `${t.title} ${t.description}`.toLowerCase().includes(q) : true))
  }, [state.tasks, query, team, assignee, status])

  if (!project) return null
  const progress = projectProgress(state.tasks, project.points_enabled)

  const assigneeOptions = [
    ...(state.viewerId ? [{ value: state.viewerId, label: 'Me' }] : []),
    { value: 'nobody', label: 'Nobody yet' },
    ...state.members
      .filter((m) => m.user_id !== state.viewerId)
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) })),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="surface-sunken flex gap-1 rounded-lg p-0.5" role="group" aria-label="View">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
                view === v ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon name={v === 'board' ? 'kanban' : 'board'} size={15} />
              {v}
            </button>
          ))}
        </div>

        <FilterPopover
          label="Filter tasks"
          active={[query.trim(), team, assignee, status].filter(Boolean).length}
          summary={[
            query.trim() && `“${query.trim()}”`,
            team && state.teams.find((t) => t.id === team)?.name,
            assignee && assigneeOptions.find((o) => o.value === assignee)?.label,
            status && TASK_STATUSES.find((s) => s.value === status)?.label,
          ]
            .filter(Boolean)
            .join(' · ')}
          onClear={() => {
            setQuery('')
            setTeam('')
            setAssignee('')
            setStatus('')
          }}
        >
          <FilterField label="Search">
            <FilterSearch value={query} onChange={setQuery} placeholder="Title or description" />
          </FilterField>
          {state.teams.length > 0 && (
            <FilterField label="Team">
              <Select
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="Every team"
                options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                className="!h-10 !text-[13px]"
              />
            </FilterField>
          )}
          <FilterField label="Held by">
            <Select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Anyone"
              options={assigneeOptions}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
          <FilterField label="Stage">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralTaskStatus | '')}
              placeholder="Every stage"
              options={TASK_STATUSES}
              className="!h-10 !text-[13px]"
            />
          </FilterField>
        </FilterPopover>

        <p className="text-[12px] text-muted">
          {progress.done} of {progress.total} done · {progress.pct}%
          {project.points_enabled ? ' by points' : ''}
        </p>

        {!state.archived && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New task
          </Button>
        )}
      </div>

      {state.tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="No tasks yet"
          body="Break the project into pieces somebody can pick up. Anyone on the project can add one."
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" body="No task fits these filters." />
      ) : view === 'board' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((s) => {
            const column = shown.filter((t) => t.status === s.value)
            return (
              <section key={s.value} className="rounded-panel surface-sunken p-3">
                <header className="flex items-center justify-between px-1 pb-2">
                  <h3 className="text-[14px]">{s.label}</h3>
                  <span className="font-mono text-[12px] text-faint">{column.length}</span>
                </header>
                <ul className="space-y-2">
                  {column.map((t) => (
                    <li key={t.id}>
                      <TaskCard task={t} state={state} onOpen={() => showTask(t.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Held by</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                {project.points_enabled && <th className="px-4 py-2.5 font-medium">Share</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {shown.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-[var(--surface-sunken)]" onClick={() => showTask(t.id)}>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left font-medium text-ink hover:underline">
                      {t.title}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted">{TASK_STATUSES.find((s) => s.value === t.status)?.label}</td>
                  <td className="px-4 py-3 text-muted">
                    {t.assignee_ids.length ? t.assignee_ids.map(state.nameOf).join(', ') : 'Nobody yet'}
                  </td>
                  <td className={`px-4 py-3 ${isOverdue(t.due_at, t.status) ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
                    {t.due_at ? formatDue(t.due_at) : '—'}
                  </td>
                  {project.points_enabled && (
                    <td className="px-4 py-3 font-mono text-faint">{taskShare(Number(t.weight), state.tasks)}%</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewTaskDialog open={creating} onClose={() => setCreating(false)} state={state} onCreated={showTask} />
      <TaskDialog state={state} taskId={openTask} onClose={() => showTask(null)} />
    </div>
  )
}

function TaskCard({ task, state, onOpen }: { task: GeneralTask; state: GeneralProjectState; onOpen: () => void }) {
  const teamName = state.teams.find((t) => t.id === task.team_id)?.name
  const overdue = isOverdue(task.due_at, task.status)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-card border border-line bg-[var(--surface)] p-3 text-left transition-colors hover:border-line-strong"
    >
      <p className="text-[14px] font-medium text-ink">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {teamName && <span className="rounded-md surface-sunken px-1.5 py-0.5 text-muted">{teamName}</span>}
        {task.due_at && (
          <span className={overdue ? 'text-red-600 dark:text-red-400' : 'text-faint'}>{formatDue(task.due_at)}</span>
        )}
        {state.project?.points_enabled && (
          <span className="font-mono text-faint">{taskShare(Number(task.weight), state.tasks)}%</span>
        )}
      </div>
      <p className="mt-2 truncate text-[12px] text-muted">
        {task.assignee_ids.length ? task.assignee_ids.map(state.nameOf).join(', ') : 'Nobody yet'}
      </p>
      {(task.comment_count > 0 || task.file_count > 0) && (
        <p className="mt-1.5 flex gap-3 text-[12px] text-faint">
          {task.comment_count > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="message" size={12} />
              {task.comment_count}
            </span>
          )}
          {task.file_count > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="file" size={12} />
              {task.file_count}
            </span>
          )}
        </p>
      )}
    </button>
  )
}

function NewTaskDialog({
  open,
  onClose,
  state,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  onCreated: (id: string) => void
}) {
  const { show } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [team, setTeam] = useState('')
  const [weight, setWeight] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = state.project
  const setsPoints = Boolean(project?.points_enabled && state.can('manage_tasks'))

  async function create() {
    if (!project) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const w = setsPoints ? Number(weight) : 1
    if (!Number.isFinite(w) || w <= 0 || w > 1000) return setError('Points are a number above 0 and up to 1000.')
    setBusy(true)
    try {
      const id = await createTask({
        projectId: project.id,
        title,
        description,
        dueAt: fromLocalInput(due),
        teamId: team || null,
        weight: w,
      })
      show('Task added')
      setTitle('')
      setDescription('')
      setDue('')
      setTeam('')
      setWeight('1')
      onClose()
      await state.reload()
      onCreated(id)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void create()} loading={busy}>
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title">
          {(id) => (
            <Input id={id} maxLength={LIMIT.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due" optional>
            {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
          {state.teams.length > 0 && (
            <Field label="Team" optional>
              {(id) => (
                <Select
                  id={id}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="Whole project"
                  options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                />
              )}
            </Field>
          )}
          {setsPoints && (
            <Field label="Points">
              {(id) => (
                <Input id={id} type="number" min={0.01} max={1000} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
              )}
            </Field>
          )}
        </div>
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 7: Render the tab**

In `src/pages/general/GeneralProject.tsx`, import `TasksTab` and render it between the Overview and Members lines:

```tsx
import { TasksTab } from '../../components/general/TasksTab'
```

```tsx
      {tab === 'tasks' && <TasksTab state={state} />}
```

- [ ] **Step 8: Run the checks**

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
npm run test
node scripts/a11y-names.mjs
node scripts/motion-lint.mjs
node scripts/contrast.mjs
```

Expected: typecheck exits 0; lint `23 problems (0 errors, 23 warnings)`; every test file passes, including `history.test.ts` (6); `0 icon-only buttons with no accessible name`; `motion-lint: ok`; `0 failing pairs.`

- [ ] **Step 9: Verify the task flow in the browser**

Using Owner and Bravo from Task 12, with Bravo a Member again:
1. As Bravo, open Tasks and press **New task**. There is no Points field, even with points on. Add "Print certificates". The dialog opens on the new task.
2. As Bravo, press **Take this task**. Bravo's name appears under People, and History reads "… took this task".
3. As Bravo, set the stage to In progress and save. The card moves to the In progress column.
4. As Bravo, log 30 minutes with a note. Time shows `30m`. Add a comment.
5. As Owner, comment on Bravo's task. Bravo's bell shows the comment. Bravo's own comment did not notify Owner, because comments notify only whoever holds the task.
6. As Owner, open the task. Points appear. Assign Owner as a second holder. Bravo's bell shows nothing new, because Bravo was not the one assigned.
7. As Bravo, open Owner's task that Bravo does not hold. The Files section shows **Request access**, and editing fields are read-only.
8. As Owner, grant Bravo **Edit files on any task**. As Bravo, the same task now shows **Add a file**. Upload a small PDF; it opens in a new tab through a signed link.
9. As Owner, revoke the permission. As Bravo, **Add a file** is gone again.
10. Switch to List view, filter "Held by: Me", then clear. With points on, the Share column adds up to 100%.
11. Open `/general/projects/<id>?task=<task id>` directly. The Tasks tab opens with that task.
12. Check the board and dialog at 375px and 1440px, in both themes. The list scrolls sideways inside its own container on a phone, and the page does not.

- [ ] **Step 10: Commit**

```bash
git add src/lib/general/history.ts src/lib/general/history.test.ts src/components/general/TasksTab.tsx src/components/general/TaskDialog.tsx src/pages/general/GeneralProject.tsx
git commit -m "Add General project tasks with holders, comments, files, time and history"
```

---

### Task 14: End-to-end verification

**Files:** none new. Any fix found here goes in the file it belongs to, with its own commit.

- [ ] **Step 1: Run the whole database suite in rebuild order**

```bash
node scripts/db.mjs supabase/workplaces.sql supabase/general.sql supabase/general-tasks.sql supabase/general-notify.sql
node scripts/db.mjs supabase/tests/workplaces.test.sql supabase/tests/general.test.sql supabase/tests/general-tasks.test.sql supabase/tests/general-notify.test.sql
node scripts/db.mjs supabase/tests/accounts.test.sql supabase/tests/approvals.test.sql supabase/tests/notifications.test.sql supabase/tests/rate-limit.test.sql supabase/tests/results.test.sql supabase/tests/submissions.test.sql supabase/tests/reassignments.test.sql
node scripts/schema-drift.mjs
```

Expected:
- All four SQL files apply twice without error.
- The new tests print 20, 58, 31 and 18 `PASS` lines.
- The Education test files still pass.
- The drift report shows the four new overlaps named in Tasks 4 and 7, each with the last definition longest.

- [ ] **Step 2: Run the full check**

```bash
npm run typecheck && npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs && npm run test && npm run build && node scripts/contrast.mjs && node scripts/a11y-names.mjs && node scripts/schema-drift.mjs && node scripts/motion-lint.mjs && node scripts/legal-ready.mjs
```

Expected: exit code 0. Lint reports `23 problems (0 errors, 23 warnings)`, and every test file passes.

- [ ] **Step 3: Walk Education once more**

1. An existing student lands on `/student`. Class projects, tasks, submissions and messages all load.
2. An existing professor lands on `/professor`. The Groups tab, Submissions and Reassignments load.
3. The admin lands on `/admin`, and the General workplace counts band shows figures only.
4. On an Education project page, open the notification bell. An Education notification still opens its Education page.

- [ ] **Step 4: Walk General end to end, as the spec's verification lists it**

1. Register for General and land on the General home.
2. Create a project. Add a field, a team and a position.
3. Invite a second account, which accepts.
4. The second account requests `edit_files`. The Owner approves, and file editing unlocks.
5. Switch to Education and pick professor. The account lands on pending, and General still works.
6. Existing student and professor accounts still land in Education, unchanged.
7. Check both themes at 375px and 1440px.

- [ ] **Step 5: Restore any test data you changed**

Every SQL test rolls back. Browser testing creates real rows: the test accounts, their project, tasks and uploaded files. Archive the test project from its page, then list what else was created so the owner can decide what to delete:

```bash
node scripts/db.mjs -c "select p.id, p.name, p.created_at from public.general_projects p order by p.created_at desc limit 10"
```

Do not delete accounts. Report them to the owner instead.

- [ ] **Step 6: Push**

```bash
git push
```

