# Joined Classes & spaces card for teaching members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member with Can teach who has work (`membership.hasWork`) gets one Classes & spaces card at the top of the rail, and their Work group becomes a plain heading with Projects and My tasks.

**Architecture:** Only the rail's group list changes, in `railFor` (`src/components/app/nav.ts`). The joined card is the existing `placesGroup(['classes', 'spaces'])` that students use; `SideNav` and `PlacePicker` already render it, its switch, and its collapsed icon rows. A Work group with no `picker` already renders as a `GroupHeader` plus rows.

**Tech Stack:** React 19, TypeScript, Vitest (happy-dom for the rendered test).

**Spec:** `docs/superpowers/specs/2026-11-17-teacher-places-card-design.md`

## Global Constraints

- Rail rules live in `nav.ts`, never in `SideNav.tsx`.
- Unchanged rails: teaching only (no work), teaching + Project manager with no work, non-teaching members, students, admins, stakeholder-only members.
- The joined card's title is `Classes & spaces` (what `placesGroup` already produces for two kinds).
- The joined card keeps `hideWhenEmpty: false` and `withClasses: false`.
- Copy: sentence case, no new user-facing strings.
- Run `npm run build` before claiming done.

## Review Focus

1. Teacher + Project manager + no work: must keep `['Classes', 'Main', 'Work', 'Resources', 'Account']` with Work's `picker` `['spaces']`, `hideWhenEmpty: false` — Task 1 pins it.
2. Teacher + `membership` still loading (`undefined`): no work assumed, so the separate Classes card, never a flash of the joined card — Task 1 pins it.
3. My office for an office head: still appended to Main (`TEACHING_MAIN`), not to the card — Task 1 pins it.
4. The `nav-tasks` walkthrough marker stays on My tasks under the plain Work heading — Task 2 pins it.
5. Collapsed rail for a teacher with work: Classes and Spaces icon rows, then Work's rows — Task 2 pins it.

---

### Task 1: Rail rules in `nav.ts`

**Files:**
- Modify: `src/components/app/nav.ts` (`TEACHING_CLASSES` comment ~188-192, `teachingWork` ~194-207, `navFor` doc ~324-327, `railFor` teaching branch ~386-395)
- Test: `src/components/app/nav.test.ts` (the `describe('the teaching rail')` block ~63-117, and lines ~212 and ~219)

**Interfaces:**
- Produces: `teachingWork(manager: boolean, joined: boolean): NavGroup`. When `joined` is true it returns `{ title: 'Work', items: [PROJECTS, My tasks] }` with no `picker`; when false, today's group unchanged.
- In `railFor`, `const joined = membership?.hasWork === true`; first group is `joined ? placesGroup(['classes', 'spaces']) : TEACHING_CLASSES`; the Work group is included when `membership?.hasWork || manager`, as today, built with `teachingWork(manager, joined)`.

- [ ] **Step 1: Update the tests in `nav.test.ts`**

In `describe('the teaching rail')`:

```ts
it('joins classes and spaces in one card for a teacher with work', () => {
  for (const who of [teacher, manager]) {
    const groups = navFor(who, true, { inClass: true, hasWork: true })
    expect(titles(groups)).toEqual(['Classes & spaces', 'Main', 'Work', 'Resources', 'Account'])
    expect(groups[0].picker).toEqual(['classes', 'spaces'])
    expect(groups[0].hideWhenEmpty).toBe(false)
    expect(groups[0].withClasses).toBe(false)
    const work = groups.find((g) => g.title === 'Work')!
    expect(work.picker).toBeUndefined()
    expect(work.items.map((i) => i.label)).toEqual(['Projects', 'My tasks'])
    expect(groups.filter((g) => g.picker)).toHaveLength(1)
  }
})

it('keeps the Work card for a project manager with no work yet', () => {
  for (const groups of [navFor(manager, true), navFor(manager, true, { inClass: false, hasWork: false })]) {
    expect(titles(groups)).toEqual(['Classes', 'Main', 'Work', 'Resources', 'Account'])
    const work = groups.find((g) => g.title === 'Work')!
    expect(work.picker).toEqual(['spaces'])
    expect(work.hideWhenEmpty).toBe(false)
    expect(work.items.map((i) => i.label)).toEqual(['Projects', 'My tasks'])
  }
})

it('adds My office to Main, not the card, for a teacher with work who heads an office', () => {
  const groups = navFor(teacher, true, { inClass: true, hasWork: true }, true)
  expect(section(groups, 'Main')?.at(-1)).toBe('My office')
  expect(groups[0].items).toEqual([])
})
```

