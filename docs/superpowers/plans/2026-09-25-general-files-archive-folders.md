# General files, archive visibility and folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the clipped 3-dot menus, split and search the Files tabs, make the project archive per-person with an Owner/Manager override enforced in Postgres, and add real site-made folders with a folder page, rename and breadcrumbs.

**Architecture:** One portal-based `ActionMenu` replaces every 3-dot menu. Archive visibility moves into SQL through a new helper `general_sees_archived` and redefinitions in `supabase/general-archive-rbac.sql`. Folders stay path prefixes; an empty site-made folder is a hidden `<folder>/.keep` draft file, so the existing submit / review / archive pipeline carries it unchanged. Folder rename is one RPC in `supabase/general-folders.sql`. Folder navigation is URL state (`view`, `path`) on the existing `?tab=files` route.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 tokens, Supabase Postgres (plpgsql, RLS, `security definer` RPCs), vitest.

Spec: `docs/superpowers/specs/2026-09-25-general-files-archive-folders-design.md`.

## Global Constraints

- Colours only from tokens in `src/styles/index.css` (`text-ink`, `text-muted`, `text-faint`, `surface*`, `border-line*`, `navy-*`, `amber-*`); `white/NN` is allowed only as the dark-mode variant.
- Dark mode is the `.dark` class — use `dark:` variants, never a media query.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Every SQL file is idempotent and gets run twice: `create or replace`, `drop … if exists` before a return-type change, `if not exists`.
- Every RPC: `security definer`, `set search_path = public`, `revoke all … from public, anon`, `grant execute … to authenticated`.
- Never print `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`.
- No code comments except where the WHY is non-obvious, one line max.
- `npm run build` must pass before any task is called done. Lint baseline: 23 warnings, 0 errors.
- Archive rule: an archived item is visible to whoever archived it, and to the project's Owners and Managers.
- Folder name: 1–120 characters, no `/` or `\`, not `.` or `..`, unique (case-insensitive) in its folder. Collision copy: `A folder called <name> is already here. Pick another name.`
- `.keep` is the placeholder file name. It is never shown or counted.

## File map

| File | Responsibility |
|---|---|
| `src/components/ui/ActionMenu.tsx` (new) | The one 3-dot menu: portal panel, positioning, keyboard, trigger contrast |
| `src/lib/general/review.ts` (new) + `.test.ts` | Split changes into mine / to me / others |
| `src/lib/general/search.ts` (new) + `.test.ts` | One case-insensitive matcher for every search box |
| `src/lib/general/files.ts` + `.test.ts` | `.keep` hiding, folder-name rules, `nodesAt`, `crumbs`, `flatFiles`, `joinPath` |
| `src/components/general/FolderBar.tsx` (new) | Breadcrumbs plus the current folder's actions |
| `src/components/general/RenameFolderDialog.tsx` (new) | Name field + `renameDraftFolder` |
| `src/components/general/NewItemDialog.tsx` (new) | "+ New" chooser: new folder, upload file, upload folder |
| `src/components/general/FilesTab.tsx` | URL-driven view/path, search, wiring |
| `src/components/general/DraftPanel.tsx` | One folder level at a time, `ActionMenu` |
| `src/components/general/RepoChangeRow.tsx` | Withdraw via menu + confirmation |
| `src/components/general/TaskDialog.tsx` | Archive button moves to the top |
| `src/components/messages/MessageBubble.tsx` | Uses `ActionMenu` |
| `src/pages/general/ProjectArchive.tsx` | Row and section actions in `ActionMenu`, other members' draft items for leads |
| `src/lib/api/general.ts`, `src/lib/general/types.ts` | `renameDraftFolder`, owner on archived draft files |
| `supabase/general-archive-rbac.sql` (new) + test | Archive visibility |
| `supabase/general-folders.sql` (new) + test | `rename_general_draft_folder` |
| `scripts/schema-drift.mjs`, `docs/07-backup.md` | Register the new SQL files |

---

### Task 1: Commit the in-progress draft-tree baseline

The working tree already holds ~740 uncommitted lines (draft folder tree, draft archiving, archive page rework) whose SQL is already committed. Everything below builds on it, so it lands first as its own commit.

**Files:**
- Modify (already modified, commit only): `src/components/general/DraftPanel.tsx`, `src/components/general/FilesTab.tsx`, `src/lib/api/general.ts`, `src/lib/general/types.ts`, `src/pages/general/GeneralProject.tsx`, `src/pages/general/ProjectArchive.tsx`

**Interfaces:**
- Produces: `archiveDraftPath(repoId, path, archived)`, `submitDraftFolder(repoId, path, title, body, reviewerId)`, `DraftActionMenu` (replaced in Task 2), `DraftArchiveNode` in `ProjectArchive.tsx`.

- [ ] **Step 1: Verify it builds and tests pass**

Run: `npm run build && npm run test && npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs`
Expected: build succeeds, all vitest suites pass, lint `23 problems (0 errors, 23 warnings)`.

- [ ] **Step 2: Commit only those six files**

```bash
git add src/components/general/DraftPanel.tsx src/components/general/FilesTab.tsx src/lib/api/general.ts src/lib/general/types.ts src/pages/general/GeneralProject.tsx src/pages/general/ProjectArchive.tsx
git commit -m "$(cat <<'EOF'
Show drafts as folders and let them be archived

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Do not stage `graphify-out/`, `desktop.ini`, `docs/redesign/`, or `handoff.md`.

---

### Task 2: ActionMenu, and every 3-dot menu on it

**Files:**
- Create: `src/components/ui/ActionMenu.tsx`
- Modify: `src/components/general/DraftPanel.tsx` (delete `DraftActionMenu`, lines ~337–410; its two call sites)
- Modify: `src/components/messages/MessageBubble.tsx:101-114` (menu state/effect) and `:238-312` (menu JSX)

**Interfaces:**
- Produces:
  ```ts
  export type ActionMenuItem = {
    label: string
    icon?: IconName
    onSelect: () => void
    tone?: 'danger'
    disabled?: boolean
    separated?: boolean
  }
  export function ActionMenu(props: {
    label: string          // accessible name of the trigger
    items: ActionMenuItem[] // falsy entries are skipped
    align?: 'start' | 'end' // default 'end'
    disabled?: boolean
    size?: 'sm' | 'md'      // sm = 28px trigger, md = 32px (default)
  }): JSX.Element
  ```

- [ ] **Step 1: Create `src/components/ui/ActionMenu.tsx`**

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type ActionMenuItem = {
  label: string
  icon?: IconName
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
  separated?: boolean
}

const WIDTH = 208
const GAP = 4

export function ActionMenu({
  label,
  items,
  align = 'end',
  disabled = false,
  size = 'md',
}: {
  label: string
  items: (ActionMenuItem | false | null | undefined)[]
  align?: 'start' | 'end'
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const shown = items.filter(Boolean) as ActionMenuItem[]

  // Rendered through a portal so no overflow-hidden list or card can clip it.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const t = trigger.current?.getBoundingClientRect()
      if (!t) return
      const h = panel.current?.offsetHeight ?? 0
      const below = t.bottom + GAP
      const top = below + h > window.innerHeight - 8 && t.top - GAP - h > 8 ? t.top - GAP - h : below
      const raw = align === 'end' ? t.right - WIDTH : t.left
      const left = Math.min(Math.max(8, raw), window.innerWidth - WIDTH - 8)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (shown.length === 0) return null

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`grid shrink-0 place-items-center rounded-lg text-ink/70 transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-40 dark:text-white/80 dark:hover:text-white ${
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
        } ${open ? 'bg-[var(--surface-sunken)] text-ink dark:text-white' : ''}`}
      >
        <Icon name="dots" size={size === 'sm' ? 15 : 17} strokeWidth={2.4} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
            className="app-ui surface fixed z-[70] overflow-hidden rounded-xl border border-line py-1 shadow-lift"
          >
            {shown.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] disabled:opacity-50 ${
                  item.separated ? 'mt-1 border-t border-line pt-2.5' : ''
                } ${
                  item.tone === 'danger'
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
                    : 'text-ink hover:bg-[var(--surface-sunken)]'
                }`}
              >
                {item.icon && <Icon name={item.icon} size={15} className={item.tone === 'danger' ? '' : 'text-muted'} />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
```

`html.has-modal .app-ui` blurs everything under `.app-ui`. The panel carries `app-ui` for its tokens, so when a menu opens inside a modal it would blur too. Step 2 stops that.

- [ ] **Step 2: Scope the modal blur to the shell only**

In `src/styles/index.css` change the rule added for modals:

```css
html.has-modal .app-ui:not([role='menu']) {
  filter: blur(4px);
  transition: filter 200ms ease;
}
```

Also check `Icon` accepts `strokeWidth`: `grep -n "strokeWidth" src/components/ui/Icon.tsx`. If there's no match, remove `strokeWidth={2.4}` from Step 1. The contrast change alone meets the spec.

- [ ] **Step 3: Replace `DraftActionMenu` in `DraftPanel.tsx`**

Delete the whole `function DraftActionMenu(…) { … }`, plus `useEffect, useRef` from the React import if nothing else uses them. Add `import { ActionMenu } from '../ui/ActionMenu'`. Replace both call sites. The folder row uses:

```tsx
<ActionMenu
  label={`Actions for ${node.name}`}
  disabled={busy}
  items={[
    { label: 'Submit for review', icon: 'refresh', disabled: behind, onSelect: () => onSubmit({ type: 'folder', path: node.path }) },
    { label: 'Archive', icon: 'archive', onSelect: () => onArchive({ type: 'folder', path: node.path }) },
  ]}
/>
```

The file row uses the same code with `type: 'file'`, `path: f.path`, and `label={\`Actions for ${node.name}\`}`.

- [ ] **Step 4: Replace the MessageBubble menu**

In `MessageBubble.tsx`, delete `menuOpen`/`setMenuOpen`, `menuRef`, and the outside-click effect (lines ~101–114). Replace the `<div className="relative shrink-0" ref={menuRef}> … </div>` block (lines ~239–312) with:

```tsx
<ActionMenu
  label="Message actions"
  size="sm"
  align={mine ? 'end' : 'start'}
  items={[
    canEdit && {
      label: 'Edit',
      icon: 'edit',
      onSelect: () => {
        setDraft(message.body)
        setEditing(true)
      },
    },
    { label: message.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onSelect: () => onTogglePin(message) },
    { label: 'Delete for me', icon: 'eyeOff', separated: true, onSelect: () => onDeleteForMe(message.id) },
    canDeleteForEveryone && {
      label: 'Delete for everyone',
      icon: 'trash',
      tone: 'danger',
      separated: true,
      onSelect: () => onDeleteForEveryone(message.id),
    },
  ]}
/>
```

Import `ActionMenu` from `'../ui/ActionMenu'`. Remove any React imports that are now unused.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Browser check**

`preview_start` with name `dev`. Sign in and open a General project → Files → My draft, with every folder collapsed. Click a row's 3-dot button. The panel must render fully below the row. Check with `read_page` that `role=menu` exists, and take a screenshot. Repeat in dark mode and on Messages (own and other people's messages). Confirm Escape closes the menu and focus returns to the trigger.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ActionMenu.tsx src/styles/index.css src/components/general/DraftPanel.tsx src/components/messages/MessageBubble.tsx
git commit -m "$(cat <<'EOF'
Put every 3-dot menu on one unclippable, higher-contrast menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Archive page actions into menus

