# Tasks from Notes Responsive Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Tasks from notes draft field align cleanly on phone, tablet and desktop screens.

**Architecture:** Split each work draft's mixed field grid into semantic schedule and task-detail fieldsets. Tailwind responsive columns control wrapping; existing field components, state and save behavior remain unchanged.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, happy-dom

**Spec:** `docs/superpowers/specs/2026-11-26-tasks-from-notes-responsive-draft-design.md`

## Global Constraints

- Add no dependency or reusable abstraction.
- Keep title and description full width.
- Schedule uses one phone column and two columns from `sm`.
- Priority, Type and Estimated hours use one phone column, two from `sm`, and three from `lg`.
- Preserve labels, accessible names, modal scrolling, validation, save behavior and class-board behavior.

## Review Focus

- Phone widths: fields remain full width without horizontal overflow.
- Tablet widths: details wrap as two fields plus one field without cramped three-column controls.
- Desktop widths: all three details share one aligned row.
- Class boards: work-only fields remain absent.
- Optional sprint, assignee, team and milestone controls remain usable below the two groups.

---

### Task 1: Responsive draft field groups

**Files:**
- Modify: `src/components/general/TasksFromNotes.tsx:712`
- Modify: `src/components/general/TasksFromNotes.test.tsx`
- Modify: `handoff.md`

**Interfaces:**
- Consumes: existing `DateField`, `Select`, `Input`, `Row`, `patch()` and work-only `!onSave && !classBoard` condition.
- Produces: two accessible fieldsets per work draft, named `Task N schedule` and `Task N details`.

- [ ] **Step 1: Write the failing layout test**

Add a focused assertion to the existing draft test: schedule contains Starts and Due and has `grid-cols-1 sm:grid-cols-2`; details contains Priority, Type and Estimated hours and has `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Assert class-board behavior through the existing work-only condition.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/general/TasksFromNotes.test.tsx`

Expected: FAIL because the accessible fieldsets do not exist.

- [ ] **Step 3: Implement the responsive groups**

In `TasksFromNotes.tsx`, replace the single mixed grid with:

- a schedule fieldset containing Starts and Due;
- a work-only details fieldset containing Priority, Type and Estimated hours;
- the existing optional controls in a separate `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` grid.

Use screen-reader-only legends so visible copy remains unchanged.

- [ ] **Step 4: Verify behavior and responsive layout**

Run:

```powershell
npx vitest run src/components/general/TasksFromNotes.test.tsx
npx tsc --noEmit
npx eslint src/components/general/TasksFromNotes.tsx src/components/general/TasksFromNotes.test.tsx
npm run build
```

Expected: all commands pass. Inspect drafts at phone, tablet and desktop widths with no clipped or uneven controls.

- [ ] **Step 5: Update project records and commit**

Append the responsive-layout result and checks to `handoff.md`, run `python -m graphify update .`, then commit the exact changed files.