Replace `adds Work between Main and Resources for work or the Project manager switch` (its cases are now split between the two tests above). In `puts the classes in the card at the top…`, keep the `navFor(teacher, true)` assertions and the `navFor(manager, true)[0].picker` line; reword its comment to "With no work, spaces stay in Work's own card." The existing `opens on the classes card…` test already pins loading (`navFor(teacher, true)`) and teaching-only.

Outside the describe: at ~212 the teacher-with-work Spaces group is the joined card, `withClasses` stays `false` (no edit). At ~219 change the teacher-with-work expectation to `.toBe(false)` and the test name to `hides an empty Spaces only for accounts that cannot open a class or make a space`.

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run src/components/app/nav.test.ts`
Expected: FAIL in `joins classes and spaces in one card for a teacher with work` (titles start with `'Classes'`).

- [ ] **Step 3: Implement in `nav.ts`**

Change `teachingWork` to the signature above and the teaching branch of `railFor` as described in Interfaces. Update the doc comments on `TEACHING_CLASSES`, `teachingWork` and `navFor` ("Teaching faculty's card lists their classes only…") to say: a teacher with work gets the Classes & spaces card and a plain Work group; without work, the Classes card and, for a project manager, Work's spaces card.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/app/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/app/nav.ts src/components/app/nav.test.ts
git commit -m "Join classes and spaces in one card for a teacher with work"
```

---

### Task 2: Rendered rail for a teacher with work

**Files:**
- Test: `src/components/app/SideNav.teaching.test.tsx`

**Interfaces:**
- Consumes: Task 1's rail. No product code changes expected; if a test fails, fix `nav.ts`, not `SideNav.tsx`, unless the failure is in rendering.

- [ ] **Step 1: Make the mocked navigation's spaces switchable**

Hoist `const nav = vi.hoisted(() => ({ work: false }))`; the `useGeneralNavigation` mock returns the two class spaces plus, when `nav.work`, `{ id: 'w1', name: 'Capstone 2', class_id: null, kind: 'work', my_level: 'owner', archived_at: null, project_count: 1 }`. Reset `nav.work = false` in `beforeEach`.

- [ ] **Step 2: Add the tests**

```ts
it('shows one Classes & spaces card and a plain Work list for a teacher with work', async () => {
  nav.work = true
  await show('/home')
  const cards = [...host.querySelectorAll('section.place-card')]
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Classes & spaces'])
  expect(hrefs()).toContain('/classes/k1')
  expect(links()).toContain('All classes')
  const tasks = host.querySelector('[data-walkthrough="nav-tasks"]')
  expect(tasks?.getAttribute('href')).toBe('/tasks')
  expect(links()).toContain('Projects')
})

it('opens the card on Spaces on a space page', async () => {
  nav.work = true
  await show('/spaces/w1')
  expect(links()).toContain('All spaces')
  expect(hrefs()).toContain('/spaces/w1')
})

it('gives a teacher with work Classes and Spaces rows on the collapsed rail', async () => {
  nav.work = true
  await show('/home', true)
  const labels = [...host.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))
  expect(labels).toEqual(expect.arrayContaining(['Classes', 'Spaces', 'My tasks']))
})

it('keeps the single Classes card for a teacher with no work', async () => {
  await show('/home')
  const cards = [...host.querySelectorAll('section.place-card')]
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Classes'])
})
```

If the collapsed rows name their link through `aria-label` differently (see `MoreRow` in `SideNav.tsx`), match what `MoreRow` renders; keep the three names.

- [ ] **Step 3: Run the rail tests**

Run: `npx vitest run src/components/app`
Expected: PASS, including `SideNav.test.tsx` and `lib/walkthrough/markers.test.ts` unaffected.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Check it in the app**

`npm run dev` via the preview tool, signed in as a member with Can teach in a work space: the top card reads Classes & spaces with the switch; Work below Main shows Projects and My tasks; light and dark both; collapsed rail shows two place icons.

- [ ] **Step 6: Commit**

```bash
git add src/components/app/SideNav.teaching.test.tsx
git commit -m "Test the joined card on the teaching rail"
```