**Files:**
- Modify: `src/pages/general/ProjectArchive.tsx` (task rows, task-file rows, `SectionActions`, `DraftArchiveNode`)

**Interfaces:**
- Consumes: `ActionMenu` from Task 2.

- [ ] **Step 1: Task rows**

Import `ActionMenu` from `'../../components/ui/ActionMenu'`. In the archived-task `<li>`, replace the `{canActInArchive && (<div className="flex gap-2">…</div>)}` block with:

```tsx
{canActInArchive && (
  <ActionMenu
    label={`Actions for ${task.title}`}
    disabled={busy === task.id}
    items={[
      { label: 'Restore', icon: 'refresh', onSelect: () => void run(task.id, () => archiveTask(task.id, false), 'Task restored', 'Could not restore that task.') },
      {
        label: 'Delete permanently',
        icon: 'trash',
        tone: 'danger',
        separated: true,
        onSelect: () =>
          setConfirm({ title: 'Delete this task?', body: 'This permanently deletes this archived task.', label: 'Delete', action: () => deleteArchivedTask(task.id) }),
      },
    ]}
  />
)}
```

- [ ] **Step 2: Task-file rows**

Do the same for task-file rows. Use label `Actions for ${file.file_name}`, restore `archiveTaskFile(file.id, false)` with toast `'File restored'` / `'Could not restore that file.'`, and delete confirm `{ title: 'Delete this task file?', body: 'This permanently deletes this archived task file.', label: 'Delete', action: () => deleteArchivedTaskFile(file) }`.

- [ ] **Step 3: Section actions**

Replace the body of `SectionActions` so the section header shows one menu instead of two buttons:

```tsx
function SectionActions({ label, onRestore, onDelete }: { label: string; onRestore: () => void; onDelete: () => void }) {
  return (
    <ActionMenu
      label={label}
      items={[
        { label: 'Restore all', icon: 'refresh', onSelect: onRestore },
        { label: 'Delete all permanently', icon: 'trash', tone: 'danger', separated: true, onSelect: onDelete },
      ]}
    />
  )
}
```

Pass `label="Actions for all archived tasks"`, `"Actions for all archived task files"`, and `"Actions for all archived draft files"` at the three call sites. Drop the `Button` import if nothing else uses it.

- [ ] **Step 4: `DraftArchiveNode`**

Replace its `{canEdit && (<div className="flex gap-2">…</div>)}` with:

```tsx
{canEdit && (
  <ActionMenu
    label={`Actions for ${node.name}`}
    disabled={busy === `draft:${node.path}:restore`}
    items={[
      { label: 'Restore', icon: 'refresh', onSelect: () => void restore(node.path) },
      { label: 'Delete permanently', icon: 'trash', tone: 'danger', separated: true, onSelect: () => remove(node.path) },
    ]}
  />
)}
```

- [ ] **Step 5: Typecheck and browser check**

Run: `npm run typecheck`. Expected: exit 0.
Open `/general/projects/<id>/archive` and archive one task first if the page is empty. Each row shows one 3-dot button. Restore works. Delete opens the confirmation. Take a screenshot in both themes.

- [ ] **Step 6: Commit**

```bash
git add src/pages/general/ProjectArchive.tsx
git commit -m "$(cat <<'EOF'
Move archive restore and delete into row menus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: For review — three sections and a confirmed withdraw

**Files:**
- Create: `src/lib/general/review.ts`, `src/lib/general/review.test.ts`
- Modify: `src/components/general/FilesTab.tsx` (`ChangesView`)
- Modify: `src/components/general/RepoChangeRow.tsx` (header row; remove the old Withdraw button at ~244–258)

**Interfaces:**
- Produces:
  ```ts
  export function groupChanges<T extends { author_id: string | null; reviewer_id: string | null; status: string }>(
    changes: T[], viewerId: string | null,
  ): { mine: T[]; toMe: T[]; others: T[] }
  ```
  Rules: `mine` is authored by the viewer. `toMe` has the viewer as reviewer and isn't also `mine`. `others` is everything else with `status === 'open'`.

- [ ] **Step 1: Write the failing test**

`src/lib/general/review.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupChanges } from './review'

const c = (id: string, author: string | null, reviewer: string | null, status = 'open') => ({
  id, author_id: author, reviewer_id: reviewer, status,
})

describe('groupChanges', () => {
  const all = [
    c('a', 'me', 'x'),
    c('b', 'x', 'me'),
    c('c', 'x', 'y'),
    c('d', 'x', 'y', 'applied'),
    c('e', 'me', 'me'),
    c('f', 'me', 'x', 'declined'),
  ]

  it('puts what I opened under mine, whatever its status', () => {
    expect(groupChanges(all, 'me').mine.map((x) => x.id)).toEqual(['a', 'e', 'f'])
  })

  it('puts what I was asked to review under to me, but never twice', () => {
    expect(groupChanges(all, 'me').toMe.map((x) => x.id)).toEqual(['b'])
  })

  it('keeps only open requests between other people', () => {
    expect(groupChanges(all, 'me').others.map((x) => x.id)).toEqual(['c'])
  })

  it('treats a signed-out viewer as involved in nothing', () => {
    const g = groupChanges(all, null)
    expect(g.mine).toEqual([])
    expect(g.toMe).toEqual([])
    expect(g.others.map((x) => x.id)).toEqual(['a', 'b', 'c', 'e'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/general/review.test.ts`
Expected: FAIL, `Failed to resolve import "./review"`.

- [ ] **Step 3: Implement `src/lib/general/review.ts`**

```ts
export function groupChanges<T extends { author_id: string | null; reviewer_id: string | null; status: string }>(
  changes: T[],
  viewerId: string | null,
) {
  const mine: T[] = []
  const toMe: T[] = []
  const others: T[] = []
  for (const change of changes) {
    if (viewerId && change.author_id === viewerId) mine.push(change)
    else if (viewerId && change.reviewer_id === viewerId) toMe.push(change)
    else if (change.status === 'open') others.push(change)
  }
  return { mine, toMe, others }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/general/review.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Sectioned `ChangesView`**

In `FilesTab.tsx`, import `groupChanges` from `'../../lib/general/review'`. Replace the `return (<ul …>…</ul>)` at the end of `ChangesView` with:

```tsx
const { mine, toMe, others } = groupChanges(changes, state.viewerId)
return (
  <div className="space-y-6">
    <ChangeSection title="Submitted by me" changes={mine} repo={repo} state={state} onDone={onDone} />
    <ChangeSection title="Submitted to me" changes={toMe} repo={repo} state={state} onDone={onDone} />
    <ChangeSection title="Other open requests" changes={others} repo={repo} state={state} onDone={onDone} collapsed />
  </div>
)
```

Add below `ChangesView`:

```tsx
function ChangeSection({
  title,
  changes,
  repo,
  state,
  onDone,
  collapsed = false,
}: {
  title: string
  changes: GeneralRepoChange[]
  repo: GeneralRepoSummary
  state: GeneralProjectState
  onDone: () => Promise<void>
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  if (changes.length === 0) return null
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mb-2 flex items-center gap-2 text-left"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
        <h3 className="text-[14px]">{title}</h3>
        <span className="rounded-full surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">{changes.length}</span>
      </button>
      {open && (
        <ul className="space-y-3">
          {changes.map((c) => (
            <RepoChangeRow key={c.id} change={c} repo={repo} state={state} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Withdraw through a menu, with confirmation**

In `RepoChangeRow.tsx`, import `ActionMenu` from `'../ui/ActionMenu'` and `ConfirmDialog` from `'../ui/ConfirmDialog'`. Add state `const [withdrawing, setWithdrawing] = useState(false)`. In the header row, after the status `<span>`, add:

```tsx
{mine && change.status === 'open' && !state.archived && (
  <ActionMenu
    label={`Actions for ${change.title}`}
    disabled={busy}
    items={[{ label: 'Withdraw request', icon: 'x', tone: 'danger', onSelect: () => setWithdrawing(true) }]}
  />
)}
```

Delete the old `{mine && change.status === 'open' && (<Button …>Withdraw</Button>)}` block. Just before the closing `</li>`, add:

```tsx
<ConfirmDialog
  open={withdrawing}
  onClose={() => setWithdrawing(false)}
  onConfirm={async () => {
    await withdrawRepoChange(change.id)
    show('Request withdrawn')
    await onDone()
  }}
  title="Withdraw this request?"
  body="The reviewer will no longer see it. Your draft keeps the files."
  confirmLabel="Withdraw request"
  tone="danger"
/>
```

- [ ] **Step 7: Typecheck, tests, browser**

Run: `npm run typecheck && npx vitest run src/lib/general`
Expected: exit 0, all pass.
In the browser, submit a draft file for review, then open For review. The request appears under "Submitted by me". Use the 3-dot menu → Withdraw request → confirm. The status changes to Withdrawn. Take a screenshot.

- [ ] **Step 8: Commit**

```bash
git add src/lib/general/review.ts src/lib/general/review.test.ts src/components/general/FilesTab.tsx src/components/general/RepoChangeRow.tsx
git commit -m "$(cat <<'EOF'
Split For review by who it involves and confirm a withdraw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Task archive at the top of the task dialog

**Files:**
- Modify: `src/components/general/TaskDialog.tsx` (TaskBody return, the `{canDelete && …Archive task…}` block at ~331–336)

- [ ] **Step 1: Move the button**

Delete the `{canDelete && (<Button …>Archive task</Button>)}` block at the end of the right column. As the first child of the grid `<div className="grid gap-6 lg:grid-cols-[…]">`, add:

```tsx
{canDelete && (
  <div className="flex justify-end lg:col-span-2">
    <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
      <Icon name="archive" size={14} />
      Archive task
    </Button>
  </div>
)}
```

- [ ] **Step 2: Typecheck and browser**

Run: `npm run typecheck`. Expected: exit 0.
Open a task you created and nobody has taken. "Archive task" shows at the top right. Archive it, then confirm it appears under Archived tasks on the project archive page.

- [ ] **Step 3: Commit**

```bash
git add src/components/general/TaskDialog.tsx
git commit -m "$(cat <<'EOF'
Put Archive task where it can be found

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Archive visibility in the database

**Files:**
- Create: `supabase/general-archive-rbac.sql`
- Create: `supabase/tests/general-archive-rbac.test.sql`
- Modify: `scripts/schema-drift.mjs:26-32` (ORDER), `docs/07-backup.md:26` (restore command)

**Interfaces:**
- Produces (SQL):
  - `general_leads(p_project uuid) returns boolean`: the caller is an Owner or Manager.
  - `general_sees_archived(p_project uuid, p_archived_by uuid) returns boolean`
  - `list_archived_general_draft_files(p_repo uuid)` now returns every `general_draft_files` column **plus `owner_id uuid`**.
  - `delete_archived_general_draft_path(p_repo uuid, p_path text, p_owner uuid default null)`

- [ ] **Step 1: Write the failing test**

`supabase/tests/general-archive-rbac.test.sql`:

```sql
-- Archive visibility: your own archive, plus Owners and Managers see all. Rolls back.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id   uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  alice      uuid := gen_random_uuid();
  bob        uuid := gen_random_uuid();
  proj       public.general_projects%rowtype;
  repo       public.general_repos%rowtype;
  t_alice    uuid;
  t_bob      uuid;
  n          int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Arc', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'arc-owner@test.local', 'Owner'),
                 (manager_id, 'arc-manager@test.local', 'Manager'),
                 (alice, 'arc-alice@test.local', 'Alice'),
                 (bob, 'arc-bob@test.local', 'Bob')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Archive project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A'),
    jsonb_build_object('path', 'b.md', 'action', 'added', 'kind', 'text', 'content', 'B')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, manager_id, 'manager'), (proj.id, alice, 'member'), (proj.id, bob, 'member');
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Alice task', alice) returning id into t_alice;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Bob task', bob) returning id into t_bob;

  perform pg_temp.act_as(alice);
  perform public.archive_general_task(t_alice, true);
  perform public.save_general_draft_file(repo.id, 'notes/alice.md', 'added', 'text', 'x');
  perform public.archive_general_draft_path(repo.id, 'notes', true);

  perform pg_temp.act_as(bob);
  perform public.archive_general_task(t_bob, true);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(alice);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('a member sees only the task they archived', n = 1);
  select count(*) into n from public.general_task_overview where id = t_bob;
  perform pg_temp.ok('a member cannot read another member''s archived task by id', n = 0);

  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('an Owner sees every archived task', n = 2);

  perform pg_temp.act_as(manager_id);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('a Manager sees every archived task', n = 2);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a Manager sees a member''s archived draft files', n = 1);
  perform pg_temp.ok('...knowing whose draft they came from',
    (select owner_id from public.list_archived_general_draft_files(repo.id) limit 1) = alice);

  perform pg_temp.act_as(bob);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a member does not see another member''s archived draft files', n = 0);

  ------------------------------------------------------------------ removed paths
  perform pg_temp.act_as(owner_id);
  perform public.commit_general_files(repo.id, 'Drop b', 1, jsonb_build_array(
    jsonb_build_object('path', 'b.md', 'action', 'removed', 'kind', 'text', 'content', '')));
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('whoever removed a path sees it', n = 1);
  perform pg_temp.act_as(alice);
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('a member does not see paths somebody else removed', n = 0);

  ------------------------------------------------------------------ writing
  perform pg_temp.act_as(alice);
  perform public.restore_archived_general_tasks(proj.id);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('bulk restore brings back your own',
    (select archived_at is null from public.general_tasks where id = t_alice));
  perform pg_temp.ok('...and leaves somebody else''s archived',
    (select archived_at is not null from public.general_tasks where id = t_bob));

  perform pg_temp.act_as(alice);
  perform public.delete_archived_general_tasks(proj.id);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('bulk delete leaves somebody else''s archived task alone',
    exists (select 1 from public.general_tasks where id = t_bob));

  perform pg_temp.act_as(alice);
  begin
    perform public.delete_archived_general_task(t_bob);
    perform pg_temp.ok('a member cannot delete another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot delete another member''s archived task', true);
  end;

  begin
    perform public.archive_general_task(t_bob, false);
    perform pg_temp.ok('a member cannot restore another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot restore another member''s archived task', true);
  end;

  perform pg_temp.act_as(bob);
  begin
    perform public.delete_archived_general_draft_path(repo.id, 'notes', alice);
    perform pg_temp.ok('a member cannot delete another member''s archived draft item', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot delete another member''s archived draft item', true);
  end;

  perform pg_temp.act_as(manager_id);
  perform public.delete_archived_general_draft_path(repo.id, 'notes', alice);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a Manager can clear a member''s archived draft item', n = 0);

  perform public.delete_archived_general_task(t_bob);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('a Manager can delete anybody''s archived task',
    not exists (select 1 from public.general_tasks where id = t_bob));
end $$;

rollback;
```

- [ ] **Step 2: Run it against the current schema and watch it fail**

Run: `node scripts/db.mjs supabase/tests/general-archive-rbac.test.sql`
Expected: at least `FAIL  a member sees only the task they archived`. The call to `delete_archived_general_draft_path(…, alice)` errors with "function … does not exist". That's the missing third argument, and it counts as a failure.

- [ ] **Step 3: Write `supabase/general-archive-rbac.sql`**

```sql
-- Collabify — archive visibility for General projects.
--
--   node scripts/db.mjs supabase/general-archive-rbac.sql
--
-- An archived item is visible to whoever archived it, and to the project's
-- Owners and Managers. Redefines the archive functions from
-- general-project-archive.sql and general-drafts.sql; run after both.

begin;

create or replace function public.general_leads(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project) and exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = auth.uid()
       and m.level in ('owner', 'manager')
  );
$$;

create or replace function public.general_sees_archived(p_project uuid, p_archived_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_archived_by = auth.uid() and public.is_general_member(p_project))
      or public.general_leads(p_project);
$$;

create or replace view public.general_task_overview
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
       (select count(*) from public.general_task_files f where f.task_id = t.id and f.archived_at is null)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at,
       t.archived_at,
       t.archived_by
  from public.general_tasks t
 where t.archived_at is null
    or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

create or replace function public.archive_general_task(p_task uuid, p_archived boolean)
returns public.general_tasks
language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(t.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and t.archived_at is not null
     and not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or (t.created_by = auth.uid() and not public.general_task_held(t.id))
    or (not p_archived and t.archived_by = auth.uid())
  ) then
    raise exception 'Only its creator, before anyone takes it, or someone who manages tasks can archive this.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  return t;
end;
$$;

create or replace function public.archive_general_task_file(p_file uuid, p_archived boolean)
returns public.general_task_files
language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file for update;
  if not found then
    raise exception 'File not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(f.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and f.archived_at is not null
     and not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()
          or (not p_archived and f.archived_by = auth.uid())) then
    raise exception 'Only whoever added this file, or somebody who can edit files, can archive it.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.general_task_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_file
   returning * into f;
  return f;
end;
$$;

create or replace function public.general_archive_guard(p_project uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.restore_archived_general_tasks(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  update public.general_tasks
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.delete_archived_general_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task and archived_at is not null;
  if not found then return; end if;
  perform public.general_archive_guard(t.project_id);
  if not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_tasks where id = p_task and archived_at is not null;
end;
$$;

create or replace function public.delete_archived_general_tasks(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  delete from public.general_tasks
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.restore_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  update public.general_task_files
     set archived_at = null, archived_by = null
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.delete_archived_general_task_file(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file and archived_at is not null;
  if not found then return; end if;
  perform public.general_archive_guard(f.project_id);
  if not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_task_files where id = p_file and archived_at is not null;
end;
$$;

create or replace function public.delete_archived_general_task_files(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.general_archive_guard(p_project);
  delete from public.general_task_files
   where project_id = p_project and archived_at is not null
     and public.general_sees_archived(project_id, archived_by);
end;
$$;

create or replace function public.list_archived_general_task_files(p_project uuid)
returns table (
  id uuid, task_id uuid, project_id uuid, uploaded_by uuid, file_path text, file_name text,
  mime_type text, size_bytes bigint, created_at timestamptz, archived_at timestamptz,
  archived_by uuid, task_title text
)
language sql security definer set search_path = public as $$
  select f.id, f.task_id, f.project_id, f.uploaded_by, f.file_path, f.file_name, f.mime_type,
         f.size_bytes, f.created_at, f.archived_at, f.archived_by, t.title as task_title
    from public.general_task_files f
    join public.general_tasks t on t.id = f.task_id
   where f.project_id = p_project
     and f.archived_at is not null
     and public.general_sees_archived(p_project, f.archived_by)
   order by f.archived_at desc;
$$;

create or replace function public.list_removed_general_repo_paths(p_project uuid)
returns table (
  repo_id uuid, repo_name text, path text, kind public.general_file_kind,
  seq integer, removed_at timestamptz
)
language sql security definer set search_path = public as $$
  select latest.repo_id, r.name as repo_name, latest.path, latest.kind, latest.seq,
         latest.created_at as removed_at
    from (
      select distinct on (b.repo_id, b.path)
             b.repo_id, b.path, b.kind, b.seq, b.created_at, b.action, b.commit_id
        from public.general_blobs b
       where b.project_id = p_project
       order by b.repo_id, b.path, b.seq desc
    ) latest
    join public.general_repos r on r.id = latest.repo_id
    join public.general_commits c on c.id = latest.commit_id
   where latest.action = 'removed'
     and public.general_sees_archived(p_project, c.author_id)
   order by latest.created_at desc;
$$;

drop function if exists public.list_archived_general_draft_files(uuid);
create function public.list_archived_general_draft_files(p_repo uuid)
returns table (
  id uuid, draft_id uuid, project_id uuid, path text, action public.general_file_action,
  kind public.general_file_kind, content text, storage_path text, updated_at timestamptz,
  archived_at timestamptz, archived_by uuid, owner_id uuid
)
language sql security definer set search_path = public as $$
  select f.id, f.draft_id, f.project_id, f.path, f.action, f.kind, f.content, f.storage_path,
         f.updated_at, f.archived_at, f.archived_by, d.user_id
    from public.general_drafts d
    join public.general_draft_files f on f.draft_id = d.id
   where d.repo_id = p_repo
     and f.archived_at is not null
     and (d.user_id = auth.uid() or public.general_leads(d.project_id))
   order by f.archived_at desc, f.path;
$$;

drop function if exists public.delete_archived_general_draft_path(uuid, text);
create or replace function public.delete_archived_general_draft_path(
  p_repo uuid,
  p_path text,
  p_owner uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.general_drafts%rowtype;
  v text := btrim(p_path);
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = coalesce(p_owner, auth.uid());
  if not found then return; end if;
  if d.user_id <> auth.uid() and not public.general_leads(d.project_id) then
    raise exception 'Only its owner, or an Owner or Manager, can delete this.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is not null
     and (path = v or path like v || '/%');
  update public.general_drafts set updated_at = now() where id = d.id;
end;
$$;

revoke all on function public.general_leads(uuid) from public, anon;
revoke all on function public.general_sees_archived(uuid, uuid) from public, anon;
revoke all on function public.general_archive_guard(uuid) from public, anon;
revoke all on function public.list_archived_general_draft_files(uuid) from public, anon;
revoke all on function public.delete_archived_general_draft_path(uuid, text, uuid) from public, anon;
grant execute on function public.general_leads(uuid) to authenticated;
grant execute on function public.general_sees_archived(uuid, uuid) to authenticated;
grant execute on function public.general_archive_guard(uuid) to authenticated;
grant execute on function public.list_archived_general_draft_files(uuid) to authenticated;
grant execute on function public.delete_archived_general_draft_path(uuid, text, uuid) to authenticated;

commit;
```

The functions redefined with an unchanged signature keep their existing grants.

Re-run order matters from now on. Running `general-drafts.sql` alone after this file fails, because `create or replace` can't change `list_archived_general_draft_files`'s return type back. It would also bring back a 2-argument `delete_archived_general_draft_path` next to the 3-argument one. Always run `general-archive-rbac.sql` after `general-drafts.sql`, which the backup command in Step 7 does. Record this in the Task 13 handoff.

- [ ] **Step 4: Apply twice**

Run: `node scripts/db.mjs supabase/general-archive-rbac.sql && node scripts/db.mjs supabase/general-archive-rbac.sql`
Expected: both runs finish without error.

- [ ] **Step 5: Run the test and watch it pass**

Run: `node scripts/db.mjs supabase/tests/general-archive-rbac.test.sql`
Expected: every `NOTICE:` line starts with `PASS`. There must be no `FAIL`.

- [ ] **Step 6: Run the neighbouring suites**

Run: `for f in general general-tasks general-drafts general-files general-repo general-spaces general-space-teams; do node scripts/db.mjs supabase/tests/$f.test.sql; done 2>&1 | grep -c "FAIL"`
Expected: `0`.

- [ ] **Step 7: Register the file**

In `scripts/schema-drift.mjs`, append ` general-project-archive general-archive-rbac` to the `ORDER` template string after `general-spaces`. In `docs/07-backup.md:26`, append ` supabase/general-project-archive.sql supabase/general-archive-rbac.sql` to the end of the `node scripts/db.mjs …` command. Run `node scripts/schema-drift.mjs`. It must not flag `general-archive-rbac` as a smaller later copy.

- [ ] **Step 8: Commit**

```bash
git add supabase/general-archive-rbac.sql supabase/tests/general-archive-rbac.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "$(cat <<'EOF'
Keep each person's archive their own, with Owners and Managers seeing all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Archive page reads owners of draft items

**Files:**
- Modify: `src/lib/general/types.ts` (after `GeneralDraftFile`)
- Modify: `src/lib/api/general.ts:1220-1226` (`listArchivedDraftFiles`), `:1265-1271` (`deleteArchivedDraftPath`)
- Modify: `src/pages/general/ProjectArchive.tsx` (draft section)

**Interfaces:**
- Consumes: `list_archived_general_draft_files` returning `owner_id`; `delete_archived_general_draft_path(p_repo, p_path, p_owner)` from Task 6.
- Produces: `export type ArchivedDraftFile = GeneralDraftFile & { owner_id: string }`; `deleteArchivedDraftPath(repoId: string, path: string, ownerId?: string)`.

- [ ] **Step 1: Type and API**

In `types.ts`, after `GeneralDraftFile`:

```ts
export type ArchivedDraftFile = GeneralDraftFile & { owner_id: string }
```

In `api/general.ts`, change `listArchivedDraftFiles` to `return (data ?? []) as ArchivedDraftFile[]` (import the type). Change `deleteArchivedDraftPath` to:

```ts
export async function deleteArchivedDraftPath(repoId: string, path: string, ownerId?: string) {
  const { error } = await supabase.rpc('delete_archived_general_draft_path', {
    p_repo: repoId,
    p_path: path,
    p_owner: ownerId ?? null,
  })
  if (error) throw error
}
```

- [ ] **Step 2: Group the draft section by owner**

In `ProjectArchive.tsx`, change `draftFiles` state to `ArchivedDraftFile[] | null`. Replace the draft section's list body (`<ul className="divide-y divide-line">{buildTree(archivedDraftFiles …)}</ul>`) with:

```tsx
<div className="divide-y divide-line">
  {[...new Set(archivedDraftFiles.map((f) => f.owner_id))]
    .sort((a, b) => (a === profile?.id ? -1 : b === profile?.id ? 1 : 0))
    .map((ownerId) => {
      const yours = ownerId === profile?.id
      const rows = archivedDraftFiles.filter((f) => f.owner_id === ownerId)
      return (
        <div key={ownerId}>
          {!yours && (
            <p className="bg-[var(--surface-sunken)] px-4 py-2 text-[12px] font-medium text-muted sm:px-5">
              From {state.nameOf(ownerId)}'s draft
            </p>
          )}
          <ul className="divide-y divide-line">
            {buildTree(rows as unknown as Parameters<typeof buildTree>[0]).map((node) => (
              <DraftArchiveNode
                key={node.path}
                node={node}
                depth={0}
                canEdit={canActInArchive && Boolean(repoId)}
                canRestore={yours}
                busy={busy}
                restore={(path) =>
                  repoId
                    ? run(`draft:${path}:restore`, () => archiveDraftPath(repoId, path, false), 'Draft restored', 'Could not restore it.')
                    : Promise.resolve()
                }
                remove={(path) =>
                  setConfirm({
                    title: 'Delete this archived draft item?',
                    body: 'This permanently deletes this archived draft file or folder.',
                    label: 'Delete',
                    action: () => (repoId ? deleteArchivedDraftPath(repoId, path, yours ? undefined : ownerId) : Promise.resolve()),
                  })
                }
              />
            ))}
          </ul>
        </div>
      )
    })}
</div>
```

Add `canRestore: boolean` to `DraftArchiveNode`'s props and pass it down through the recursion. In its `ActionMenu` items, change the Restore entry to `canRestore && { label: 'Restore', icon: 'refresh', onSelect: () => void restore(node.path) }`.

- [ ] **Step 3: Typecheck and browser (two accounts)**

Run: `npm run typecheck`. Expected: exit 0.
Use two accounts on one project: member A archives a task and a draft file. Member B's archive page does not show them. The Owner's archive page shows them, including a "From <A>'s draft" group with only Delete in its menu. Take screenshots.

- [ ] **Step 4: Commit**

```bash
git add src/lib/general/types.ts src/lib/api/general.ts src/pages/general/ProjectArchive.tsx
git commit -m "$(cat <<'EOF'
Show Owners and Managers whose draft an archived item came from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Folder logic — `.keep`, names, levels, crumbs, search

**Files:**
- Modify: `src/lib/general/files.ts` (tree section)
- Create: `src/lib/general/search.ts`, `src/lib/general/search.test.ts`
- Test: `src/lib/general/files.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export const KEEP = '.keep'
  export function isKeep(path: string): boolean
  export function joinPath(folder: string, name: string): string
  export function folderNameProblem(name: string, siblings: string[]): string | null
  export function nodesAt(nodes: TreeNode[], path: string): TreeNode[] | null
  export function crumbs(path: string): { name: string; path: string }[]
  export function flatFiles(nodes: TreeNode[]): Extract<TreeNode, { type: 'file' }>[]
  // search.ts
  export function matches(query: string, ...fields: (string | null | undefined)[]): boolean
  ```
  `buildTree` keeps a folder whose only file is `.keep`, but lists no `.keep` leaf and counts none.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/general/files.test.ts`, and add `crumbs, flatFiles, folderNameProblem, isKeep, joinPath, nodesAt` to its import list:

```ts
describe('site-made folders', () => {
  const tree = buildTree([file('Chapter 1/.keep'), file('Chapter 2/intro.md'), file('Chapter 2/Figures/.keep'), file('readme.md')])

  it('shows a folder that holds only .keep, empty', () => {
    const ch1 = tree.find((n) => n.name === 'Chapter 1')
    expect(ch1?.type).toBe('folder')
    expect(ch1?.type === 'folder' && ch1.children).toEqual([])
    expect(ch1?.type === 'folder' && ch1.fileCount).toBe(0)
  })

  it('never lists or counts .keep', () => {
    expect(flatFiles(tree).map((f) => f.path)).toEqual(['Chapter 2/intro.md', 'readme.md'])
    expect(isKeep('a/b/.keep')).toBe(true)
    expect(isKeep('a/keep.md')).toBe(false)
  })

  it('finds the children of a folder by path', () => {
    expect(nodesAt(tree, '')).toBe(tree)
    expect(nodesAt(tree, 'Chapter 2')?.map((n) => n.name)).toEqual(['Figures', 'intro.md'])
    expect(nodesAt(tree, 'Chapter 2/Figures')).toEqual([])
    expect(nodesAt(tree, 'Nope')).toBeNull()
    expect(nodesAt(tree, 'readme.md')).toBeNull()
  })

  it('builds breadcrumbs from a path', () => {
    expect(crumbs('')).toEqual([])
    expect(crumbs('a/b')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ])
  })

  it('joins a folder and a name', () => {
    expect(joinPath('', 'x')).toBe('x')
    expect(joinPath('a/b', 'x')).toBe('a/b/x')
  })

  it('checks a folder name against its neighbours', () => {
    expect(folderNameProblem('  ', [])).toBe('Give the folder a name.')
    expect(folderNameProblem('a'.repeat(121), [])).toBe('A folder name can be up to 120 characters.')
    expect(folderNameProblem('a/b', [])).toBe('A folder name cannot have a slash in it.')
    expect(folderNameProblem('..', [])).toBe('Pick a name other than "." or "..".')
    expect(folderNameProblem('figures', ['Figures'])).toBe('A folder called figures is already here. Pick another name.')
    expect(folderNameProblem('Tables', ['Figures'])).toBeNull()
  })
})
```

Create `src/lib/general/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matches } from './search'

describe('matches', () => {
  it('matches everything when the query is blank', () => {
    expect(matches('   ', 'anything')).toBe(true)
  })
  it('ignores case and surrounding space', () => {
    expect(matches('  CHAPTER ', 'docs/Chapter 1.md')).toBe(true)
  })
  it('matches any one of several fields and skips empty ones', () => {
    expect(matches('ana', null, undefined, 'Title', 'Ana Cruz')).toBe(true)
    expect(matches('zed', 'Title', null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/general/files.test.ts src/lib/general/search.test.ts`
Expected: FAIL. The imports `nodesAt`, `crumbs`, … and `./search` don't exist yet.

- [ ] **Step 3: Implement**

`src/lib/general/search.ts`:

```ts
export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => field?.toLowerCase().includes(q))
}
```

In `files.ts`, directly above `export type TreeNode`:

```ts
/** An empty folder made in the site holds one hidden file with this name. */
export const KEEP = '.keep'

export function isKeep(path: string) {
  return fileName(path) === KEEP
}

export function joinPath(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name
}
```

In `buildTree`'s `build`, change the `leaves` source from `folder.files.slice()` to `folder.files.filter((f) => !isKeep(f.path))`.

Below `countFiles`:

```ts
export function folderNameProblem(name: string, siblings: string[]): string | null {
  const n = name.trim()
  if (!n) return 'Give the folder a name.'
  if (n.length > 120) return 'A folder name can be up to 120 characters.'
  if (n.includes('/') || n.includes('\\')) return 'A folder name cannot have a slash in it.'
  if (n === '.' || n === '..') return 'Pick a name other than "." or "..".'
  if (siblings.some((s) => s.toLowerCase() === n.toLowerCase())) {
    return `A folder called ${n} is already here. Pick another name.`
  }
  return null
}

export function nodesAt(nodes: TreeNode[], path: string): TreeNode[] | null {
  if (!path) return nodes
  let here = nodes
  for (const part of path.split('/')) {
    const next = here.find((n) => n.type === 'folder' && n.name === part)
    if (!next || next.type !== 'folder') return null
    here = next.children
  }
  return here
}

export function crumbs(path: string) {
  if (!path) return []
  const parts = path.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
}

export function flatFiles(nodes: TreeNode[]): Extract<TreeNode, { type: 'file' }>[] {
  return nodes.flatMap((n) => (n.type === 'file' ? [n] : flatFiles(n.children)))
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/lib/general`
Expected: all pass, including the existing `buildTree` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/files.ts src/lib/general/files.test.ts src/lib/general/search.ts src/lib/general/search.test.ts
git commit -m "$(cat <<'EOF'
Teach the file tree about site-made folders, levels and search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `rename_general_draft_folder`

**Files:**
- Create: `supabase/general-folders.sql`
- Create: `supabase/tests/general-folders.test.sql`
- Modify: `src/lib/api/general.ts` (after `deleteArchivedDraftPath`)
- Modify: `scripts/schema-drift.mjs` ORDER, `docs/07-backup.md:26`

**Interfaces:**
- Produces:
  - SQL `rename_general_draft_folder(p_repo uuid, p_from text, p_to text) returns int` (number of files moved).
  - TS `renameDraftFolder(repoId: string, from: string, to: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

`supabase/tests/general-folders.test.sql`:

```sql
-- Renaming folders through a draft. Rolls back.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  member   uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  draft    public.general_drafts%rowtype;
  n        int;
  act      text;
  txt      text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Fold', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'fold-owner@test.local', 'Owner'),
                 (member, 'fold-member@test.local', 'Member'),
                 (outsider, 'fold-out@test.local', 'Out')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Folder project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'docs/one.md', 'action', 'added', 'kind', 'text', 'content', 'One'),
    jsonb_build_object('path', 'docs/two.md', 'action', 'added', 'kind', 'text', 'content', 'Two'),
    jsonb_build_object('path', 'keep/x.md', 'action', 'added', 'kind', 'text', 'content', 'X')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level) values (proj.id, member, 'member');

  ------------------------------------------------------------------ draft-only folder
  perform pg_temp.act_as(member);
  draft := public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'New folder/.keep', 'added', 'text', '');
  perform public.save_general_draft_file(repo.id, 'New folder/notes.md', 'added', 'text', 'N');

  n := public.rename_general_draft_folder(repo.id, 'New folder', 'Chapter 3');
  perform pg_temp.ok('renaming a draft-only folder moves each file', n = 2);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path like 'New folder/%';
  perform pg_temp.ok('...and leaves nothing under the old name', n = 0);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path in ('Chapter 3/.keep', 'Chapter 3/notes.md') and action = 'added';
  perform pg_temp.ok('...under the new name, still as additions', n = 2);

  ------------------------------------------------------------------ Main folder
  perform public.save_general_draft_file(repo.id, 'docs/two.md', 'changed', 'text', 'Two, edited');
  n := public.rename_general_draft_folder(repo.id, 'docs', 'papers');
  perform pg_temp.ok('renaming a Main folder touches each of its files', n = 2);

  select action into act from public.general_draft_files where draft_id = draft.id and path = 'docs/one.md';
  perform pg_temp.ok('the old path is removed in the draft', act = 'removed');
  select action into act from public.general_draft_files where draft_id = draft.id and path = 'papers/one.md';
  perform pg_temp.ok('the new path is added in the draft', act = 'added');
  select content into txt from public.general_draft_files where draft_id = draft.id and path = 'papers/two.md';
  perform pg_temp.ok('a file already edited in the draft carries the edit', txt = 'Two, edited');
  select count(*) into n from public.general_repo_tree where repo_id = repo.id and path like 'docs/%';
  perform pg_temp.ok('Main is untouched until review', n = 2);

  ------------------------------------------------------------------ refusals
  begin
    perform public.rename_general_draft_folder(repo.id, 'papers', 'keep');
    perform pg_temp.ok('a name already in Main is refused', false);
  exception when unique_violation then
    perform pg_temp.ok('a name already in Main is refused', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', 'Chapter 3/inner');
    perform pg_temp.ok('a folder cannot move inside itself', false);
  exception when check_violation then
    perform pg_temp.ok('a folder cannot move inside itself', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', '../escape');
    perform pg_temp.ok('a name that climbs out is refused', false);
  exception when check_violation then
    perform pg_temp.ok('a name that climbs out is refused', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Nowhere', 'Somewhere');
    perform pg_temp.ok('a folder that is not there is refused', false);
  exception when no_data_found then
    perform pg_temp.ok('a folder that is not there is refused', true);
  end;

  perform pg_temp.act_as(outsider);
  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', 'Stolen');
    perform pg_temp.ok('somebody not on the project cannot rename', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('somebody not on the project cannot rename', true);
  end;

  perform pg_temp.act_as(owner_id);
  n := coalesce((select count(*) from public.general_draft_files f
                   join public.general_drafts d on d.id = f.draft_id
                  where d.user_id = owner_id and f.path like 'Chapter 3/%'), 0);
  perform pg_temp.ok('renaming only ever touches your own draft', n = 0);
end $$;

rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/db.mjs supabase/tests/general-folders.test.sql`
Expected: error `function public.rename_general_draft_folder(uuid, unknown, unknown) does not exist`.

- [ ] **Step 3: Write `supabase/general-folders.sql`**

```sql
-- Collabify — renaming folders in a General draft.
--
--   node scripts/db.mjs supabase/general-folders.sql
--
-- A folder is a path prefix, and an empty one made in the site holds a hidden
-- `.keep`. Renaming rewrites paths in the caller's draft only; a folder that
-- already exists in Main becomes remove-old + add-new pairs, so Main still
-- changes only through review.

begin;

create or replace function public.rename_general_draft_folder(
  p_repo uuid,
  p_from text,
  p_to   text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  d      public.general_drafts%rowtype;
  v_from text := btrim(p_from, ' /');
  v_to   text := btrim(p_to, ' /');
  v_name text;
  v_new  text;
  rec    record;
  n      int := 0;
begin
  if v_from = '' or v_to = '' then
    raise exception 'Give the folder a name.' using errcode = 'check_violation';
  end if;
  if v_to = v_from then
    return 0;
  end if;
  if v_to like v_from || '/%' then
    raise exception 'A folder cannot move inside itself.' using errcode = 'check_violation';
  end if;
  v_name := regexp_replace(v_to, '^.*/', '');
  if char_length(v_name) > 120 then
    raise exception 'A folder name can be up to 120 characters.' using errcode = 'check_violation';
  end if;
  if v_to ~ '(^|/)\.\.?(/|$)' or v_to ~ '\\' or v_to ~ '//' then
    raise exception 'That folder name is not allowed. Use letters, numbers and spaces.'
      using errcode = 'check_violation';
  end if;

  d := public.my_general_draft(p_repo);
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.general_repo_tree t
              where t.repo_id = p_repo and (t.path = v_to or t.path like v_to || '/%'))
     or exists (select 1 from public.general_draft_files f
                 where f.draft_id = d.id and (f.path = v_to or f.path like v_to || '/%')) then
    raise exception 'A folder called % is already here. Pick another name.', v_name
      using errcode = 'unique_violation';
  end if;

  for rec in
    select p.path,
           t.kind as main_kind, t.content as main_content, t.storage_path as main_storage,
           f.action as draft_action, f.kind as draft_kind, f.content as draft_content,
           f.storage_path as draft_storage
      from (
        select t.path from public.general_repo_tree t
         where t.repo_id = p_repo and t.path like v_from || '/%'
        union
        select f.path from public.general_draft_files f
         where f.draft_id = d.id and f.archived_at is null and f.path like v_from || '/%'
      ) p
      left join public.general_repo_tree t on t.repo_id = p_repo and t.path = p.path
      left join public.general_draft_files f
             on f.draft_id = d.id and f.path = p.path and f.archived_at is null
  loop
    if rec.draft_action = 'removed' then
      continue;
    end if;
    v_new := v_to || substr(rec.path, char_length(v_from) + 1);

    insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
    values (
      d.id, d.project_id, v_new, 'added',
      coalesce(rec.draft_kind, rec.main_kind),
      case when rec.draft_action is not null then rec.draft_content else rec.main_content end,
      case when rec.draft_action is not null then rec.draft_storage else rec.main_storage end
    );

    if rec.main_kind is not null then
      insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
      values (d.id, d.project_id, rec.path, 'removed', rec.main_kind, '', rec.main_storage)
      on conflict (draft_id, path) do update
        set action = 'removed', kind = excluded.kind, content = '',
            storage_path = excluded.storage_path, archived_at = null, archived_by = null,
            updated_at = now();
    else
      delete from public.general_draft_files where draft_id = d.id and path = rec.path;
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'That folder is not here anymore. Reload the page and try again.'
      using errcode = 'no_data_found';
  end if;

  update public.general_drafts set updated_at = now() where id = d.id;
  return n;
end;
$$;

revoke all on function public.rename_general_draft_folder(uuid, text, text) from public, anon;
grant execute on function public.rename_general_draft_folder(uuid, text, text) to authenticated;

commit;
```

`my_general_draft` already raises `insufficient_privilege` for someone not on the project.

- [ ] **Step 4: Apply twice, then run the test**

Run: `node scripts/db.mjs supabase/general-folders.sql && node scripts/db.mjs supabase/general-folders.sql && node scripts/db.mjs supabase/tests/general-folders.test.sql`
Expected: every `NOTICE:` line starts with `PASS`.

- [ ] **Step 5: Check binary files survive a rename**

A renamed binary file's new draft row reuses Main's `storage_path`. Confirm the client never deletes storage objects when an archived draft path is deleted:

Run: `grep -n "storage\|remove(" src/lib/api/general.ts | sed -n '/deleteArchivedDraft/,+12p'`
Expected: `deleteArchivedDraftPath` and `deleteArchivedDraftFiles` call only `supabase.rpc(...)`, with no `storage.from(...).remove`. If either one removes storage objects, stop and raise it with the user before continuing. Deleting the object would break Main's copy.

- [ ] **Step 6: API function**

Add to `src/lib/api/general.ts` after `deleteArchivedDraftPath`:

```ts
export async function renameDraftFolder(repoId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc('rename_general_draft_folder', {
    p_repo: repoId,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return data as number
}
```

- [ ] **Step 7: Register the file**

Append ` general-folders` to `ORDER` in `scripts/schema-drift.mjs`, and ` supabase/general-folders.sql` to the restore command in `docs/07-backup.md:26`. Run `node scripts/schema-drift.mjs && npm run typecheck`. Expected: no new suspect, and exit 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/general-folders.sql supabase/tests/general-folders.test.sql src/lib/api/general.ts scripts/schema-drift.mjs docs/07-backup.md
git commit -m "$(cat <<'EOF'
Rename folders through a draft, so Main still changes only by review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Folder pages, breadcrumbs and rename in the UI

**Files:**
- Create: `src/components/general/FolderBar.tsx`, `src/components/general/RenameFolderDialog.tsx`
- Modify: `src/components/general/FilesTab.tsx` (URL state, `MainView`, delete recursive `Node`)
- Modify: `src/components/general/DraftPanel.tsx` (current-level rendering, new props)

**Interfaces:**
- Consumes: `nodesAt`, `crumbs`, `joinPath`, `folderNameProblem` (Task 8); `renameDraftFolder` (Task 9); `ActionMenu` (Task 2).
- Produces:
  ```ts
  FolderBar(props: { rootLabel: string; path: string; onNavigate: (path: string) => void; actions?: ReactNode })
  RenameFolderDialog(props: { repoId: string; path: string | null; siblings: string[]; onClose: () => void; onRenamed: (newPath: string) => void })
  DraftPanel gains props: path: string; onNavigate: (path: string) => void
  FilesTab URL params: view=main|draft|changes|history (absent = main), path=<folder> (absent = root)
  ```

- [ ] **Step 1: `FolderBar.tsx`**

```tsx
import type { ReactNode } from 'react'
import { crumbs } from '../../lib/general/files'
import { Icon } from '../ui/Icon'

export function FolderBar({
  rootLabel,
  path,
  onNavigate,
  actions,
}: {
  rootLabel: string
  path: string
  onNavigate: (path: string) => void
  actions?: ReactNode
}) {
  const trail = crumbs(path)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
        <button
          type="button"
          onClick={() => onNavigate('')}
          aria-current={trail.length === 0 ? 'page' : undefined}
          className={trail.length === 0 ? 'font-medium text-ink' : 'text-muted hover:text-ink hover:underline'}
        >
          {rootLabel}
        </button>
        {trail.map((c, i) => (
          <span key={c.path} className="flex min-w-0 items-center gap-1">
            <Icon name="chevronRight" size={13} className="shrink-0 text-faint" />
            {i === trail.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-ink">{c.name}</span>
            ) : (
              <button type="button" onClick={() => onNavigate(c.path)} className="truncate text-muted hover:text-ink hover:underline">
                {c.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 2: `RenameFolderDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { renameDraftFolder } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { fileName, folderNameProblem, folderOf, joinPath } from '../../lib/general/files'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'

export function RenameFolderDialog({
  repoId,
  path,
  siblings,
  onClose,
  onRenamed,
}: {
  repoId: string
  path: string | null
  siblings: string[]
  onClose: () => void
  onRenamed: (newPath: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(path ? fileName(path) : '')
    setError(null)
  }, [path])

  async function save() {
    if (!path || busy) return
    const current = fileName(path)
    const problem = folderNameProblem(name, siblings.filter((s) => s !== current))
    if (problem) return setError(problem)
    if (name.trim() === current) return onClose()
    setBusy(true)
    setError(null)
    try {
      const next = joinPath(folderOf(path), name.trim())
      await renameDraftFolder(repoId, path, next)
      onRenamed(next)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not rename the folder. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={path !== null}
      onClose={onClose}
      title="Rename folder"
      description="The new name goes into your draft. Submit it for review to change Main."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>Rename</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save() }} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Folder name">
          {(id) => <Input id={id} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 3: URL-driven view and path in `FilesTab`**

Add `import { useSearchParams } from 'react-router-dom'`. Replace `const [view, setView] = useState<View>('main')` with:

```tsx
const [params, setParams] = useSearchParams()
const VIEWS: View[] = ['main', 'draft', 'changes', 'history']
const rawView = params.get('view') as View | null
const view: View = rawView && VIEWS.includes(rawView) ? rawView : 'main'
const folder = view === 'main' || view === 'draft' ? params.get('path') ?? '' : ''
const [renaming, setRenaming] = useState<string | null>(null)

function go(nextView: View, nextPath = '') {
  const changed = new URLSearchParams(params)
  if (nextView === 'main') changed.delete('view')
  else changed.set('view', nextView)
  if (nextPath) changed.set('path', nextPath)
  else changed.delete('path')
  setParams(changed)
}
```

Replace `onChange={setView}` on `<Tabs>` with `onChange={(v) => go(v)}`. The `?tab=files` param is untouched because `go` copies `params`.

- [ ] **Step 4: One level at a time in `MainView`**

Change `MainView`'s props to add `path: string`, `onNavigate: (path: string) => void`, and `onRename: (path: string) => void`. Replace its body after the empty check with:

```tsx
const all = buildTree(tree)
const level = nodesAt(all, path)
if (level === null) {
  queueMicrotask(() => onNavigate(''))
  return null
}
return (
  <div className="space-y-2">
    <FolderBar
      rootLabel="Main"
      path={path}
      onNavigate={onNavigate}
      actions={
        path && !state.archived ? (
          <Button size="sm" variant="ghost" onClick={() => onRename(path)}>
            <Icon name="edit" size={14} />
            Rename
          </Button>
        ) : undefined
      }
    />
    <p className="text-[12px] text-muted">Everything the project holds as of commit {repo.commit_count}.</p>
    {level.length === 0 ? (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        This folder is empty.
      </p>
    ) : (
      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
        {level.map((node) => (
          <li key={node.path}>
            {node.type === 'folder' ? (
              <button
                type="button"
                onClick={() => onNavigate(node.path)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
              >
                <Icon name="folder" size={15} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{node.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
                <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
              </button>
            ) : (
              <MainFileRow node={node} draftFiles={draftFiles} onOpen={onOpen} />
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
)
```

Replace the recursive `Node` component with `MainFileRow`, which is the file branch of the old `Node` with the depth padding removed:

```tsx
function MainFileRow({
  node,
  draftFiles,
  onOpen,
}: {
  node: Extract<TreeNode, { type: 'file' }>
  draftFiles: GeneralDraftFile[]
  onOpen: (file: OpenFile) => void
}) {
  const inDraft = draftFiles.some((f) => f.path === node.path)
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({ path: node.path, kind: node.file.kind, content: node.file.content, storagePath: node.file.storage_path, action: 'changed', fromDraft: false })
      }
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
    >
      <Icon name="file" size={15} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.name}</span>
      {inDraft && (
        <span className="shrink-0 rounded-md bg-amber-400/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
          In your draft
        </span>
      )}
      <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">{FILE_KIND_LABEL[node.file.kind]}</span>
    </button>
  )
}
```

Update imports to add `nodesAt` and `FolderBar`, and drop anything now unused.

- [ ] **Step 5: One level at a time in `DraftPanel`**

Add props `path: string` and `onNavigate: (path: string) => void`, plus `onRename: (path: string) => void`. Replace `const nodes = buildTree(...)` with:

```tsx
const all = buildTree(files as unknown as Parameters<typeof buildTree>[0])
const level = nodesAt(all, path)
```

If `level === null`, call `queueMicrotask(() => onNavigate(''))` and return `null` (after the hooks). Above the alerts, render:

```tsx
<FolderBar
  rootLabel="My draft"
  path={path}
  onNavigate={onNavigate}
  actions={
    path ? (
      <>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRename(path)}>
          <Icon name="edit" size={14} />
          Rename
        </Button>
        <ActionMenu
          label={`Actions for ${path}`}
          disabled={busy}
          items={[
            { label: 'Submit for review', icon: 'refresh', disabled: behind, onSelect: () => setSubmitting({ type: 'folder', path }) },
            { label: 'Archive', icon: 'archive', onSelect: () => setArchiving({ type: 'folder', path }) },
          ]}
        />
      </>
    ) : undefined
  }
/>
```

Render `level` instead of `nodes`. If `level.length === 0`, show `<p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">This folder is empty. Use New to add a file or folder.</p>`. In `DraftNode`'s folder branch, replace the expand toggle with a navigation button: `onClick={() => onNavigate(node.path)}`, show `node.name` instead of `node.path`, and add a trailing `chevronRight`. Remove the nested `<ul>` recursion from the folder branch and the `depth` prop, and pass `onNavigate` down. The file branch keeps its diff toggle.

Keep the empty-draft state (when `files.length === 0`) as it is, but only when `path === ''`.

- [ ] **Step 6: Wire `FilesTab`**

Pass `path={folder}`, `onNavigate={(p) => go(view, p)}`, and `onRename={setRenaming}` to `MainView` and `DraftPanel`. After `<NewFileDialog …/>`, render:

```tsx
<RenameFolderDialog
  repoId={repo.id}
  path={renaming}
  siblings={(nodesAt(buildTree([...tree, ...(draftFiles as unknown as GeneralTreeFile[])]), renaming ? folderOf(renaming) : '') ?? []).map((n) => n.name)}
  onClose={() => setRenaming(null)}
  onRenamed={async (next) => {
    await load()
    go('draft', next)
  }}
/>
```

Import `RenameFolderDialog` and `folderOf`.

- [ ] **Step 7: Typecheck, tests, browser**

Run: `npm run typecheck && npx vitest run src/lib/general`
Expected: exit 0, all pass.
In the browser, open Files → Main, click into a folder. The URL gains `&path=…`, breadcrumbs show `Main / <folder>`, and the Back button returns to root. Rename a Main folder. You land in My draft at the new name, and the draft shows removed and added rows. Rename a draft-only folder. Test at 375px and 1440px, in both themes. Take screenshots.

- [ ] **Step 8: Commit**

```bash
git add src/components/general/FolderBar.tsx src/components/general/RenameFolderDialog.tsx src/components/general/FilesTab.tsx src/components/general/DraftPanel.tsx
git commit -m "$(cat <<'EOF'
Browse files a folder at a time, with breadcrumbs and rename

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: "+ New" — new folder, upload a file, upload a folder

**Files:**
- Create: `src/components/general/NewItemDialog.tsx`
- Modify: `src/components/general/FilesTab.tsx` (header button, delete `NewFileDialog`, render the new dialog)

**Interfaces:**
- Consumes: `joinPath`, `KEEP`, `folderNameProblem`, `nodesAt` (Task 8); `saveDraftFile`, `uploadProjectFile`; the office helpers already imported by `FilesTab`.
- Produces:
  ```ts
  NewItemDialog(props: {
    open: boolean
    onClose: () => void
    repo: GeneralRepoSummary
    tree: GeneralTreeFile[]
    draftFiles: GeneralDraftFile[]
    folder: string
    onDone: (landAt: string) => Promise<void>
  })
  ```

- [ ] **Step 1: Create `NewItemDialog.tsx`**

Move `savePickedFile` and the folder/file upload flow out of `NewFileDialog` into this component. Restructure it around a `step`:

```tsx
import { useState } from 'react'
import { saveDraftFile, uploadProjectFile } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { KEEP, actionFor, buildTree, fileName, folderNameProblem, joinPath, kindForPath, nodesAt, pathProblem, pathWithPickedExtension } from '../../lib/general/files'
import { docxToHtml, OFFICE_WARNING, readAsText, xlsxToWorkbook } from '../../lib/general/office'
import { serializeWorkbook } from '../../lib/general/sheet'
import type { GeneralDraftFile, GeneralRepoSummary, GeneralTreeFile } from '../../lib/general/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

type Step = 'choose' | 'folder' | 'file' | 'upload-folder'

const CHOICES: { step: Step; icon: IconName; title: string; body: string }[] = [
  { step: 'folder', icon: 'folder', title: 'New folder', body: 'Make an empty folder here and name it.' },
  { step: 'file', icon: 'file', title: 'Upload a file', body: 'Add one file from your computer.' },
  { step: 'upload-folder', icon: 'upload', title: 'Upload a folder', body: 'Add a whole folder from your computer.' },
]

export function NewItemDialog({
  open,
  onClose,
  repo,
  tree,
  draftFiles,
  folder,
  onDone,
}: {
  open: boolean
  onClose: () => void
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  draftFiles: GeneralDraftFile[]
  folder: string
  onDone: (landAt: string) => Promise<void>
}) {
  const { show } = useToast()
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<File | null>(null)
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const siblings = (
    nodesAt(buildTree([...tree, ...(draftFiles as unknown as GeneralTreeFile[])]), folder) ?? []
  ).map((n) => n.name)
  const where = folder || 'the top level'

  function close() {
    if (busy) return
    setStep('choose')
    setName('')
    setPicked(null)
    setFolderFiles([])
    setError(null)
    onClose()
  }

  async function savePickedFile(file: File, target: string) {
    const k = kindForPath(target)
    let content = ''
    let storagePath: string | null = null
    if (k === 'rich') content = (await docxToHtml(file)).html
    else if (k === 'sheet') content = serializeWorkbook(await xlsxToWorkbook(file))
    else if (k === 'text') content = await readAsText(file)
    else storagePath = await uploadProjectFile(repo.project_id, file)
    await saveDraftFile({ repoId: repo.id, path: target, action: actionFor(target, tree), kind: k, content, storagePath })
  }

  async function submit() {
    if (busy) return
    let targets: string[] = []
    let files: File[] = []
    let landAt = folder
    let done = ''

    if (step === 'folder') {
      const problem = folderNameProblem(name, siblings)
      if (problem) return setError(problem)
      landAt = joinPath(folder, name.trim())
      targets = [joinPath(landAt, KEEP)]
      done = 'Folder added to your draft'
    } else if (step === 'file') {
      if (!picked) return setError('Choose a file from your computer.')
      const target = joinPath(folder, pathWithPickedExtension(name.trim() || picked.name, picked.name))
      targets = [target]
      files = [picked]
      done = 'Added to your draft'
    } else if (step === 'upload-folder') {
      if (folderFiles.length === 0) return setError('Choose a folder from your computer.')
      files = folderFiles
      targets = folderFiles.map((f) =>
        joinPath(folder, ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/')),
      )
      done = 'Folder added to your draft'
    }

    const problem = targets.map(pathProblem).find(Boolean)
    if (problem) return setError(problem)
    if (targets.some((t) => tree.some((f) => f.path === t))) {
      return setError('The project already has a file with that name here. Open it instead, or pick another name.')
    }

    setError(null)
    setBusy(true)
    try {
      if (step === 'folder') {
        await saveDraftFile({ repoId: repo.id, path: targets[0], action: 'added', kind: 'text', content: '' })
      } else {
        for (let i = 0; i < files.length; i += 1) await savePickedFile(files[i], targets[i])
      }
      show(done)
      setBusy(false)
      close()
      await onDone(landAt)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add it to your draft. Try again in a moment.'))
      setBusy(false)
    }
  }

  const office = picked && ['rich', 'sheet'].includes(kindForPath(picked.name))

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'choose' ? 'New' : CHOICES.find((c) => c.step === step)?.title ?? 'New'}
      description={`It goes into your draft, in ${where}.`}
      size="sm"
      focusField={step === 'folder'}
      footer={
        step === 'choose' ? undefined : (
          <>
            <Button variant="ghost" onClick={() => { setStep('choose'); setError(null) }} disabled={busy}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {step === 'folder' ? 'Create folder' : 'Add to my draft'}
            </Button>
          </>
        )
      }
    >
      {step === 'choose' ? (
        <div className="grid gap-2">
          {CHOICES.map((c) => (
            <button
              key={c.step}
              type="button"
              onClick={() => setStep(c.step)}
              className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left hover:border-line-strong hover:bg-[var(--surface-sunken)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg surface-sunken text-ink">
                <Icon name={c.icon} size={17} />
              </span>
              <span>
                <span className="block text-[14px] font-medium text-ink">{c.title}</span>
                <span className="block text-[12px] text-muted">{c.body}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {step === 'folder' && (
            <Field label="Folder name">
              {(id) => <Input id={id} maxLength={120} placeholder="Chapter 1" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          )}
          {step === 'file' && (
            <>
              <Field label="File">
                {(id) => (
                  <input
                    id={id}
                    type="file"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setPicked(f)
                      if (f) setName(fileName(f.name))
                    }}
                    className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
                  />
                )}
              </Field>
              {picked && (
                <Field label="Save it as">
                  {(id) => <Input id={id} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className="!font-mono" />}
                </Field>
              )}
              {office && <Alert tone="info">{OFFICE_WARNING}</Alert>}
            </>
          )}
          {step === 'upload-folder' && (
            <>
              <Field label="Folder">
                {(id) => (
                  <input
                    id={id}
                    type="file"
                    multiple
                    {...{ webkitdirectory: '', directory: '' }}
                    onChange={(e) => setFolderFiles([...(e.target.files ?? [])])}
                    className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
                  />
                )}
              </Field>
              {folderFiles.length > 0 && (
                <p className="text-[12px] text-muted">
                  {folderFiles.length} {folderFiles.length === 1 ? 'file' : 'files'} selected.
                </p>
              )}
            </>
          )}
        </form>
      )}
    </Modal>
  )
}
```

Check that `upload` is a valid `IconName`: `grep -n "^  upload" src/components/ui/Icon.tsx`. If it isn't, use `'plus'` for that choice. Keep the original single-file `accept` attribute list from `NewFileDialog` on the file input.

- [ ] **Step 2: Swap it into `FilesTab`**

Change the header button label from `New file / folder` to `New`, keeping the `plus` icon. Delete the `NewFileDialog` component and any imports only it used. Render:

```tsx
<NewItemDialog
  open={adding}
  onClose={() => setAdding(false)}
  repo={repo}
  tree={tree}
  draftFiles={draftFiles}
  folder={folder}
  onDone={async (landAt) => {
    await load()
    go('draft', landAt)
  }}
/>
```

- [ ] **Step 3: Typecheck and browser**

Run: `npm run typecheck && npm run build`
Expected: both succeed.
In the browser, from `Main / docs`, press New → New folder → "Figures". You land at `My draft / docs / Figures`, which shows "This folder is empty". No `.keep` is visible anywhere. Submit that folder for review from its 3-dot menu, and it appears under "Submitted by me". Upload a file and a folder into a nested folder, and both land at the current path. Archive the empty folder, and it appears on the project archive page. Take screenshots.

- [ ] **Step 4: Commit**

```bash
git add src/components/general/NewItemDialog.tsx src/components/general/FilesTab.tsx
git commit -m "$(cat <<'EOF'
Replace New file / folder with New: make a folder, upload a file or a folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Search on Main, My draft, For review and History

**Files:**
- Modify: `src/components/general/FilesTab.tsx`
- Modify: `src/components/general/DraftPanel.tsx` (new optional prop `query`)

**Interfaces:**
- Consumes: `matches` (Task 8), `flatFiles` (Task 8), `groupChanges` via `ChangesView` (Task 4).

- [ ] **Step 1: Query state, reset on view change**

In `FilesTab`, add `const [query, setQuery] = useState('')`. In `go()`, when `nextView !== view`, call `setQuery('')`. Directly under `<Tabs …/>`, render:

```tsx
<Input
  icon="search"
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  placeholder={
    view === 'main' ? 'Search Main' : view === 'draft' ? 'Search your draft' : view === 'changes' ? 'Search requests' : 'Search history'
  }
  aria-label="Search this tab"
  className="max-w-md"
/>
```

- [ ] **Step 2: Main**

In `MainView`, accept `query: string`. When `query.trim()` is non-empty, render a flat result list instead of the folder level:

```tsx
const hits = flatFiles(all).filter((n) => matches(query, n.path))
return hits.length === 0 ? (
  <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
    Nothing in Main matches “{query.trim()}”.
  </p>
) : (
  <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
    {hits.map((node) => (
      <li key={node.path}>
        <MainFileRow node={{ ...node, name: node.path }} draftFiles={draftFiles} onOpen={onOpen} />
      </li>
    ))}
  </ul>
)
```

Place it after `const all = buildTree(tree)` and before the `nodesAt` lookup.

- [ ] **Step 3: My draft**

Give `DraftPanel` a `query?: string` prop. When `query?.trim()` is non-empty, render `flatFiles(all).filter((n) => matches(query, n.path))` through the existing `DraftNode` file branch, with an empty message `Nothing in your draft matches “…”.` The folder bar is hidden while searching.

- [ ] **Step 4: For review and History**

Pass the filtered lists:

```tsx
<ChangesView
  repo={repo}
  changes={changes.filter((c) =>
    matches(query, c.title, c.author_id ? state.nameOf(c.author_id) : '', ...c.files.map((f) => f.path)),
  )}
  state={state}
  onDone={load}
/>
<HistoryView
  commits={commits.filter((c) => matches(query, c.message, c.author_id ? state.nameOf(c.author_id) : ''))}
  state={state}
/>
```

When `query.trim()` is set and a filtered list is empty, `ChangesView` and `HistoryView` show `Nothing matches “…”.` in place of their normal empty copy. Add an optional `query?: string` prop to each for that.

- [ ] **Step 5: Typecheck, build, browser**

Run: `npm run typecheck && npm run build`
Expected: both succeed.
In the browser, search each tab with a known path, title, or author, and with a nonsense string. Switching tabs clears the box. Take screenshots.

- [ ] **Step 6: Commit**

```bash
git add src/components/general/FilesTab.tsx src/components/general/DraftPanel.tsx
git commit -m "$(cat <<'EOF'
Search every Files tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification, handoff, push

**Files:**
- Modify: `handoff.md` (append a section at the end)

- [ ] **Step 1: Whole check suite**

Run: `npm run check`
Expected: typecheck, lint (23 warnings / 0 errors), vitest, build, contrast, a11y-names, schema-drift, motion-lint, and legal-ready all pass. If a11y-names flags an `ActionMenu` trigger, the fix is its `label` prop, never a suppression.

- [ ] **Step 2: All SQL suites**

Run: `for f in supabase/tests/general*.test.sql; do node scripts/db.mjs "$f"; done 2>&1 | grep -E "FAIL|ERROR" | head`
Expected: no output.

- [ ] **Step 3: Browser pass**

Use two signed-in accounts on one project, both themes, 375px and 1440px:
- 3-dot menus aren't clipped with folders closed, and are readable in both themes.
- Archive visibility is per account.
- The withdraw confirmation appears.
- For review shows three sections.
- Search works on all four tabs.
- New folder works.
- Both renames work.
- Breadcrumbs and the browser Back button work.
- Archive row menus work.
- The task dialog's Archive button is at the top.

Take a screenshot of each.

- [ ] **Step 4: Handoff**

Append a `## Session — 2026-09-25: files, archive visibility, folders` section to `handoff.md`. Cover:
- the commits
- the archive rule and where it's enforced (`general-archive-rbac.sql`)
- the `.keep` convention
- the rename RPC's two cases
- the finding that `general-project-archive.sql` was missing from `ORDER` and the backup command
- anything still unverified

- [ ] **Step 5: Commit and push**

```bash
git add handoff.md
git commit -m "$(cat <<'EOF'
Hand off the files, archive and folders work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git push
```
